import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const directory = mkdtempSync(path.join(os.tmpdir(), "quiz-platform-journal-"));
process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
process.env.MEDIA_ROOT = path.join(directory, "media");
process.env.BACKUP_ROOT = path.join(directory, "backups");
process.env.MEDIA_WORKER_POLL_MS = "25";
process.env.TURNSTILE_SECRET_KEY = "test-secret";
process.env.TURNSTILE_ALLOWED_HOSTNAMES = "localhost";
process.env.JOURNAL_ADMIN_USER_ID = "admin";
globalThis.File ??= NodeFile;
globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "journal_upload", hostname: "localhost" }), {
  headers: { "content-type": "application/json" },
});

const BetterSqlite3 = require("better-sqlite3");
const bootstrap = new BetterSqlite3(process.env.DATABASE_PATH);
bootstrap.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT "", emailVerified INTEGER NOT NULL)');
const insertUser = bootstrap.prepare('INSERT INTO "user" (id, name, emailVerified) VALUES (?, ?, ?)');
for (const [id, name, verified = 1] of [
  ["owner", "札记作者"], ["reader", "读者甲"], ["reader-2", "读者乙"], ["reader-3", "读者丙"],
  ["reader-4", "读者丁"], ["gallery", "多图作者"], ["unverified", "未验证用户", 0], ["admin", "管理员"],
]) insertUser.run(id, name, verified);
bootstrap.close();

const moduleCache = new Map();
function resolveModule(request, parentFile) {
  if (!request.startsWith(".") && !request.startsWith("@/")) return request;
  const base = request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : path.resolve(path.dirname(parentFile), request);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return base;
}

function loadModule(filePath) {
  const normalized = path.normalize(filePath);
  if (moduleCache.has(normalized)) return moduleCache.get(normalized).exports;
  const source = readFileSync(normalized, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: normalized,
  });
  const record = { exports: {} };
  moduleCache.set(normalized, record);
  const localRequire = (request) => {
    if (request === "server-only") return {};
    const resolved = resolveModule(request, normalized);
    return typeof resolved === "string" && path.isAbsolute(resolved) ? loadModule(resolved) : require(resolved);
  };
  new Function("module", "exports", "require", outputText)(record, record.exports, localRequire);
  return record.exports;
}

const database = loadModule(path.join(root, "src/lib/server/database.ts"));
const journal = loadModule(path.join(root, "src/lib/server/journal.ts"));
const { runMediaBackup } = await import("./media-backup.mjs");
const { reconcilePublicMedia } = await import("./media-worker.mjs");
const sharp = require("sharp");
sharp.cache(false);

async function jpegFile(name = "moment.jpg") {
  const bytes = await sharp({ create: { width: 720, height: 540, channels: 3, background: "#4d7f72" } })
    .jpeg({ quality: 90 })
    .withMetadata({ exif: { IFD0: { Make: "Private Camera", Model: "Secret Model" } } })
    .toBuffer();
  return new File([bytes], name, { type: "image/jpeg" });
}

async function batch(userId, entryId) {
  return journal.createJournalUploadBatch(userId, entryId, "valid-token", "127.0.0.1");
}

async function waitForAsset(userId, entryId, assetId, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = journal.getOwnedJournalEntry(userId, entryId);
    const image = entry.images.find((item) => item.id === assetId);
    if (image?.status === expected) return { entry, image };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for asset ${assetId} to become ${expected}`);
}

function startWorker() {
  return spawn(process.execPath, [path.join(root, "scripts/media-worker.mjs")], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopWorker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function waitForCondition(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

let worker;
try {
  const sqlite = database.getDatabase();
  worker = startWorker();
  const draft = journal.createJournalEntry("owner", { contentLanguage: "zh", allowComments: true });
  assert.equal(draft.revision, 0);
  assert.equal(draft.images.length, 0);
  assert.throws(() => journal.getOwnedJournalEntry("reader", draft.id), (error) => error.code === "JOURNAL_NOT_FOUND");
  assert.throws(() => journal.createJournalEntry("unverified", {}), (error) => error.code === "EMAIL_NOT_VERIFIED");

  // --- The P1 journal-draft continuation is judged inside the draft action:
  // a count only happens for an account whose latest cloud completion sits
  // on an earlier day within the 28-day window, at most once per account per
  // day, and the stored row stays an anonymous day-grained counter.
  sqlite.prepare('INSERT INTO "user" (id, name, emailVerified) VALUES (?, ?, ?)').run("cont-old", "延续·窗口内完成", 1);
  sqlite.prepare('INSERT INTO "user" (id, name, emailVerified) VALUES (?, ?, ?)').run("cont-today", "延续·当天完成", 1);
  sqlite.prepare('INSERT INTO "user" (id, name, emailVerified) VALUES (?, ?, ?)').run("cont-stale", "延续·过期完成", 1);
  sqlite.prepare('INSERT INTO "user" (id, name, emailVerified) VALUES (?, ?, ?)').run("cont-none", "延续·无完成", 1);
  const insertCloudAttempt = sqlite.prepare("INSERT INTO quiz_attempts (user_id, id, test_id, result_json, answers_json, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insertCloudAttempt.run("cont-old", "cont-a1", "mbti", "{}", "[]", Date.now() - 3 * 86_400_000, Date.now() - 3 * 86_400_000);
  insertCloudAttempt.run("cont-today", "cont-a2", "mbti", "{}", "[]", Date.now(), Date.now());
  insertCloudAttempt.run("cont-stale", "cont-a3", "mbti", "{}", "[]", Date.now() - 40 * 86_400_000, Date.now() - 40 * 86_400_000);

  journal.createJournalEntry("cont-none", { title: "无完成" });
  journal.createJournalEntry("cont-today", { title: "当天完成" });
  journal.createJournalEntry("cont-stale", { title: "过期完成" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM aggregate_events WHERE event_name = 'continuation_journal_draft'").get().count, 0, "no completion in the 1-28 day window means no continuation count");

  journal.createJournalEntry("cont-old", { title: "第一篇草稿" });
  assert.deepEqual(
    sqlite.prepare("SELECT event_name, entity_type, entity_id, value, event_day, event_count FROM aggregate_events WHERE event_name = 'continuation_journal_draft'").all(),
    [{ event_name: "continuation_journal_draft", entity_type: "continuation", entity_id: "", value: "", event_day: new Date().toISOString().slice(0, 10), event_count: 1 }],
  );

  journal.createJournalEntry("cont-old", { title: "第二篇草稿" });
  assert.equal(sqlite.prepare("SELECT event_count FROM aggregate_events WHERE event_name = 'continuation_journal_draft'").get().event_count, 1, "the continuation count is deduped per account per day");

  const secret = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  await assert.rejects(() => journal.createJournalUploadBatch("owner", draft.id, "token", "127.0.0.1"), (error) => error.code === "TURNSTILE_NOT_CONFIGURED");
  process.env.TURNSTILE_SECRET_KEY = secret;

  const upload = await batch("owner", draft.id);
  const source = await jpegFile();
  const queued = await journal.uploadJournalAsset("owner", draft.id, source, { uploadId: upload.uploadId, position: 0 });
  assert.equal(queued.images.length, 1);
  assert.equal(queued.images[0].status, "queued");
  assert.ok(["queued", "running"].includes(sqlite.prepare("SELECT status FROM journal_jobs WHERE asset_id = ?").get(queued.images[0].id).status));
  const { entry: uploaded } = await waitForAsset("owner", draft.id, queued.images[0].id, "ready");
  assert.deepEqual(Object.keys(uploaded.images[0].variants), ["thumb", "medium", "large"]);
  const privateRows = sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE asset_id = ? AND scope = 'private' ORDER BY requested_width").all(uploaded.images[0].id);
  assert.equal(privateRows.length, 3);
  for (const row of privateRows) {
    const variantPath = path.join(process.env.MEDIA_ROOT, "private", row.storage_key);
    assert.equal(existsSync(variantPath), true);
    const metadata = await sharp(readFileSync(variantPath)).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined, "processed images must not retain EXIF metadata");
  }
  const storedVariantBytes = sqlite.prepare("SELECT SUM(byte_size) AS bytes FROM journal_asset_variants WHERE asset_id = ?").get(uploaded.images[0].id).bytes;
  assert.equal(journal.getJournalViewer("owner").mediaBytesUsed, storedVariantBytes, "media quota must use stored variants rather than original upload bytes");

  const spoofBatch = await batch("owner", draft.id);
  const spoof = new File([Buffer.from(await source.arrayBuffer())], "spoof.png", { type: "image/png" });
  await assert.rejects(() => journal.uploadJournalAsset("owner", draft.id, spoof, { uploadId: spoofBatch.uploadId }), (error) => error.code === "UNSUPPORTED_IMAGE");
  const gifBatch = await batch("owner", draft.id);
  const gif = new File([Buffer.from("GIF89a", "ascii")], "moving.gif", { type: "image/gif" });
  await assert.rejects(() => journal.uploadJournalAsset("owner", draft.id, gif, { uploadId: gifBatch.uploadId }), (error) => error.code === "UNSUPPORTED_IMAGE");
  const oversizedPixels = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const pixelBatch = await batch("owner", draft.id);
  const pixelFile = new File([oversizedPixels], "too-many-pixels.png", { type: "image/png" });
  const pixelQueued = await journal.uploadJournalAsset("owner", draft.id, pixelFile, { uploadId: pixelBatch.uploadId });
  const { image: pixelFailed } = await waitForAsset("owner", draft.id, pixelQueued.uploadedAssetId, "failed", 30_000);
  assert.match(pixelFailed.error, /pixel|corrupt/i);
  const retryBatch = await batch("owner", draft.id);
  await journal.replaceJournalAsset("owner", draft.id, pixelFailed.id, await jpegFile("retry.jpg"), { uploadId: retryBatch.uploadId });
  const { image: retriedImage } = await waitForAsset("owner", draft.id, pixelFailed.id, "ready");
  assert.equal(retriedImage.status, "ready", "a failed asset must accept a fresh-file retry");
  journal.deleteJournalAsset("owner", draft.id, retriedImage.id);

  const currentDraft = journal.getOwnedJournalEntry("owner", draft.id);
  const image = currentDraft.images[0];
  const receipt = journal.updateJournalEntry("owner", draft.id, {
    title: "雨后窗边",
    body: "这张图让我想到重新开始。",
    contentLanguage: "zh",
    allowComments: true,
    baseRevision: currentDraft.revision,
    images: [{ id: image.id, position: 0, caption: "雨停之后", alt: "雨后透光的绿色窗边", decorative: false }],
  });
  assert.equal(receipt.revision, currentDraft.revision + 1);
  assert.throws(() => journal.updateJournalEntry("owner", draft.id, { title: "冲突", baseRevision: currentDraft.revision }), (error) => error.code === "DRAFT_CONFLICT");

  const originalVariantSizes = sqlite.prepare("SELECT requested_width, byte_size FROM journal_asset_variants WHERE asset_id = ? AND scope = 'private'").all(image.id);
  sqlite.prepare("UPDATE journal_asset_variants SET byte_size = 100 * 1024 * 1024 WHERE asset_id = ? AND scope = 'private'").run(image.id);
  assert.throws(() => journal.publishJournalEntry("owner", draft.id), (error) => error.code === "MEDIA_QUOTA");
  const restoreVariantSize = sqlite.prepare("UPDATE journal_asset_variants SET byte_size = ? WHERE asset_id = ? AND scope = 'private' AND requested_width = ?");
  for (const variant of originalVariantSizes) restoreVariantSize.run(variant.byte_size, image.id, variant.requested_width);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_revisions WHERE entry_id = ?").get(draft.id).count, 0, "quota rejection must not create a public revision");

  const published = journal.publishJournalEntry("owner", draft.id);
  assert.equal(published.status, "published");
  assert.equal(published.publicRevision, 1);
  assert.equal(published.hasUnpublishedChanges, false);

  const imageOnlyDraft = journal.createJournalEntry("reader-3", { contentLanguage: "zh" });
  const imageOnlyBatch = await batch("reader-3", imageOnlyDraft.id);
  const imageOnlyQueued = await journal.uploadJournalAsset("reader-3", imageOnlyDraft.id, await jpegFile("image-only.jpg"), { uploadId: imageOnlyBatch.uploadId });
  const { entry: imageOnlyReady } = await waitForAsset("reader-3", imageOnlyDraft.id, imageOnlyQueued.uploadedAssetId, "ready");
  journal.updateJournalEntry("reader-3", imageOnlyDraft.id, {
    baseRevision: imageOnlyReady.revision,
    images: [{ id: imageOnlyReady.images[0].id, position: 0, caption: "", alt: "只有图片的社区帖子", decorative: false }],
  });
  const imageOnlyPublished = journal.publishJournalEntry("reader-3", imageOnlyDraft.id);
  assert.equal(imageOnlyPublished.title, "", "an image post can be published without a title");
  assert.equal(imageOnlyPublished.body, "", "an image post can be published without body text");
  journal.deleteJournalEntry("reader-3", imageOnlyDraft.id);

  // Keep the high-reaction entry outside the latest page. Resonant ordering
  // must be applied in SQL so it can still surface on the first page.
  const feedSeedEntries = Array.from({ length: 21 }, (_, index) => ({
    entryId: `feed-sort-entry-${index}`,
    revisionId: `feed-sort-revision-${index}`,
    publishedAt: Date.now() - 2_000_000 + index * 1_000,
  }));
  const insertFeedEntry = sqlite.prepare(`
    INSERT INTO journal_entries
      (id, user_id, title, body, content_language, allow_comments, status, published_revision_id,
       created_at, updated_at, published_at)
    VALUES (?, 'owner', ?, ?, 'zh', 1, 'published', ?, ?, ?, ?)
  `);
  const insertFeedRevision = sqlite.prepare(`
    INSERT INTO journal_revisions
      (id, entry_id, revision_number, title, body, content_language, allow_comments,
       draft_revision, author_display_name, created_at)
    VALUES (?, ?, 1, ?, ?, 'zh', 1, 0, '札记作者', ?)
  `);
  for (const item of feedSeedEntries) {
    insertFeedEntry.run(item.entryId, item.entryId, "排序测试内容", item.revisionId, item.publishedAt, item.publishedAt, item.publishedAt);
    insertFeedRevision.run(item.revisionId, item.entryId, item.entryId, "排序测试内容", item.publishedAt);
  }
  const highReactionEntryId = feedSeedEntries[0].entryId;
  sqlite.prepare("INSERT INTO journal_reactions (entry_id, user_id, created_at) VALUES (?, 'reader', ?)").run(highReactionEntryId, Date.now());
  const latestFeedEntries = journal.listPublishedJournalEntries(null, "latest");
  const resonantFeedEntries = journal.listPublishedJournalEntries(null, "resonant");
  assert.equal(latestFeedEntries.some((entry) => entry.id === highReactionEntryId), false, "the oldest entry stays outside the latest page");
  assert.equal(resonantFeedEntries[0].id, highReactionEntryId, "resonant ordering surfaces the high-reaction entry");
  sqlite.prepare("DELETE FROM journal_reactions WHERE entry_id LIKE 'feed-sort-entry-%'").run();
  sqlite.prepare("DELETE FROM journal_entries WHERE id LIKE 'feed-sort-entry-%'").run();

  const publicV1 = journal.getPublishedJournalEntry(draft.id, "reader");
  assert.equal(publicV1.title, "雨后窗边");
  assert.equal(publicV1.images[0].alt, "雨后透光的绿色窗边");
  const anonymousDetail = journal.getPublishedJournalEntry(draft.id, null);
  const anonymousFeedEntry = journal.listPublishedJournalEntries(null).find((entry) => entry.id === draft.id);
  assert.ok(anonymousFeedEntry, "published journal must appear in the anonymous feed");
  for (const [surface, payload] of [["detail", anonymousDetail], ["feed", anonymousFeedEntry]]) {
    assert.equal(Object.hasOwn(payload, "ownerId"), false, `anonymous ${surface} JSON must not expose ownerId`);
    assert.equal(Object.hasOwn(payload.author, "id"), false, `anonymous ${surface} JSON must not expose author.id`);
    assert.equal(JSON.stringify(payload).includes('"id":"owner"'), false, `anonymous ${surface} JSON must not contain the internal user id`);
  }
  const publicKey = sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public' LIMIT 1").get(sqlite.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ?").get(draft.id).published_revision_id).storage_key;
  const publicPath = path.join(process.env.MEDIA_ROOT, "public", publicKey);
  assert.equal(existsSync(publicPath), true);

  const privateDraft = journal.getOwnedJournalEntry("owner", draft.id);
  assert.equal(privateDraft.ownerId, "owner", "owner-only draft JSON keeps its authorization identifier");
  journal.updateJournalEntry("owner", draft.id, { title: "第二版标题", baseRevision: privateDraft.revision });
  assert.equal(journal.getPublishedJournalEntry(draft.id, null).title, "雨后窗边", "draft edits must not mutate the public revision");
  assert.equal(journal.getJournalEntryForViewer("owner", draft.id).title, "雨后窗边", "normal owner detail reads the public snapshot");
  assert.equal(journal.getJournalEntryForViewer("owner", draft.id, true).title, "第二版标题", "draft view reads mutable owner content");
  const publishedV2 = journal.publishJournalEntry("owner", draft.id);
  assert.equal(publishedV2.publicRevision, 2);
  assert.equal(journal.getPublishedJournalEntry(draft.id, null).title, "第二版标题");
  assert.equal(existsSync(publicPath), false, "superseded public revisions must not remain directly readable");
  const currentRevisionId = sqlite.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ?").get(draft.id).published_revision_id;
  const currentPublicKey = sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public' LIMIT 1").get(currentRevisionId).storage_key;
  const currentPublicPath = path.join(process.env.MEDIA_ROOT, "public", currentPublicKey);

  journal.createJournalReport("reader", { entryId: draft.id, reason: "spam" });
  journal.createJournalReport("reader-2", { entryId: draft.id, reason: "spam" });
  const threshold = journal.createJournalReport("reader-3", { entryId: draft.id, reason: "spam" });
  assert.equal(threshold.hidden, true);
  assert.throws(() => journal.getPublishedJournalEntry(draft.id, null), (error) => error.code === "PUBLIC_JOURNAL_NOT_FOUND");
  const quarantinedPath = path.join(process.env.MEDIA_ROOT, "private", "quarantine", currentPublicKey);
  assert.equal(existsSync(currentPublicPath), false, "auto-hide must invalidate the public media path immediately");
  assert.equal(existsSync(quarantinedPath), true, "auto-hide must retain the immutable revision in private quarantine");
  journal.moderateJournalTarget("admin", { targetType: "entry", targetId: draft.id, action: "restore", reason: "reviewed" });
  assert.equal(journal.getPublishedJournalEntry(draft.id, null).status, "published");
  assert.equal(existsSync(currentPublicPath), true, "admin restore must atomically restore the public media path");
  assert.equal(journal.getOwnedJournalEntry("owner", draft.id).hasUnpublishedChanges, false);

  const second = journal.createJournalEntry("owner", { title: "需要审核的札记", contentLanguage: "zh" });
  const secondUpload = await batch("owner", second.id);
  const secondQueued = await journal.uploadJournalAsset("owner", second.id, await jpegFile("second.jpg"), { uploadId: secondUpload.uploadId });
  const { entry: secondReady } = await waitForAsset("owner", second.id, secondQueued.uploadedAssetId, "ready");
  journal.updateJournalEntry("owner", second.id, {
    baseRevision: secondReady.revision,
    images: [{ id: secondReady.images[0].id, position: 0, caption: "", alt: "绿色方形图像", decorative: false }],
  });
  journal.publishJournalEntry("owner", second.id);
  const highRisk = journal.createJournalReport("reader-4", { entryId: second.id, reason: "privacy" });
  assert.equal(highRisk.hidden, true, "one high-risk report must hide public content");
  const secondRevisionId = sqlite.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ?").get(second.id).published_revision_id;
  const secondPublicKey = sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public' LIMIT 1").get(secondRevisionId).storage_key;
  const secondQuarantinePath = path.join(process.env.MEDIA_ROOT, "private", "quarantine", secondPublicKey);
  assert.equal(existsSync(secondQuarantinePath), true);

  await stopWorker(worker);
  const originalMediaRoot = process.env.MEDIA_ROOT;
  const failedReconcileMediaRoot = path.join(directory, "failed-reconcile-media");
  const failedReconcileModes = [];
  process.env.MEDIA_ROOT = failedReconcileMediaRoot;
  try {
    await assert.rejects(
      reconcilePublicMedia({
        prepare() { throw new Error("injected reconciliation failure"); },
      }, {
        blockPublicRoot: true,
        chmodPublicRoot(target, mode) {
          failedReconcileModes.push({ target: path.resolve(target), mode });
          chmodSync(target, mode);
        },
      }),
      /injected reconciliation failure/,
    );
  } finally {
    process.env.MEDIA_ROOT = originalMediaRoot;
  }
  assert.deepEqual(
    failedReconcileModes.filter((call) => call.target === path.resolve(failedReconcileMediaRoot, "public")).map((call) => call.mode),
    [0o700],
    "failed startup reconciliation must leave the public root blocked",
  );

  const currentPublicDirectory = path.join(process.env.MEDIA_ROOT, "public", currentRevisionId);
  const currentQuarantineDirectory = path.join(process.env.MEDIA_ROOT, "private", "quarantine", currentRevisionId);
  const secondPublicDirectory = path.join(process.env.MEDIA_ROOT, "public", secondRevisionId);
  const secondQuarantineDirectory = path.join(process.env.MEDIA_ROOT, "private", "quarantine", secondRevisionId);
  renameSync(currentPublicDirectory, currentQuarantineDirectory);
  renameSync(secondQuarantineDirectory, secondPublicDirectory);
  chmodSync(secondPublicDirectory, 0o755);
  const orphanPublicDirectory = path.join(process.env.MEDIA_ROOT, "public", "orphan-revision");
  mkdirSync(orphanPublicDirectory, { recursive: true });
  writeFileSync(path.join(orphanPublicDirectory, "leaked.webp"), "orphan");
  worker = startWorker();
  await waitForCondition(
    () => existsSync(currentPublicPath) && existsSync(secondQuarantinePath) && !existsSync(orphanPublicDirectory),
    "media worker did not reconcile staged, hidden, and orphan public revisions",
  );

  const pendingBackupEntry = journal.createJournalEntry("reader-4", { title: "备份中的上传" });
  const pendingBackupAssetId = "backup-pending-asset";
  const pendingBackupJobId = "backup-pending-job";
  const pendingBackupKey = "uploads/backup-pending.upload";
  const pendingBackupPath = path.join(process.env.MEDIA_ROOT, "tmp", pendingBackupKey);
  const pendingBackupBytes = Buffer.from(await (await jpegFile("backup-pending.jpg")).arrayBuffer());
  mkdirSync(path.dirname(pendingBackupPath), { recursive: true });
  writeFileSync(pendingBackupPath, pendingBackupBytes);
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO journal_assets (id, user_id, source_mime, source_bytes, status, created_at) VALUES (?, 'reader-4', 'image/jpeg', ?, 'processing', ?)")
      .run(pendingBackupAssetId, pendingBackupBytes.length, Date.now());
    sqlite.prepare("INSERT INTO journal_entry_assets (entry_id, asset_id, position, caption, alt_text, decorative) VALUES (?, ?, 0, '', '', 1)")
      .run(pendingBackupEntry.id, pendingBackupAssetId);
    sqlite.prepare(`
      INSERT INTO journal_jobs (id, user_id, entry_id, asset_id, kind, status, tmp_storage_key, available_at, created_at)
      VALUES (?, 'reader-4', ?, ?, 'process_upload', 'queued', ?, ?, ?)
    `).run(pendingBackupJobId, pendingBackupEntry.id, pendingBackupAssetId, pendingBackupKey, Date.now() + 60_000, Date.now());
    sqlite.prepare("UPDATE journal_entries SET status = 'processing' WHERE id = ?").run(pendingBackupEntry.id);
  })();
  const snapshot = await runMediaBackup({ force: true });
  assert.equal(snapshot.created, true);
  assert.equal(existsSync(path.join(snapshot.path, "app.sqlite3")), true);
  assert.equal(existsSync(path.join(snapshot.path, "media", "private", "quarantine", secondPublicKey)), true, "consistent backups preserve hidden revisions in quarantine");
  assert.equal(existsSync(path.join(snapshot.path, "media", "tmp", pendingBackupKey)), false, "backups must not retain original uploads with EXIF metadata");
  const snapshotManifest = JSON.parse(readFileSync(path.join(snapshot.path, "manifest.json"), "utf8"));
  assert.equal(snapshotManifest.pendingUploadJobs, 0);
  assert.equal(snapshotManifest.discardedPendingUploadJobs, 1);
  const snapshotDatabase = new BetterSqlite3(path.join(snapshot.path, "app.sqlite3"));
  assert.equal(snapshotDatabase.prepare("SELECT status FROM journal_jobs WHERE id = ?").get(pendingBackupJobId).status, "failed");
  assert.equal(snapshotDatabase.prepare("SELECT tmp_storage_key FROM journal_jobs WHERE id = ?").get(pendingBackupJobId).tmp_storage_key, "");
  assert.equal(snapshotDatabase.prepare("SELECT status FROM journal_assets WHERE id = ?").get(pendingBackupAssetId).status, "failed");
  assert.equal(snapshotDatabase.prepare("SELECT status FROM journal_entries WHERE id = ?").get(pendingBackupEntry.id).status, "draft");
  snapshotDatabase.prepare(`
    INSERT INTO deletion_tombstones (id, entity_type, entity_id, storage_scope, storage_key, deleted_at)
    VALUES ('restore-test', 'journal_revision', 'restore-test', 'public', 'restore-test/asset/320.webp', ?)
  `).run(Date.now());
  snapshotDatabase.close();
  const fakeSnapshotFile = path.join(snapshot.path, "media", "public", "restore-test", "asset", "320.webp");
  mkdirSync(path.dirname(fakeSnapshotFile), { recursive: true });
  writeFileSync(fakeSnapshotFile, "deleted");
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM journal_jobs WHERE id = ?").run(pendingBackupJobId);
    sqlite.prepare("DELETE FROM journal_entry_assets WHERE entry_id = ?").run(pendingBackupEntry.id);
    sqlite.prepare("DELETE FROM journal_assets WHERE id = ?").run(pendingBackupAssetId);
    sqlite.prepare("DELETE FROM journal_entries WHERE id = ?").run(pendingBackupEntry.id);
  })();
  rmSync(pendingBackupPath, { force: true });

  const corruptSnapshot = path.join(directory, "corrupt-snapshot");
  cpSync(snapshot.path, corruptSnapshot, { recursive: true });
  rmSync(path.join(corruptSnapshot, "media", "private"), { recursive: true, force: true });
  writeFileSync(path.join(corruptSnapshot, "media", "private"), "not a directory");
  const preservedDatabasePath = path.join(directory, "preserved.sqlite");
  const preservedDatabase = new BetterSqlite3(preservedDatabasePath);
  preservedDatabase.exec("CREATE TABLE restore_sentinel (value TEXT NOT NULL); INSERT INTO restore_sentinel VALUES ('keep-database')");
  preservedDatabase.close();
  const preservedMediaRoot = path.join(directory, "preserved-media");
  const preservedPrivateSentinel = path.join(preservedMediaRoot, "private", "sentinel.txt");
  const preservedPublicSentinel = path.join(preservedMediaRoot, "public", "sentinel.txt");
  mkdirSync(path.dirname(preservedPrivateSentinel), { recursive: true });
  mkdirSync(path.dirname(preservedPublicSentinel), { recursive: true });
  mkdirSync(path.join(preservedMediaRoot, "tmp"), { recursive: true });
  writeFileSync(preservedPrivateSentinel, "keep-private");
  writeFileSync(preservedPublicSentinel, "keep-public");
  const failedRestore = spawnSync(process.execPath, [path.join(root, "scripts/media-restore.mjs"), "--snapshot", corruptSnapshot], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: preservedDatabasePath, MEDIA_ROOT: preservedMediaRoot, RESTORE_CONFIRM: "1" },
    encoding: "utf8",
  });
  assert.notEqual(failedRestore.status, 0, "a malformed snapshot must fail before replacing live state");
  assert.equal(readFileSync(preservedPrivateSentinel, "utf8"), "keep-private");
  assert.equal(readFileSync(preservedPublicSentinel, "utf8"), "keep-public");
  const preservedDatabaseAfterFailure = new BetterSqlite3(preservedDatabasePath, { readonly: true });
  assert.equal(preservedDatabaseAfterFailure.prepare("SELECT value FROM restore_sentinel").pluck().get(), "keep-database");
  preservedDatabaseAfterFailure.close();

  const blockedMediaRoot = path.join(directory, "blocked-media");
  const blockedPublicSentinel = path.join(blockedMediaRoot, "public", "sentinel.webp");
  mkdirSync(path.dirname(blockedPublicSentinel), { recursive: true });
  writeFileSync(blockedPublicSentinel, "keep-blocked");
  const restoreMarker = path.join(directory, ".blocked-media.restore-in-progress");
  writeFileSync(restoreMarker, "restore interrupted");
  const blockedWorker = spawnSync(process.execPath, [path.join(root, "scripts/media-worker.mjs")], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: preservedDatabasePath, MEDIA_ROOT: blockedMediaRoot },
    encoding: "utf8",
  });
  assert.notEqual(blockedWorker.status, 0, "the media worker must fail closed while a restore marker exists");
  assert.equal(readFileSync(blockedPublicSentinel, "utf8"), "keep-blocked");

  const restoredDatabasePath = path.join(directory, "restored.sqlite");
  const restoredMediaRoot = path.join(directory, "restored-media");
  const restore = spawnSync(process.execPath, [path.join(root, "scripts/media-restore.mjs"), "--snapshot", snapshot.path], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: restoredDatabasePath, MEDIA_ROOT: restoredMediaRoot, RESTORE_CONFIRM: "1" },
    encoding: "utf8",
  });
  assert.equal(restore.status, 0, restore.stderr);
  const restoredDatabase = new BetterSqlite3(restoredDatabasePath, { readonly: true });
  assert.ok(restoredDatabase.prepare("SELECT replayed_at FROM deletion_tombstones WHERE id = 'restore-test'").get().replayed_at);
  restoredDatabase.close();
  assert.equal(existsSync(path.join(restoredMediaRoot, "public", "restore-test", "asset", "320.webp")), false, "restore must replay pending deletion tombstones");
  assert.equal(existsSync(path.join(restoredMediaRoot, "private", "quarantine", secondPublicKey)), true, "restore must keep hidden media quarantined");
  assert.equal(existsSync(path.join(directory, ".restored-media.restore-in-progress")), false, "successful restore must clear its durable marker");
  const queue = journal.listJournalModerationQueue("admin");
  assert.ok(queue.entries.some((entry) => entry.id === second.id && String(entry.report_reasons).includes("privacy")));
  assert.ok(queue.users.some((user) => user.id === "owner" && user.governance_status === "normal"));
  assert.ok(queue.audit.length > 0);
  assert.throws(() => journal.setUserGovernance("admin", "admin", { status: "banned", reason: "self lock" }), (error) => error.code === "ADMIN_SELF_LOCK");
  const insertSearchUser = sqlite.prepare('INSERT INTO "user" (id, name, emailVerified) VALUES (?, ?, 1)');
  for (let index = 0; index < 505; index += 1) insertSearchUser.run(`search-user-${String(index).padStart(3, "0")}`, `Search user ${index}`);
  const searchedUsers = journal.listGovernanceUsers("admin", "search-user-504");
  assert.equal(searchedUsers.length, 1);
  assert.equal(searchedUsers[0].id, "search-user-504", "server-side account search must reach users beyond the first page");

  const galleryDraft = journal.createJournalEntry("gallery", { title: "六图札记" });
  const galleryBatch = await batch("gallery", galleryDraft.id);
  const galleryAssetIds = [];
  for (let position = 0; position < 6; position += 1) {
    const queuedImage = await journal.uploadJournalAsset("gallery", galleryDraft.id, await jpegFile(`gallery-${position}.jpg`), { uploadId: galleryBatch.uploadId, position });
    galleryAssetIds.push(queuedImage.uploadedAssetId);
  }
  for (const assetId of galleryAssetIds) await waitForAsset("gallery", galleryDraft.id, assetId, "ready");
  assert.equal(journal.getOwnedJournalEntry("gallery", galleryDraft.id).images.length, 6);
  const reversedGalleryIds = [...galleryAssetIds].reverse();
  journal.updateJournalAssetOrder("gallery", galleryDraft.id, { imageIds: reversedGalleryIds });
  assert.deepEqual(journal.getOwnedJournalEntry("gallery", galleryDraft.id).images.map((image) => image.id), reversedGalleryIds);
  const galleryReplaceBatch = await batch("gallery", galleryDraft.id);
  await journal.replaceJournalAsset("gallery", galleryDraft.id, reversedGalleryIds[0], await jpegFile("gallery-replace.jpg"), { uploadId: galleryReplaceBatch.uploadId });
  await waitForAsset("gallery", galleryDraft.id, reversedGalleryIds[0], "ready");
  for (const assetId of reversedGalleryIds.slice(3)) journal.deleteJournalAsset("gallery", galleryDraft.id, assetId);
  const threeImageGallery = journal.getOwnedJournalEntry("gallery", galleryDraft.id);
  assert.equal(threeImageGallery.images.length, 3);
  journal.updateJournalEntry("gallery", galleryDraft.id, {
    title: "三图札记",
    baseRevision: threeImageGallery.revision,
    images: threeImageGallery.images.map((image, position) => ({ id: image.id, position, caption: "", alt: `第 ${position + 1} 张图片`, decorative: false })),
  });
  const galleryPublished = journal.publishJournalEntry("gallery", galleryDraft.id);
  const galleryPublicPath = path.join(process.env.MEDIA_ROOT, "public", sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public' LIMIT 1").get(sqlite.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ?").get(galleryDraft.id).published_revision_id).storage_key);
  assert.equal(galleryPublished.images.length, 3);
  assert.equal(existsSync(galleryPublicPath), true);
  journal.unpublishJournalEntry("gallery", galleryDraft.id);
  assert.equal(existsSync(galleryPublicPath), false, "unpublish must invalidate the public media path immediately");

  const removalDraft = journal.createJournalEntry("reader-4", { title: "永久下架测试" });
  const removalBatch = await batch("reader-4", removalDraft.id);
  const removalQueued = await journal.uploadJournalAsset("reader-4", removalDraft.id, await jpegFile("removal.jpg"), { uploadId: removalBatch.uploadId });
  const { entry: removalReady } = await waitForAsset("reader-4", removalDraft.id, removalQueued.uploadedAssetId, "ready");
  journal.updateJournalEntry("reader-4", removalDraft.id, {
    baseRevision: removalReady.revision,
    images: [{ id: removalReady.images[0].id, position: 0, caption: "", alt: "下架测试图片", decorative: false }],
  });
  journal.publishJournalEntry("reader-4", removalDraft.id);
  const removalRevision = sqlite.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ?").get(removalDraft.id).published_revision_id;
  const removalPublicKey = sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public' LIMIT 1").get(removalRevision).storage_key;
  const removalPrivateKey = sqlite.prepare("SELECT storage_key FROM journal_asset_variants WHERE asset_id = ? AND scope = 'private' LIMIT 1").get(removalReady.images[0].id).storage_key;
  journal.createJournalReport("reader-2", { entryId: removalDraft.id, reason: "privacy" });
  const removalQuarantine = path.join(process.env.MEDIA_ROOT, "private", "quarantine", removalPublicKey);
  assert.equal(existsSync(removalQuarantine), true);
  journal.moderateJournalTarget("admin", { targetType: "entry", targetId: removalDraft.id, action: "remove", reason: "confirmed" });
  assert.equal(existsSync(removalQuarantine), false, "permanent removal must clear quarantined public media");
  assert.equal(existsSync(path.join(process.env.MEDIA_ROOT, "private", removalPrivateKey)), false, "permanent removal must clear private variants");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_asset_variants WHERE asset_id = ?").get(removalReady.images[0].id).count, 0);

  const blocked = journal.createJournalEntry("reader", { title: "上传限制测试" });
  sqlite.prepare("INSERT INTO user_governance (user_id, status, reason, updated_at) VALUES (?, 'no_upload', '', ?)").run("reader", Date.now());
  await assert.rejects(() => batch("reader", blocked.id), (error) => error.code === "UPLOAD_BLOCKED");
  sqlite.prepare("UPDATE user_governance SET status = 'normal' WHERE user_id = 'reader'").run();
  sqlite.prepare("INSERT INTO journal_daily_usage (user_id, usage_day, upload_count) VALUES (?, ?, 20)").run("reader", new Date().toISOString().slice(0, 10));
  const quotaBatch = await batch("reader", blocked.id);
  const quotaFile = await jpegFile("quota.jpg");
  await assert.rejects(() => journal.uploadJournalAsset("reader", blocked.id, quotaFile, { uploadId: quotaBatch.uploadId }), (error) => error.code === "UPLOAD_QUOTA");

  assert.throws(() => journal.createContentComplaint({ kind: "privacy", targetUrl: "https://example.com/journal/nope", details: "not local" }), (error) => error.code === "INVALID_COMPLAINT_TARGET");
  const complaint = journal.createContentComplaint({ kind: "copyright", targetUrl: `http://localhost/journal/${draft.id}/`, details: "版权说明" });
  journal.moderateJournalTarget("admin", { targetType: "complaint", targetId: complaint.id, action: "resolved", reason: "handled" });
  assert.equal(sqlite.prepare("SELECT status FROM content_complaints WHERE id = ?").get(complaint.id).status, "resolved");

  journal.recordAggregateEvent({ event: "quiz_visual_helpfulness", quizId: "animal-personality", visualKey: "type:quiet", helpful: true });
  assert.equal(sqlite.prepare("SELECT event_count FROM aggregate_events WHERE event_name = 'quiz_visual_helpfulness'").get().event_count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM aggregate_events WHERE event_name = 'quiz_visual_helpfulness'").get().count, 1);
  assert.equal(sqlite.prepare("PRAGMA table_info(aggregate_events)").all().some((column) => /user|ip|attempt|result/i.test(column.name)), false);

  journal.prepareJournalUserDeletion("owner");
  assert.equal(existsSync(currentPublicPath), false, "account deletion preparation must fail closed by quarantining public media");
  sqlite.prepare("UPDATE deletion_tombstones SET deleted_at = ? WHERE entity_type = 'pending_user_media' AND entity_id = 'owner'")
    .run(Date.now() - (10 * 60_000));
  const mediaOperationLockPath = path.join(process.env.MEDIA_ROOT, "tmp", ".media-operation-lock");
  await stopWorker(worker);
  worker = startWorker();
  await waitForCondition(
    () => existsSync(currentPublicPath)
      && sqlite.prepare("SELECT COUNT(*) AS count FROM deletion_tombstones WHERE entity_type = 'pending_user_media' AND entity_id = 'owner'").get().count === 0
      && !existsSync(mediaOperationLockPath),
    "media worker did not recover a stale account-deletion preparation for an existing user",
  );
  await stopWorker(worker);
  worker = undefined;

  journal.deleteJournalEntry("owner", draft.id);
  assert.throws(() => journal.getPublishedJournalEntry(draft.id, null), (error) => error.code === "PUBLIC_JOURNAL_NOT_FOUND");
  assert.equal(existsSync(publicPath), false);
  assert.ok(sqlite.prepare("SELECT COUNT(*) AS count FROM deletion_tombstones WHERE entity_id = ?").get(draft.id).count > 0);
  assert.ok(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_revisions WHERE entry_id = ?").get(draft.id).count >= 2, "public revisions remain immutable records until account deletion");
  assert.ok(sqlite.prepare("SELECT COUNT(*) AS count FROM moderation_audit_log").get().count >= 3);
  const processingAssetDraft = journal.createJournalEntry("reader-2", { title: "处理中图片删除" });
  const processingAssetBatch = await batch("reader-2", processingAssetDraft.id);
  const processingAssetEntry = await journal.uploadJournalAsset("reader-2", processingAssetDraft.id, await jpegFile("processing-asset.jpg"), { uploadId: processingAssetBatch.uploadId });
  const processingAssetId = processingAssetEntry.uploadedAssetId;
  const processingAssetJob = sqlite.prepare("SELECT id, tmp_storage_key FROM journal_jobs WHERE asset_id = ? AND status = 'queued'").get(processingAssetId);
  const processingAssetTmp = path.join(process.env.MEDIA_ROOT, "tmp", processingAssetJob.tmp_storage_key);
  assert.equal(existsSync(processingAssetTmp), true);
  journal.deleteJournalAsset("reader-2", processingAssetDraft.id, processingAssetId);
  assert.equal(existsSync(processingAssetTmp), false, "deleting a processing asset must remove its queued original");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_jobs WHERE id = ?").get(processingAssetJob.id).count, 0);

  const processingEntryDraft = journal.createJournalEntry("reader-3", { title: "处理中札记删除" });
  const processingEntryBatch = await batch("reader-3", processingEntryDraft.id);
  await journal.uploadJournalAsset("reader-3", processingEntryDraft.id, await jpegFile("processing-entry.jpg"), { uploadId: processingEntryBatch.uploadId });
  const processingEntryJob = sqlite.prepare("SELECT id, tmp_storage_key FROM journal_jobs WHERE entry_id = ? AND status = 'queued'").get(processingEntryDraft.id);
  const processingEntryTmp = path.join(process.env.MEDIA_ROOT, "tmp", processingEntryJob.tmp_storage_key);
  journal.deleteJournalEntry("reader-3", processingEntryDraft.id);
  assert.equal(existsSync(processingEntryTmp), false, "deleting a processing entry must remove every queued original");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_jobs WHERE id = ?").get(processingEntryJob.id).count, 0);

  const pendingTmpKey = "uploads/account-delete.upload";
  const pendingTmpPath = path.join(process.env.MEDIA_ROOT, "tmp", pendingTmpKey);
  mkdirSync(path.dirname(pendingTmpPath), { recursive: true });
  writeFileSync(pendingTmpPath, "pending upload");
  sqlite.prepare(`
    INSERT INTO journal_jobs (id, user_id, entry_id, asset_id, kind, status, tmp_storage_key, available_at, created_at)
    VALUES ('account-delete-job', 'owner', ?, NULL, 'process_upload', 'queued', ?, ?, ?)
  `).run(second.id, pendingTmpKey, Date.now() + 60_000, Date.now());
  const preparedDeletion = journal.prepareJournalUserDeletion("owner");
  assert.ok(preparedDeletion.privateFiles + preparedDeletion.publicFiles + preparedDeletion.tmpFiles > 0);
  assert.equal(preparedDeletion.tmpFiles, 1);
  assert.ok(sqlite.prepare("SELECT COUNT(*) AS count FROM deletion_tombstones WHERE entity_type = 'pending_user_media' AND entity_id = 'owner' AND replayed_at IS NULL").get().count > 0);
  journal.replayJournalDeletionTombstones();
  assert.equal(existsSync(secondQuarantinePath), true, "a prepared but uncommitted account deletion must not remove media");
  assert.equal(existsSync(pendingTmpPath), true, "pending account-deletion tombstones must not remove queued uploads");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_jobs WHERE id = 'account-delete-job'").get().count, 1);
  journal.deleteJournalUserData("owner");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE user_id = 'owner'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM journal_assets WHERE user_id = 'owner'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM deletion_tombstones WHERE entity_type = 'user_media' AND entity_id = 'owner' AND replayed_at IS NULL").get().count, 0);
  assert.equal(existsSync(secondQuarantinePath), false, "account deletion must remove media held in private quarantine");
  assert.equal(existsSync(pendingTmpPath), false, "account deletion must replay queued upload tmp tombstones");
} finally {
  await stopWorker(worker);
  globalThis.__knowYourselfDatabase?.close();
  globalThis.__knowYourselfDatabase = undefined;
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log("✓ Journal backend enforces ownership, verified uploads, media sanitization, immutable publishing, quotas, moderation, complaints, and deletion");
