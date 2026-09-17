import "server-only";

import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { asRow, getDatabase, withTransaction } from "./database";
import { assertAccountCanUpload, assertAccountCanWrite, assertAdmin, getGovernanceStatus } from "./governance";

export const JOURNAL_LIMITS = {
  title: 120,
  body: 12_000,
  caption: 500,
  altText: 500,
  comment: 1_000,
  reportDetails: 2_000,
  images: 6,
  fileBytes: 8 * 1024 * 1024,
  pixels: 25_000_000,
  dailyUploads: 20,
  dailyPublishes: 3,
  totalBytes: 250 * 1024 * 1024,
  pageSize: 20,
} as const;

const VARIANT_WIDTHS = [320, 960, 1600] as const;
const HIGH_RISK_REASONS = new Set(["illegal", "minor_sexual", "nonconsensual_intimate", "privacy", "explicit_harm"]);
const REPORT_REASONS = new Set([...HIGH_RISK_REASONS, "spam", "abuse", "sexual", "copyright", "other"]);
const USER_STATUSES = new Set(["normal", "no_upload", "read_only", "suspended", "banned"]);
const DEFAULT_MEDIA_ROOT = process.env.NODE_ENV === "production"
  ? "/var/lib/quiz-platform/media"
  : resolve(process.cwd(), ".data", "media");

export type JournalStatus = "draft" | "processing" | "published" | "hidden" | "unpublished" | "deleted";
export type GovernanceStatus = "normal" | "no_upload" | "read_only" | "suspended" | "banned";

type DatabaseRow = Record<string, unknown>;

export class JournalError extends Error {
  constructor(message: string, public readonly code = "INVALID_DATA", public readonly status = 400) {
    super(message);
    this.name = "JournalError";
  }
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
}

function day(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function text(value: unknown, max: number, required = false) {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new JournalError("内容格式无效");
  }
  const normalized = value.trim().replace(/\r\n?/g, "\n");
  const length = Array.from(normalized).length;
  if ((required && length === 0) || length > max) {
    throw new JournalError(required ? `内容需要为 1 至 ${max} 个字符` : `内容不能超过 ${max} 个字符`);
  }
  return normalized;
}

function optionalText(value: unknown, max: number, fallback: string) {
  return value === undefined ? fallback : text(value, max);
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JournalError("请求格式无效");
  return value as Record<string, unknown>;
}

export function journalMediaRoot() {
  const configured = process.env.MEDIA_ROOT?.trim();
  if (!configured) return DEFAULT_MEDIA_ROOT;
  return isAbsolute(configured) ? configured : `${process.cwd()}${sep}${configured}`;
}

function storagePath(scope: "private" | "public" | "tmp", storageKey = "") {
  const base = resolve(journalMediaRoot(), scope);
  const target = resolve(base, storageKey);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new JournalError("媒体路径无效", "INVALID_MEDIA_PATH");
  return target;
}

function mediaRestoreMarkerPath() {
  const mediaRoot = journalMediaRoot();
  return join(dirname(mediaRoot), `.${basename(mediaRoot)}.restore-in-progress`);
}

export function prepareJournalMediaDirectories() {
  if (existsSync(mediaRestoreMarkerPath())) {
    throw new JournalError("媒体恢复尚未完成，请先完成恢复或回滚", "MEDIA_RESTORE_INCOMPLETE", 503);
  }
  for (const scope of ["private", "public", "tmp"] as const) mkdirSync(storagePath(scope), { recursive: true, mode: 0o750 });
  mkdirSync(storagePath("private", "quarantine"), { recursive: true, mode: 0o750 });
  chmodSync(journalMediaRoot(), 0o711);
  if (journalMediaRoot() === "/var/lib/quiz-platform/media") chmodSync(resolve(journalMediaRoot(), ".."), 0o711);
  chmodSync(storagePath("private"), 0o750);
  chmodSync(storagePath("tmp"), 0o750);
  chmodSync(storagePath("public"), 0o755);
}

let mediaLockDepth = 0;

function withJournalMediaLock<T>(callback: () => T) {
  if (mediaLockDepth) return callback();
  prepareJournalMediaDirectories();
  const lockPath = storagePath("tmp", ".media-operation-lock");
  try { mkdirSync(lockPath); }
  catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") {
      throw new JournalError("媒体服务正在执行一致性维护，请稍后重试", "MEDIA_BUSY", 503);
    }
    throw cause;
  }
  mediaLockDepth += 1;
  try { return callback(); }
  finally {
    mediaLockDepth -= 1;
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function ownerEntry(userId: string, entryId: string, includeDeleted = false) {
  const row = asRow(getDatabase().prepare(`
    SELECT * FROM journal_entries WHERE id = ? AND user_id = ? ${includeDeleted ? "" : "AND status <> 'deleted'"}
  `).get(entryId, userId));
  if (!row) throw new JournalError("没有找到这篇札记", "JOURNAL_NOT_FOUND", 404);
  return row;
}

function userRow(userId: string) {
  const row = asRow(getDatabase().prepare('SELECT id, name, emailVerified FROM "user" WHERE id = ?').get(userId));
  if (!row) throw new JournalError("请先登录", "UNAUTHORIZED", 401);
  return row;
}

function governanceStatus(userId: string): GovernanceStatus {
  return getGovernanceStatus(userId);
}

function assertVerifiedUser(userId: string, action: "read" | "write" | "upload" | "publish" = "write") {
  const user = userRow(userId);
  if (!Boolean(user.emailVerified)) throw new JournalError("请先验证邮箱", "EMAIL_NOT_VERIFIED", 403);
  const status = governanceStatus(userId);
  if (status === "banned" || status === "suspended") throw new JournalError("账号当前不可使用图像札记", "ACCOUNT_RESTRICTED", 403);
  if (action === "upload") assertAccountCanUpload(userId);
  else if (action !== "read") assertAccountCanWrite(userId);
  return { user, status };
}

function usage(userId: string, now = Date.now()) {
  const database = getDatabase();
  const current = asRow(database.prepare("SELECT upload_count, publish_count, uploaded_bytes FROM journal_daily_usage WHERE user_id = ? AND usage_day = ?").get(userId, day(now)));
  const total = asRow(database.prepare(`
    SELECT
      COALESCE((SELECT SUM(source_bytes) FROM journal_assets WHERE user_id = ? AND status = 'processing'), 0) +
      COALESCE((SELECT SUM(v.byte_size) FROM journal_asset_variants v JOIN journal_assets a ON a.id = v.asset_id WHERE a.user_id = ?), 0)
      AS bytes
  `).get(userId, userId));
  return {
    uploads: Number(current?.upload_count ?? 0),
    publishes: Number(current?.publish_count ?? 0),
    uploadedBytesToday: Number(current?.uploaded_bytes ?? 0),
    totalBytes: Number(total?.bytes ?? 0),
  };
}

export function getJournalViewer(userId: string) {
  const user = userRow(userId);
  const current = usage(userId);
  return {
    emailVerified: Boolean(user.emailVerified),
    accountStatus: governanceStatus(userId) === "no_upload" ? "upload_blocked" : governanceStatus(userId),
    uploadRemaining: Math.max(0, JOURNAL_LIMITS.dailyUploads - current.uploads),
    publishRemaining: Math.max(0, JOURNAL_LIMITS.dailyPublishes - current.publishes),
    mediaBytesUsed: current.totalBytes,
    mediaBytesLimit: JOURNAL_LIMITS.totalBytes,
  };
}

function assetUrl(scope: "private" | "public", assetId: string, width: number, revisionId = "") {
  if (scope === "private") return `/api/journal/media/private/${assetId}/${width}`;
  return process.env.NODE_ENV === "production"
    ? `/media/public/${revisionId}/${assetId}/${width}.webp`
    : `/api/journal/media/public/${revisionId}/${assetId}/${width}`;
}

function entryAssets(entryId: string, revisionId = "") {
  const database = getDatabase();
  const rows = revisionId
    ? database.prepare(`
      SELECT ra.*, a.width, a.height FROM journal_revision_assets ra
      JOIN journal_assets a ON a.id = ra.asset_id
      WHERE ra.revision_id = ? ORDER BY ra.position ASC
    `).all(revisionId) as DatabaseRow[]
    : database.prepare(`
      SELECT ea.*, a.width, a.height, a.status FROM journal_entry_assets ea
      JOIN journal_assets a ON a.id = ea.asset_id
      WHERE ea.entry_id = ? ORDER BY ea.position ASC
    `).all(entryId) as DatabaseRow[];
  return rows.map((row) => {
    const assetId = String(row.asset_id);
    const scope = revisionId ? "public" as const : "private" as const;
    const variantRows = getDatabase().prepare(`
      SELECT requested_width, width, height FROM journal_asset_variants
      WHERE asset_id = ? AND revision_id = ? AND scope = ? ORDER BY requested_width
    `).all(assetId, revisionId, scope) as DatabaseRow[];
    const variantNames = new Map([[320, "thumb"], [960, "medium"], [1600, "large"]]);
    const variants = Object.fromEntries(variantRows.map((variant) => {
      const requestedWidth = Number(variant.requested_width);
      return [variantNames.get(requestedWidth), {
        src: assetUrl(scope, assetId, requestedWidth, revisionId),
        width: Number(variant.width),
        height: Number(variant.height),
      }];
    }).filter(([name]) => Boolean(name)));
    const storedStatus = String(row.status ?? "ready");
    const latestJob = revisionId ? null : asRow(getDatabase().prepare(`
      SELECT status, error FROM journal_jobs WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(assetId));
    const assetStatus = revisionId || storedStatus === "ready"
      ? "ready"
      : storedStatus === "failed"
        ? "failed"
        : latestJob?.status === "queued" ? "queued" : "processing";
    return {
      id: assetId,
      position: Number(row.position),
      caption: String(row.caption ?? ""),
      alt: String(row.alt_text ?? ""),
      decorative: Boolean(row.decorative),
      width: Number(row.width ?? 0),
      height: Number(row.height ?? 0),
      status: assetStatus,
      variants,
      error: storedStatus === "failed" ? String(latestJob?.error ?? "图片处理失败，请重新选择文件上传") : undefined,
    };
  });
}

function publicRevisionNumber(revisionId: string) {
  if (!revisionId) return 0;
  return Number(asRow(getDatabase().prepare("SELECT revision_number FROM journal_revisions WHERE id = ?").get(revisionId))?.revision_number ?? 0);
}

function ownedEntryPayload(row: DatabaseRow) {
  const revisionId = typeof row.published_revision_id === "string" ? row.published_revision_id : "";
  const images = entryAssets(String(row.id));
  const publicRevision = publicRevisionNumber(revisionId);
  const publishedDraftRevision = revisionId
    ? Number(asRow(getDatabase().prepare("SELECT draft_revision FROM journal_revisions WHERE id = ?").get(revisionId))?.draft_revision ?? 0)
    : 0;
  return {
    id: String(row.id),
    ownerId: String(row.user_id),
    title: String(row.title),
    body: String(row.body),
    excerpt: String(row.body).replace(/\s+/gu, " ").trim().slice(0, 150),
    contentLanguage: String(row.content_language),
    allowComments: Boolean(row.allow_comments),
    status: String(row.status) as JournalStatus,
    images,
    cover: images[0],
    imageCount: images.length,
    isOwner: true,
    reactionCount: 0,
    commentCount: 0,
    reacted: false,
    comments: [],
    hasUnpublishedChanges: !revisionId || String(row.status) === "unpublished" || Number(row.draft_revision ?? 0) > publishedDraftRevision,
    revision: Number(row.draft_revision ?? 0),
    publicRevision,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    publishedAt: row.published_at === null ? undefined : Number(row.published_at),
  };
}

export function listOwnedJournalEntries(userId: string) {
  assertVerifiedUser(userId, "read");
  return (getDatabase().prepare("SELECT * FROM journal_entries WHERE user_id = ? AND status <> 'deleted' ORDER BY updated_at DESC").all(userId) as DatabaseRow[]).map(ownedEntryPayload);
}

export function getOwnedJournalEntry(userId: string, entryId: string) {
  assertVerifiedUser(userId, "read");
  return ownedEntryPayload(ownerEntry(userId, entryId));
}

export function getJournalEntryForViewer(viewerId: string | null, entryId: string, viewDraft = false) {
  const owner = viewerId ? asRow(getDatabase().prepare("SELECT 1 AS found FROM journal_entries WHERE id = ? AND user_id = ? AND status <> 'deleted'").get(entryId, viewerId)) : null;
  if (owner && viewDraft) return getOwnedJournalEntry(viewerId as string, entryId);
  try { return getPublishedJournalEntry(entryId, viewerId); }
  catch (cause) {
    if (owner && cause instanceof JournalError && cause.code === "PUBLIC_JOURNAL_NOT_FOUND") return getOwnedJournalEntry(viewerId as string, entryId);
    throw cause;
  }
}

export function createJournalEntry(userId: string, value: unknown) {
  assertVerifiedUser(userId);
  const input = object(value);
  const now = Date.now();
  const entryId = id("journal");
  const language = text(input.contentLanguage ?? "zh", 16, true);
  getDatabase().prepare(`
    INSERT INTO journal_entries (id, user_id, title, body, content_language, allow_comments, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(entryId, userId, text(input.title, JOURNAL_LIMITS.title), text(input.body, JOURNAL_LIMITS.body), language, bool(input.allowComments, true) ? 1 : 0, now, now);
  return getOwnedJournalEntry(userId, entryId);
}

export function updateJournalEntry(userId: string, entryId: string, value: unknown) {
  assertVerifiedUser(userId);
  const input = object(value);
  const current = ownerEntry(userId, entryId);
  if (String(current.status) === "hidden") throw new JournalError("这篇札记正在审核中", "JOURNAL_HIDDEN", 409);
  if (input.baseRevision !== undefined && (!Number.isInteger(input.baseRevision) || Number(input.baseRevision) !== Number(current.draft_revision ?? 0))) {
    throw new JournalError("草稿已在其他页面更新，请刷新后重试", "DRAFT_CONFLICT", 409);
  }
  const title = optionalText(input.title, JOURNAL_LIMITS.title, String(current.title));
  const body = optionalText(input.body, JOURNAL_LIMITS.body, String(current.body));
  const language = optionalText(input.contentLanguage, 16, String(current.content_language));
  const now = Date.now();
  withTransaction(() => {
    const database = getDatabase();
    if (input.images !== undefined) {
      if (!Array.isArray(input.images) || input.images.length > JOURNAL_LIMITS.images) throw new JournalError("图片信息无效");
      const imagesInput = input.images;
      const imageInputs = imagesInput.map((item) => {
        const image = object(item);
        const assetId = typeof image.id === "string" ? image.id : "";
        const position = Number(image.position);
        if (!assetId || !Number.isInteger(position) || position < 0 || position >= imagesInput.length) throw new JournalError("图片信息无效");
        return {
          assetId,
          position,
          caption: text(image.caption, JOURNAL_LIMITS.caption),
          alt: text(image.alt, JOURNAL_LIMITS.altText),
          decorative: bool(image.decorative, false),
        };
      });
      const existing = (database.prepare("SELECT asset_id FROM journal_entry_assets WHERE entry_id = ?").all(entryId) as DatabaseRow[]).map((row) => String(row.asset_id));
      if (existing.length !== imageInputs.length || existing.some((assetId) => !imageInputs.some((image) => image.assetId === assetId))) {
        throw new JournalError("图片信息与当前札记不一致", "ASSET_MISMATCH", 409);
      }
      database.prepare("UPDATE journal_entry_assets SET position = position + 100 WHERE entry_id = ?").run(entryId);
      const updateAsset = database.prepare("UPDATE journal_entry_assets SET position = ?, caption = ?, alt_text = ?, decorative = ? WHERE entry_id = ? AND asset_id = ?");
      for (const image of imageInputs) updateAsset.run(image.position, image.caption, image.alt, image.decorative ? 1 : 0, entryId, image.assetId);
    }
    database.prepare(`
      UPDATE journal_entries SET title = ?, body = ?, content_language = ?, allow_comments = ?,
        draft_revision = draft_revision + 1, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(title, body, language, bool(input.allowComments, Boolean(current.allow_comments)) ? 1 : 0, now, entryId, userId);
  });
  const updated = ownerEntry(userId, entryId);
  const payload = ownedEntryPayload(updated);
  return { revision: payload.revision, updatedAt: payload.updatedAt, hasUnpublishedChanges: payload.hasUnpublishedChanges };
}

export async function verifyJournalTurnstile(token: unknown, remoteIp: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) throw new JournalError("上传验证服务尚未配置", "TURNSTILE_NOT_CONFIGURED", 503);
  if (typeof token !== "string" || !token.trim()) throw new JournalError("请完成人机验证", "TURNSTILE_REQUIRED", 400);
  const body = new URLSearchParams({ secret, response: token.trim() });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    result = await response.json() as { success?: boolean; action?: string; hostname?: string };
  } catch {
    throw new JournalError("暂时无法验证上传请求", "TURNSTILE_UNAVAILABLE", 503);
  }
  const configuredHosts = process.env.TURNSTILE_ALLOWED_HOSTNAMES?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const allowedHosts = new Set(configuredHosts?.length
    ? configuredHosts
    : process.env.NODE_ENV === "production" ? ["knowyourself.cc.cd"] : ["localhost", "127.0.0.1", "knowyourself.cc.cd"]);
  if (!result.success || result.action !== "journal_upload" || !result.hostname || !allowedHosts.has(result.hostname.toLowerCase())) {
    throw new JournalError("人机验证已失效，请重试", "TURNSTILE_FAILED", 400);
  }
}

export async function createJournalUploadBatch(userId: string, entryId: string, turnstileToken: unknown, remoteIp: string) {
  assertVerifiedUser(userId, "upload");
  ownerEntry(userId, entryId);
  await verifyJournalTurnstile(turnstileToken, remoteIp);
  const now = Date.now();
  const uploadId = id("upload");
  getDatabase().prepare("DELETE FROM journal_upload_batches WHERE expires_at <= ?").run(now);
  getDatabase().prepare(`
    INSERT INTO journal_upload_batches (id, user_id, entry_id, remaining_assets, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uploadId, userId, entryId, JOURNAL_LIMITS.images, now, now + 10 * 60_000);
  return { uploadId, expiresAt: now + 10 * 60_000 };
}

function consumeUploadBatch(userId: string, entryId: string, uploadId: string) {
  const now = Date.now();
  const result = getDatabase().prepare(`
    UPDATE journal_upload_batches SET remaining_assets = remaining_assets - 1
    WHERE id = ? AND user_id = ? AND entry_id = ? AND expires_at > ? AND remaining_assets > 0
  `).run(uploadId, userId, entryId, now);
  if (!result.changes) throw new JournalError("上传授权已失效，请重新验证", "UPLOAD_BATCH_EXPIRED", 409);
}

function sniffMime(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function normalizeAssetMetadata(value: { caption?: unknown; altText?: unknown; decorative?: unknown }) {
  const decorative = value.decorative === true || value.decorative === "true" || value.decorative === "1";
  const altText = text(value.altText, JOURNAL_LIMITS.altText);
  return { caption: text(value.caption, JOURNAL_LIMITS.caption), altText, decorative };
}

async function validateUploadEnvelope(file: File) {
  if (!(file instanceof File) || file.size <= 0) throw new JournalError("请选择图片", "FILE_REQUIRED");
  if (file.size > JOURNAL_LIMITS.fileBytes) throw new JournalError("单张图片不能超过 8 MiB", "FILE_TOO_LARGE", 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = sniffMime(buffer);
  if (!detected || file.type !== detected) throw new JournalError("仅支持静态 JPEG、PNG 或 WebP 图片", "UNSUPPORTED_IMAGE");
  return { buffer, detected };
}

function reserveUpload(userId: string, entryId: string, uploadId: string, source: { mime: string; bytes: number }, metadata: ReturnType<typeof normalizeAssetMetadata> & { position?: unknown }, jobId: string, tmpStorageKey: string, replaceAssetId?: string) {
  return withTransaction(() => {
    assertVerifiedUser(userId, "upload");
    const entry = ownerEntry(userId, entryId);
    if (String(entry.status) === "hidden") throw new JournalError("这篇札记正在审核中", "JOURNAL_HIDDEN", 409);
    consumeUploadBatch(userId, entryId, uploadId);
    const currentUsage = usage(userId);
    if (currentUsage.uploads >= JOURNAL_LIMITS.dailyUploads) throw new JournalError("今天的上传次数已用完", "UPLOAD_QUOTA", 429);
    const existingAsset = replaceAssetId ? asRow(getDatabase().prepare(`
      SELECT a.*, COALESCE((SELECT SUM(byte_size) FROM journal_asset_variants WHERE asset_id = a.id), 0) AS stored_bytes
      FROM journal_assets a JOIN journal_entry_assets ea ON ea.asset_id = a.id
      WHERE a.id = ? AND ea.entry_id = ? AND a.user_id = ? AND a.status IN ('ready', 'failed')
    `).get(replaceAssetId, entryId, userId)) : null;
    if (replaceAssetId && !existingAsset) throw new JournalError("没有找到要替换的图片", "ASSET_NOT_FOUND", 404);
    const replacedBytes = Number(existingAsset?.stored_bytes ?? 0);
    if (currentUsage.totalBytes - replacedBytes + source.bytes > JOURNAL_LIMITS.totalBytes) throw new JournalError("媒体空间已用完", "MEDIA_QUOTA", 413);
    const database = getDatabase();
    const assetId = replaceAssetId || id("asset");
    if (!replaceAssetId) {
      const count = Number(asRow(database.prepare("SELECT COUNT(*) AS count FROM journal_entry_assets WHERE entry_id = ?").get(entryId))?.count ?? 0);
      if (count >= JOURNAL_LIMITS.images) throw new JournalError("每篇札记最多可添加 6 张图片", "IMAGE_LIMIT");
      const requestedPosition = Number(metadata.position);
      const position = Number.isInteger(requestedPosition) && requestedPosition >= 0 && requestedPosition <= count ? requestedPosition : count;
      database.prepare("UPDATE journal_entry_assets SET position = position + 100 WHERE entry_id = ? AND position >= ?").run(entryId, position);
      database.prepare("UPDATE journal_entry_assets SET position = position - 99 WHERE entry_id = ? AND position >= 100").run(entryId);
      database.prepare("INSERT INTO journal_assets (id, user_id, source_mime, source_bytes, status, created_at) VALUES (?, ?, ?, ?, 'processing', ?)")
        .run(assetId, userId, source.mime, source.bytes, Date.now());
      database.prepare("INSERT INTO journal_entry_assets (entry_id, asset_id, position, caption, alt_text, decorative) VALUES (?, ?, ?, ?, ?, ?)")
        .run(entryId, assetId, position, metadata.caption, metadata.altText, metadata.decorative ? 1 : 0);
    } else {
      database.prepare("UPDATE journal_assets SET source_mime = ?, source_bytes = ?, width = NULL, height = NULL, sha256 = NULL, status = 'processing', ready_at = NULL WHERE id = ?")
        .run(source.mime, source.bytes, assetId);
      database.prepare("UPDATE journal_entry_assets SET caption = ?, alt_text = ?, decorative = ? WHERE entry_id = ? AND asset_id = ?")
        .run(metadata.caption, metadata.altText, metadata.decorative ? 1 : 0, entryId, assetId);
    }
    database.prepare(`
      INSERT INTO journal_jobs (id, user_id, entry_id, asset_id, kind, status, tmp_storage_key, available_at, created_at)
      VALUES (?, ?, ?, ?, 'process_upload', 'queued', ?, ?, ?)
    `).run(jobId, userId, entryId, assetId, tmpStorageKey, Date.now(), Date.now());
    database.prepare(`
      INSERT INTO journal_daily_usage (user_id, usage_day, upload_count, publish_count, uploaded_bytes)
      VALUES (?, ?, 1, 0, ?)
      ON CONFLICT(user_id, usage_day) DO UPDATE SET
        upload_count = upload_count + 1,
        uploaded_bytes = uploaded_bytes + excluded.uploaded_bytes
    `).run(userId, day(), source.bytes);
    database.prepare(`
      UPDATE journal_entries SET status = CASE WHEN status = 'draft' THEN 'processing' ELSE status END,
        draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?
    `).run(Date.now(), entryId);
    return { assetId, jobId };
  });
}

async function queueJournalUpload(userId: string, entryId: string, file: File, input: { uploadId: string; caption?: unknown; altText?: unknown; decorative?: unknown; position?: unknown }, replaceAssetId?: string) {
  const metadata = { ...normalizeAssetMetadata(input), position: input.position };
  const validated = await validateUploadEnvelope(file);
  prepareJournalMediaDirectories();
  const jobId = id("job");
  const tmpStorageKey = `uploads/${randomBytes(24).toString("hex")}.upload`;
  const temporaryPath = storagePath("tmp", tmpStorageKey);
  mkdirSync(resolve(temporaryPath, ".."), { recursive: true, mode: 0o750 });
  writeFileSync(temporaryPath, validated.buffer, { flag: "wx", mode: 0o600 });
  let reserved: { assetId: string; jobId: string };
  try {
    reserved = reserveUpload(userId, entryId, input.uploadId, { mime: validated.detected, bytes: file.size }, metadata, jobId, tmpStorageKey, replaceAssetId);
  } catch (cause) {
    rmSync(temporaryPath, { force: true });
    throw cause;
  }
  return { ...getOwnedJournalEntry(userId, entryId), uploadedAssetId: reserved.assetId };
}

export function uploadJournalAsset(userId: string, entryId: string, file: File, input: { uploadId: string; caption?: unknown; altText?: unknown; decorative?: unknown; position?: unknown }) {
  return queueJournalUpload(userId, entryId, file, input);
}

export function replaceJournalAsset(userId: string, entryId: string, assetId: string, file: File, input: { uploadId: string; caption?: unknown; altText?: unknown; decorative?: unknown; position?: unknown }) {
  return queueJournalUpload(userId, entryId, file, input, assetId);
}

export function updateJournalAssetOrder(userId: string, entryId: string, value: unknown) {
  assertVerifiedUser(userId);
  ownerEntry(userId, entryId);
  const input = object(value);
  const requestedIds = input.imageIds ?? input.assetIds;
  if (!Array.isArray(requestedIds)) throw new JournalError("图片顺序无效");
  const assetIds = requestedIds.map((item) => typeof item === "string" ? item : "");
  if (!assetIds.length || assetIds.length > JOURNAL_LIMITS.images || new Set(assetIds).size !== assetIds.length || assetIds.some((item) => !item)) {
    throw new JournalError("图片顺序无效");
  }
  withTransaction(() => {
    const database = getDatabase();
    const rows = database.prepare("SELECT asset_id FROM journal_entry_assets WHERE entry_id = ? ORDER BY position").all(entryId) as DatabaseRow[];
    const existing = rows.map((row) => String(row.asset_id));
    if (existing.length !== assetIds.length || existing.some((assetId) => !assetIds.includes(assetId))) throw new JournalError("图片顺序与当前札记不一致", "ASSET_ORDER_MISMATCH", 409);
    database.prepare("UPDATE journal_entry_assets SET position = position + 100 WHERE entry_id = ?").run(entryId);
    const update = database.prepare("UPDATE journal_entry_assets SET position = ? WHERE entry_id = ? AND asset_id = ?");
    assetIds.forEach((assetId, position) => update.run(position, entryId, assetId));
    database.prepare("UPDATE journal_entries SET draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?").run(Date.now(), entryId);
  });
  return { revision: Number(ownerEntry(userId, entryId).draft_revision ?? 0) };
}

function recordTombstones(entityType: string, entityId: string, storageKeys: string[], scope: "private" | "public" | "" = "") {
  const insert = getDatabase().prepare("INSERT OR IGNORE INTO deletion_tombstones (id, entity_type, entity_id, storage_scope, storage_key, deleted_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const key of storageKeys) insert.run(id("tombstone"), entityType, entityId, scope, key, Date.now());
}

function removeFiles(scope: "private" | "public", keys: string[]) {
  for (const key of keys) {
    const targets = scope === "public"
      ? [storagePath("public", key), storagePath("private", `quarantine/${key}`)]
      : [storagePath("private", key)];
    let removed = true;
    for (const target of targets) {
      try { unlinkSync(target); } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) removed = false;
      }
    }
    if (removed) getDatabase().prepare("UPDATE deletion_tombstones SET replayed_at = ? WHERE storage_key = ? AND storage_scope IN ('', ?) AND replayed_at IS NULL").run(Date.now(), key, scope);
  }
}

function quarantineRevisionDirectory(revisionId: string) {
  if (!revisionId) return "missing" as const;
  prepareJournalMediaDirectories();
  const source = storagePath("public", revisionId);
  const destination = storagePath("private", `quarantine/${revisionId}`);
  try {
    renameSync(source, destination);
    return "moved" as const;
  }
  catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return existsSync(destination) ? "already-quarantined" as const : "missing" as const;
    }
    throw cause;
  }
}

function normalizePublicPermissions(directory: string) {
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) normalizePublicPermissions(target);
    else if (entry.isFile()) chmodSync(target, 0o644);
    else throw new JournalError("公开媒体目录包含无效文件", "INVALID_PUBLIC_MEDIA", 500);
  }
}

function activateRevisionDirectory(revisionId: string) {
  if (!revisionId) return;
  normalizePublicPermissions(storagePath("public", revisionId));
}

function restoreRevisionDirectory(revisionId: string, activate = true) {
  if (!revisionId) return;
  prepareJournalMediaDirectories();
  const source = storagePath("private", `quarantine/${revisionId}`);
  const destination = storagePath("public", revisionId);
  try {
    chmodSync(source, 0o700);
    renameSync(source, destination);
    if (activate) activateRevisionDirectory(revisionId);
  }
  catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      throw new JournalError("隔离的公开媒体不存在，无法恢复", "QUARANTINED_MEDIA_MISSING", 409);
    }
    throw cause;
  }
}

function deleteJournalAssetUnlocked(userId: string, entryId: string, assetId: string) {
  assertVerifiedUser(userId);
  ownerEntry(userId, entryId);
  const deletion = withTransaction(() => {
    const database = getDatabase();
    const asset = asRow(database.prepare(`
      SELECT a.id FROM journal_assets a JOIN journal_entry_assets ea ON ea.asset_id = a.id
      WHERE a.id = ? AND a.user_id = ? AND ea.entry_id = ?
    `).get(assetId, userId, entryId));
    if (!asset) throw new JournalError("没有找到要删除的图片", "ASSET_NOT_FOUND", 404);
    const variants = database.prepare("SELECT storage_key FROM journal_asset_variants WHERE asset_id = ? AND scope = 'private'").all(assetId) as DatabaseRow[];
    const storageKeys = variants.map((row) => String(row.storage_key));
    const tmpKeys = (database.prepare(`
      SELECT tmp_storage_key FROM journal_jobs
      WHERE asset_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running') AND tmp_storage_key <> ''
    `).all(assetId) as DatabaseRow[]).map((row) => `tmp/${String(row.tmp_storage_key)}`);
    recordTombstones("journal_asset", assetId, storageKeys, "private");
    recordTombstones("journal_asset", assetId, tmpKeys);
    database.prepare("DELETE FROM journal_jobs WHERE asset_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running')").run(assetId);
    database.prepare("DELETE FROM journal_entry_assets WHERE entry_id = ? AND asset_id = ?").run(entryId, assetId);
    database.prepare("UPDATE journal_assets SET status = 'deleted', deleted_at = ? WHERE id = ?").run(Date.now(), assetId);
    database.prepare("DELETE FROM journal_asset_variants WHERE asset_id = ? AND scope = 'private'").run(assetId);
    const remaining = database.prepare("SELECT asset_id FROM journal_entry_assets WHERE entry_id = ? ORDER BY position").all(entryId) as DatabaseRow[];
    database.prepare("UPDATE journal_entry_assets SET position = position + 100 WHERE entry_id = ?").run(entryId);
    const reposition = database.prepare("UPDATE journal_entry_assets SET position = ? WHERE entry_id = ? AND asset_id = ?");
    remaining.forEach((row, position) => reposition.run(position, entryId, String(row.asset_id)));
    database.prepare("UPDATE journal_entries SET draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?").run(Date.now(), entryId);
    return { storageKeys, tmpKeys };
  });
  removeFiles("private", deletion.storageKeys);
  replayJournalDeletionTombstonesUnlocked("journal_asset", assetId);
  return getOwnedJournalEntry(userId, entryId);
}

export function deleteJournalAsset(userId: string, entryId: string, assetId: string) {
  return withJournalMediaLock(() => deleteJournalAssetUnlocked(userId, entryId, assetId));
}

function publicVariantKeys(revisionId: string) {
  return (getDatabase().prepare("SELECT storage_key FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public'").all(revisionId) as DatabaseRow[])
    .map((row) => String(row.storage_key));
}

function removeAllEntryMedia(entryId: string) {
  const revisionIds = (getDatabase().prepare("SELECT id FROM journal_revisions WHERE entry_id = ?").all(entryId) as DatabaseRow[])
    .map((row) => String(row.id));
  const rows = getDatabase().prepare(`
    SELECT v.scope, v.storage_key FROM journal_asset_variants v
    WHERE v.asset_id IN (
      SELECT asset_id FROM journal_entry_assets WHERE entry_id = ?
      UNION SELECT ra.asset_id FROM journal_revision_assets ra JOIN journal_revisions r ON r.id = ra.revision_id WHERE r.entry_id = ?
    )
  `).all(entryId, entryId) as DatabaseRow[];
  const privateKeys = rows.filter((row) => row.scope === "private").map((row) => String(row.storage_key));
  const publicKeys = rows.filter((row) => row.scope === "public").map((row) => String(row.storage_key));
  const tmpKeys = (getDatabase().prepare(`
    SELECT tmp_storage_key FROM journal_jobs
    WHERE entry_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running') AND tmp_storage_key <> ''
  `).all(entryId) as DatabaseRow[]).map((row) => `tmp/${String(row.tmp_storage_key)}`);
  withTransaction(() => {
    recordTombstones("journal_entry", entryId, privateKeys, "private");
    recordTombstones("journal_entry", entryId, publicKeys, "public");
    recordTombstones("journal_entry", entryId, tmpKeys);
    getDatabase().prepare("DELETE FROM journal_jobs WHERE entry_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running')").run(entryId);
    getDatabase().prepare(`
      UPDATE journal_assets SET status = 'deleted', deleted_at = ? WHERE id IN (
        SELECT asset_id FROM journal_entry_assets WHERE entry_id = ?
        UNION SELECT ra.asset_id FROM journal_revision_assets ra JOIN journal_revisions r ON r.id = ra.revision_id WHERE r.entry_id = ?
      )
    `).run(Date.now(), entryId, entryId);
    getDatabase().prepare(`
      DELETE FROM journal_asset_variants WHERE asset_id IN (
        SELECT asset_id FROM journal_entry_assets WHERE entry_id = ?
        UNION SELECT ra.asset_id FROM journal_revision_assets ra JOIN journal_revisions r ON r.id = ra.revision_id WHERE r.entry_id = ?
      )
    `).run(entryId, entryId);
  });
  removeFiles("private", privateKeys);
  removeFiles("public", publicKeys);
  replayJournalDeletionTombstonesUnlocked("journal_entry", entryId);
  for (const revisionId of revisionIds) rmSync(storagePath("private", `quarantine/${revisionId}`), { recursive: true, force: true });
}

function copyRevisionMedia(entryId: string, revisionId: string) {
  prepareJournalMediaDirectories();
  const revisionDirectory = storagePath("public", revisionId);
  mkdirSync(revisionDirectory, { recursive: true, mode: 0o700 });
  chmodSync(revisionDirectory, 0o700);
  const rows = getDatabase().prepare(`
    SELECT ea.asset_id, v.requested_width, v.width, v.height, v.byte_size, v.storage_key
    FROM journal_entry_assets ea
    JOIN journal_assets a ON a.id = ea.asset_id AND a.status = 'ready'
    JOIN journal_asset_variants v ON v.asset_id = a.id AND v.scope = 'private' AND v.revision_id = ''
    WHERE ea.entry_id = ? ORDER BY ea.position, v.requested_width
  `).all(entryId) as DatabaseRow[];
  const copied: Array<{ assetId: string; requestedWidth: number; width: number; height: number; bytes: number; key: string }> = [];
  try {
    for (const row of rows) {
      const assetId = String(row.asset_id);
      const requestedWidth = Number(row.requested_width);
      const key = `${revisionId}/${assetId}/${requestedWidth}.webp`;
      const destination = storagePath("public", key);
      mkdirSync(resolve(destination, ".."), { recursive: true, mode: 0o700 });
      chmodSync(resolve(destination, ".."), 0o700);
      copyFileSync(storagePath("private", String(row.storage_key)), destination);
      chmodSync(destination, 0o600);
      copied.push({ assetId, requestedWidth, width: Number(row.width), height: Number(row.height), bytes: Number(row.byte_size), key });
    }
    return copied;
  } catch (cause) {
    rmSync(storagePath("public", revisionId), { recursive: true, force: true });
    throw cause;
  }
}

function publishJournalEntryUnlocked(userId: string, entryId: string) {
  const { user } = assertVerifiedUser(userId, "publish");
  const entry = ownerEntry(userId, entryId);
  const previousRevisionId = String(entry.published_revision_id ?? "");
  if (String(entry.status) === "hidden") throw new JournalError("这篇札记正在审核中", "JOURNAL_HIDDEN", 409);
  // A community image post may be intentionally image-only. Keep the title
  // optional and let readers see the localized fallback used by the UI.
  const title = text(entry.title, JOURNAL_LIMITS.title);
  const assets = getDatabase().prepare(`
    SELECT ea.*, a.status FROM journal_entry_assets ea JOIN journal_assets a ON a.id = ea.asset_id
    WHERE ea.entry_id = ? ORDER BY ea.position
  `).all(entryId) as DatabaseRow[];
  if (!assets.length || assets.length > JOURNAL_LIMITS.images || assets.some((asset) => asset.status !== "ready")) {
    throw new JournalError("发布前需要 1 至 6 张处理完成的图片", "IMAGES_NOT_READY", 409);
  }
  if (assets.some((asset) => !Boolean(asset.decorative) && !String(asset.alt_text ?? "").trim())) {
    throw new JournalError("请为每张非装饰图片填写替代文本", "ALT_REQUIRED", 409);
  }
  const currentUsage = usage(userId);
  if (currentUsage.publishes >= JOURNAL_LIMITS.dailyPublishes) throw new JournalError("今天的公开发布次数已用完", "PUBLISH_QUOTA", 429);
  const previousPublicBytes = previousRevisionId
    ? Number(asRow(getDatabase().prepare("SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public'").get(previousRevisionId))?.bytes ?? 0)
    : 0;
  const revisionId = id("revision");
  const copied = copyRevisionMedia(entryId, revisionId);
  const copiedBytes = copied.reduce((total, item) => total + item.bytes, 0);
  if (currentUsage.totalBytes - previousPublicBytes + copiedBytes > JOURNAL_LIMITS.totalBytes) {
    rmSync(storagePath("public", revisionId), { recursive: true, force: true });
    throw new JournalError("媒体空间已用完", "MEDIA_QUOTA", 413);
  }
  const previousKeys = previousRevisionId ? publicVariantKeys(previousRevisionId) : [];
  const previousQuarantine = previousRevisionId ? quarantineRevisionDirectory(previousRevisionId) : "missing";
  const now = Date.now();
  try {
    withTransaction(() => {
      const database = getDatabase();
      const revisionNumber = Number(asRow(database.prepare("SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision FROM journal_revisions WHERE entry_id = ?").get(entryId))?.revision ?? 1);
      database.prepare(`
        INSERT INTO journal_revisions (id, entry_id, revision_number, title, body, content_language, allow_comments, draft_revision, author_display_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(revisionId, entryId, revisionNumber, title, String(entry.body), String(entry.content_language), Boolean(entry.allow_comments) ? 1 : 0, Number(entry.draft_revision ?? 0), String(user.name), now);
      const revisionAsset = database.prepare(`
        INSERT INTO journal_revision_assets (revision_id, asset_id, position, caption, alt_text, decorative)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const asset of assets) revisionAsset.run(revisionId, asset.asset_id, asset.position, asset.caption, asset.alt_text, asset.decorative);
      const variant = database.prepare(`
        INSERT INTO journal_asset_variants (asset_id, revision_id, scope, requested_width, width, height, byte_size, storage_key, created_at)
        VALUES (?, ?, 'public', ?, ?, ?, ?, ?, ?)
      `);
      for (const item of copied) variant.run(item.assetId, revisionId, item.requestedWidth, item.width, item.height, item.bytes, item.key, now);
      database.prepare(`
        UPDATE journal_entries SET status = 'published', published_revision_id = ?, published_at = ?, hidden_at = NULL,
          unpublished_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?
      `).run(revisionId, now, now, entryId, userId);
      if (previousRevisionId) {
        recordTombstones("journal_revision", entryId, previousKeys, "public");
        database.prepare("DELETE FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public'").run(previousRevisionId);
      }
      database.prepare(`
        INSERT INTO journal_daily_usage (user_id, usage_day, upload_count, publish_count, uploaded_bytes)
        VALUES (?, ?, 0, 1, 0)
        ON CONFLICT(user_id, usage_day) DO UPDATE SET publish_count = publish_count + 1
      `).run(userId, day(now));
    });
  } catch (cause) {
    rmSync(storagePath("public", revisionId), { recursive: true, force: true });
    if (previousRevisionId && previousQuarantine === "moved") restoreRevisionDirectory(previousRevisionId);
    throw cause;
  }
  activateRevisionDirectory(revisionId);
  if (previousRevisionId) {
    removeFiles("public", previousKeys);
    rmSync(storagePath("private", `quarantine/${previousRevisionId}`), { recursive: true, force: true });
  }
  return getOwnedJournalEntry(userId, entryId);
}

export function publishJournalEntry(userId: string, entryId: string) {
  return withJournalMediaLock(() => publishJournalEntryUnlocked(userId, entryId));
}

function unpublishJournalEntryUnlocked(userId: string, entryId: string) {
  assertVerifiedUser(userId);
  const entry = ownerEntry(userId, entryId);
  if (String(entry.status) !== "published") throw new JournalError("这篇札记当前没有公开", "NOT_PUBLISHED", 409);
  const revisionId = String(entry.published_revision_id ?? "");
  const publicKeys = publicVariantKeys(revisionId);
  const quarantine = quarantineRevisionDirectory(revisionId);
  try {
    withTransaction(() => {
      getDatabase().prepare("UPDATE journal_entries SET status = 'unpublished', unpublished_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(Date.now(), Date.now(), entryId, userId);
      recordTombstones("journal_revision", entryId, publicKeys, "public");
      getDatabase().prepare("DELETE FROM journal_asset_variants WHERE revision_id = ? AND scope = 'public'").run(revisionId);
    });
  } catch (cause) {
    if (quarantine === "moved") restoreRevisionDirectory(revisionId);
    throw cause;
  }
  removeFiles("public", publicKeys);
  rmSync(storagePath("private", `quarantine/${revisionId}`), { recursive: true, force: true });
  return getOwnedJournalEntry(userId, entryId);
}

export function unpublishJournalEntry(userId: string, entryId: string) {
  return withJournalMediaLock(() => unpublishJournalEntryUnlocked(userId, entryId));
}

function deleteJournalEntryUnlocked(userId: string, entryId: string) {
  assertVerifiedUser(userId, "write");
  const entry = ownerEntry(userId, entryId);
  const revisionIds = (getDatabase().prepare("SELECT id FROM journal_revisions WHERE entry_id = ?").all(entryId) as DatabaseRow[]).map((row) => String(row.id));
  const privateKeys = (getDatabase().prepare(`
    SELECT v.storage_key FROM journal_asset_variants v JOIN journal_entry_assets ea ON ea.asset_id = v.asset_id
    WHERE ea.entry_id = ? AND v.scope = 'private'
  `).all(entryId) as DatabaseRow[]).map((row) => String(row.storage_key));
  const publicKeys = revisionIds.flatMap(publicVariantKeys);
  const tmpKeys = (getDatabase().prepare(`
    SELECT tmp_storage_key FROM journal_jobs
    WHERE entry_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running') AND tmp_storage_key <> ''
  `).all(entryId) as DatabaseRow[]).map((row) => `tmp/${String(row.tmp_storage_key)}`);
  const quarantined = revisionIds.filter((revisionId) => quarantineRevisionDirectory(revisionId) === "moved");
  try { withTransaction(() => {
    recordTombstones("journal_entry", entryId, privateKeys, "private");
    recordTombstones("journal_entry", entryId, publicKeys, "public");
    recordTombstones("journal_entry", entryId, tmpKeys);
    getDatabase().prepare("DELETE FROM journal_jobs WHERE entry_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running')").run(entryId);
    getDatabase().prepare("UPDATE journal_entries SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(Date.now(), Date.now(), entryId, userId);
    getDatabase().prepare(`
      UPDATE journal_assets SET status = 'deleted', deleted_at = ? WHERE id IN (
        SELECT asset_id FROM journal_entry_assets WHERE entry_id = ?
        UNION SELECT ra.asset_id FROM journal_revision_assets ra JOIN journal_revisions r ON r.id = ra.revision_id WHERE r.entry_id = ?
      )
    `).run(Date.now(), entryId, entryId);
    getDatabase().prepare(`
      DELETE FROM journal_asset_variants WHERE asset_id IN (SELECT asset_id FROM journal_entry_assets WHERE entry_id = ?)
        OR revision_id IN (SELECT id FROM journal_revisions WHERE entry_id = ?)
    `).run(entryId, entryId);
  }); } catch (cause) {
    for (const revisionId of quarantined) restoreRevisionDirectory(revisionId);
    throw cause;
  }
  removeFiles("private", privateKeys);
  removeFiles("public", publicKeys);
  replayJournalDeletionTombstonesUnlocked("journal_entry", entryId);
  for (const revisionId of revisionIds) rmSync(storagePath("private", `quarantine/${revisionId}`), { recursive: true, force: true });
  return { ok: true, status: String(entry.status) };
}

export function deleteJournalEntry(userId: string, entryId: string) {
  return withJournalMediaLock(() => deleteJournalEntryUnlocked(userId, entryId));
}

function publicEntryRow(entryId: string) {
  const row = asRow(getDatabase().prepare(`
    SELECT e.id, e.user_id, e.created_at, e.published_at, e.published_revision_id, r.revision_number,
      r.title, r.body, r.content_language, r.allow_comments, r.author_display_name, r.created_at AS revision_created_at,
      (SELECT COUNT(*) FROM journal_reactions x WHERE x.entry_id = e.id) AS reaction_count,
      (SELECT COUNT(*) FROM journal_comments c WHERE c.entry_id = e.id AND c.status = 'visible') AS comment_count
    FROM journal_entries e JOIN journal_revisions r ON r.id = e.published_revision_id
    WHERE e.id = ? AND e.status = 'published'
  `).get(entryId));
  if (!row) throw new JournalError("没有找到这篇公开札记", "PUBLIC_JOURNAL_NOT_FOUND", 404);
  return row;
}

function publicComments(entryId: string, viewerId: string | null) {
  return (getDatabase().prepare(`
    SELECT c.id, c.entry_id, c.parent_id, c.body, c.created_at, c.user_id, u.name AS display_name
    FROM journal_comments c JOIN "user" u ON u.id = c.user_id
    WHERE c.entry_id = ? AND c.status = 'visible' ORDER BY c.created_at ASC
  `).all(entryId) as DatabaseRow[]).map((row) => ({
    id: String(row.id),
    entryId: String(row.entry_id),
    parentId: typeof row.parent_id === "string" ? row.parent_id : null,
    body: String(row.body),
    createdAt: Number(row.created_at),
    author: { displayName: String(row.display_name) },
    canDelete: Boolean(viewerId && (viewerId === row.user_id || asRow(getDatabase().prepare("SELECT id FROM journal_entries WHERE id = ? AND user_id = ?").get(entryId, viewerId)))),
  }));
}

function publicPayload(row: DatabaseRow, viewerId: string | null, detail: boolean) {
  const revisionId = String(row.published_revision_id);
  const images = entryAssets(String(row.id), revisionId);
  const reacted = viewerId ? Boolean(asRow(getDatabase().prepare("SELECT 1 AS found FROM journal_reactions WHERE entry_id = ? AND user_id = ?").get(row.id, viewerId))) : false;
  return {
    id: String(row.id),
    title: String(row.title),
    body: detail ? String(row.body) : String(row.body).slice(0, 240),
    excerpt: String(row.body).replace(/\s+/gu, " ").trim().slice(0, 150),
    contentLanguage: String(row.content_language),
    allowComments: Boolean(row.allow_comments),
    status: "published" as const,
    isOwner: Boolean(viewerId && asRow(getDatabase().prepare("SELECT 1 AS found FROM journal_entries WHERE id = ? AND user_id = ?").get(row.id, viewerId))),
    hasUnpublishedChanges: false,
    author: { displayName: String(row.author_display_name) },
    cover: images[0] ?? null,
    images: detail ? images : [],
    imageCount: images.length,
    revision: Number(row.revision_number ?? 0),
    publicRevision: Number(row.revision_number ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.revision_created_at),
    publishedAt: Number(row.published_at),
    reactionCount: Number(row.reaction_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    reacted,
    comments: detail ? publicComments(String(row.id), viewerId) : [],
  };
}

export function getPublishedJournalEntry(entryId: string, viewerId: string | null) {
  return publicPayload(publicEntryRow(entryId), viewerId, true);
}

export type JournalFeedSort = "latest" | "resonant";

/**
 * List public journal entries for a feed. The historical two-argument form
 * `(viewerId, cursor)` remains valid for latest ordering; passing a sort
 * string as the second argument is supported for feed consumers. Resonant
 * ordering currently returns its first page because its reaction-aware cursor
 * is not represented by the legacy numeric cursor.
 */
function listPublishedJournalRows(before: number, sort: JournalFeedSort): DatabaseRow[] {
  const order = sort === "resonant"
    ? "reaction_count DESC, e.published_at DESC, e.id DESC"
    : "e.published_at DESC, e.id DESC";
  return getDatabase().prepare(`
    SELECT e.id, e.user_id, e.created_at, e.published_at, e.published_revision_id, r.revision_number,
      r.title, r.body, r.content_language, r.allow_comments, r.author_display_name, r.created_at AS revision_created_at,
      (SELECT COUNT(*) FROM journal_reactions x WHERE x.entry_id = e.id) AS reaction_count,
      (SELECT COUNT(*) FROM journal_comments c WHERE c.entry_id = e.id AND c.status = 'visible') AS comment_count
    FROM journal_entries e JOIN journal_revisions r ON r.id = e.published_revision_id
    WHERE e.status = 'published' AND e.published_at < ? ORDER BY ${order} LIMIT ?
  `).all(before, JOURNAL_LIMITS.pageSize) as DatabaseRow[];
}

export function listPublishedJournalEntries(
  viewerId: string | null,
  cursorOrSort?: number | JournalFeedSort,
  sortOrCursor?: JournalFeedSort | number,
) {
  const cursor = typeof cursorOrSort === "number"
    ? cursorOrSort
    : typeof sortOrCursor === "number" ? sortOrCursor : undefined;
  const sort: JournalFeedSort = cursorOrSort === "resonant" || sortOrCursor === "resonant" ? "resonant" : "latest";
  const before = sort === "latest" && Number.isFinite(cursor) && Number(cursor) > 0 ? Number(cursor) : Number.MAX_SAFE_INTEGER;
  return listPublishedJournalRows(before, sort).map((row) => publicPayload(row, viewerId, false));
}

/**
 * Feed-only companion to `listPublishedJournalEntries`. The public payloads
 * stay identical; the extra author user id never crosses to the client. The
 * unified feed adapter consumes it server-side to attach worn badges, keeping
 * the journal API free of internal account identifiers.
 */
export function listPublishedJournalFeedEntries(viewerId: string | null, sort: JournalFeedSort) {
  return listPublishedJournalRows(Number.MAX_SAFE_INTEGER, sort).map((row) => ({
    ...publicPayload(row, viewerId, false),
    authorUserId: String(row.user_id),
  }));
}

export function readJournalMedia(scope: "private" | "public", userId: string | null, assetId: string, width: number, revisionId = "") {
  if (!VARIANT_WIDTHS.includes(width as typeof VARIANT_WIDTHS[number])) throw new JournalError("图片尺寸无效", "INVALID_VARIANT", 404);
  const database = getDatabase();
  const row = scope === "private"
    ? asRow(database.prepare(`
      SELECT v.storage_key FROM journal_asset_variants v JOIN journal_assets a ON a.id = v.asset_id
      WHERE v.asset_id = ? AND v.revision_id = '' AND v.scope = 'private' AND v.requested_width = ? AND a.user_id = ? AND a.status = 'ready'
    `).get(assetId, width, userId ?? ""))
    : asRow(database.prepare(`
      SELECT v.storage_key FROM journal_asset_variants v
      JOIN journal_revisions r ON r.id = v.revision_id
      JOIN journal_entries e ON e.id = r.entry_id
      WHERE v.asset_id = ? AND v.revision_id = ? AND v.scope = 'public' AND v.requested_width = ?
        AND e.status = 'published' AND e.published_revision_id = r.id
    `).get(assetId, revisionId, width));
  if (!row) throw new JournalError("图片不存在", "MEDIA_NOT_FOUND", 404);
  return {
    bytes: new Uint8Array(readFileSync(/* turbopackIgnore: true */ storagePath(scope, String(row.storage_key)))),
    contentType: "image/webp",
    cacheControl: scope === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
  };
}

export function setJournalReaction(userId: string, entryId: string, active: boolean) {
  assertVerifiedUser(userId);
  publicEntryRow(entryId);
  if (active) getDatabase().prepare("INSERT OR IGNORE INTO journal_reactions (entry_id, user_id, created_at) VALUES (?, ?, ?)").run(entryId, userId, Date.now());
  else getDatabase().prepare("DELETE FROM journal_reactions WHERE entry_id = ? AND user_id = ?").run(entryId, userId);
  return { active };
}

export function createJournalComment(userId: string, entryId: string, value: unknown) {
  assertVerifiedUser(userId);
  const publicEntry = publicEntryRow(entryId);
  if (!Boolean(publicEntry.allow_comments)) throw new JournalError("作者已关闭留言", "COMMENTS_DISABLED", 409);
  const input = object(value);
  const body = text(input.body, JOURNAL_LIMITS.comment, true);
  const parentId = typeof input.parentId === "string" && input.parentId ? input.parentId : null;
  if (parentId) {
    const parent = asRow(getDatabase().prepare("SELECT parent_id FROM journal_comments WHERE id = ? AND entry_id = ? AND status = 'visible'").get(parentId, entryId));
    if (!parent || parent.parent_id) throw new JournalError("只能回复顶层留言", "INVALID_PARENT");
  }
  const commentId = id("journal_comment");
  getDatabase().prepare("INSERT INTO journal_comments (id, entry_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(commentId, entryId, userId, parentId, body, Date.now());
  return { id: commentId };
}

export function deleteJournalComment(userId: string, entryId: string, commentId: string) {
  assertVerifiedUser(userId, "write");
  const result = getDatabase().prepare(`
    UPDATE journal_comments SET status = 'deleted', deleted_at = ?
    WHERE id = ? AND entry_id = ? AND status <> 'deleted'
      AND (user_id = ? OR entry_id IN (SELECT id FROM journal_entries WHERE user_id = ?))
  `).run(Date.now(), commentId, entryId, userId, userId);
  if (!result.changes) throw new JournalError("没有找到可删除的留言", "COMMENT_NOT_FOUND", 404);
  return { ok: true };
}

function hideReportedTarget(entryId: string | null, commentId: string | null, reason: string) {
  const database = getDatabase();
  let publicRevisionId = "";
  if (entryId) {
    const entry = asRow(database.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ? AND status = 'published'").get(entryId));
    if (!entry) return { hidden: false, revisionId: "" };
    publicRevisionId = String(entry.published_revision_id ?? "");
    quarantineRevisionDirectory(publicRevisionId);
    database.prepare("UPDATE journal_entries SET status = 'hidden', hidden_at = ?, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), entryId);
  } else if (commentId) {
    const result = database.prepare("UPDATE journal_comments SET status = 'hidden' WHERE id = ? AND status = 'visible'").run(commentId);
    if (!result.changes) return { hidden: false, revisionId: "" };
  }
  database.prepare(`
    INSERT INTO moderation_audit_log (id, actor_type, action, target_type, target_id, reason, metadata_json, created_at)
    VALUES (?, 'system', 'auto_hide', ?, ?, ?, '{}', ?)
  `).run(id("audit"), entryId ? "journal_entry" : "journal_comment", entryId ?? commentId, reason, Date.now());
  return { hidden: true, revisionId: publicRevisionId };
}

function createJournalReportUnlocked(userId: string, value: unknown) {
  assertVerifiedUser(userId);
  const input = object(value);
  const entryId = typeof input.entryId === "string" && input.entryId ? input.entryId : null;
  const commentId = typeof input.commentId === "string" && input.commentId ? input.commentId : null;
  if (Boolean(entryId) === Boolean(commentId)) throw new JournalError("请选择要举报的内容");
  const reason = typeof input.reason === "string" && REPORT_REASONS.has(input.reason) ? input.reason : "other";
  const details = text(input.details, JOURNAL_LIMITS.reportDetails);
  const priorRevisionId = entryId
    ? String(asRow(getDatabase().prepare("SELECT published_revision_id FROM journal_entries WHERE id = ? AND status = 'published'").get(entryId))?.published_revision_id ?? "")
    : "";
  let result: { hidden: boolean; duplicate: boolean; revisionId: string };
  try { result = withTransaction(() => {
    const database = getDatabase();
    const exists = entryId
      ? asRow(database.prepare("SELECT id FROM journal_entries WHERE id = ? AND status = 'published'").get(entryId))
      : asRow(database.prepare("SELECT id FROM journal_comments WHERE id = ? AND status = 'visible'").get(commentId));
    if (!exists) throw new JournalError("内容不存在", "CONTENT_NOT_FOUND", 404);
    try {
      database.prepare("INSERT INTO journal_reports (id, reporter_id, entry_id, comment_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id("journal_report"), userId, entryId, commentId, reason, details, Date.now());
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("UNIQUE constraint failed")) return { hidden: false, duplicate: true, revisionId: "" };
      throw cause;
    }
    const count = Number(asRow(database.prepare(entryId
      ? "SELECT COUNT(DISTINCT reporter_id) AS count FROM journal_reports WHERE entry_id = ?"
      : "SELECT COUNT(DISTINCT reporter_id) AS count FROM journal_reports WHERE comment_id = ?").get(entryId ?? commentId))?.count ?? 0);
    const shouldHide = HIGH_RISK_REASONS.has(reason) || count >= 3;
    return shouldHide ? { ...hideReportedTarget(entryId, commentId, reason), duplicate: false } : { hidden: false, duplicate: false, revisionId: "" };
  }); } catch (cause) {
    if (priorRevisionId && existsSync(storagePath("private", `quarantine/${priorRevisionId}`)) && !existsSync(storagePath("public", priorRevisionId))) {
      restoreRevisionDirectory(priorRevisionId);
    }
    throw cause;
  }
  return { hidden: result.hidden, duplicate: result.duplicate };
}

export function createJournalReport(userId: string, value: unknown) {
  return withJournalMediaLock(() => createJournalReportUnlocked(userId, value));
}

export function createContentComplaint(value: unknown) {
  const input = object(value);
  const kind = input.kind === "copyright" ? "copyright" : input.kind === "privacy" ? "privacy" : null;
  if (!kind) throw new JournalError("投诉类型无效");
  const targetUrl = text(input.targetUrl, 2_000, true);
  let parsed: URL;
  try { parsed = new URL(targetUrl); } catch { throw new JournalError("目标链接无效"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new JournalError("目标链接无效");
  const allowedHosts = new Set(process.env.NODE_ENV === "production"
    ? ["loveyourself.cc.cd", "www.loveyourself.cc.cd", "knowyourself.cc.cd", "www.knowyourself.cc.cd"]
    : ["localhost", "127.0.0.1", "loveyourself.cc.cd", "www.loveyourself.cc.cd", "knowyourself.cc.cd", "www.knowyourself.cc.cd"]);
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) throw new JournalError("只能投诉本站内容", "INVALID_COMPLAINT_TARGET");
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const journalIndex = pathParts.indexOf("journal");
  const candidateEntryId = journalIndex >= 0 ? pathParts[journalIndex + 1] : "";
  const entryId = candidateEntryId && asRow(getDatabase().prepare("SELECT id FROM journal_entries WHERE id = ?").get(candidateEntryId)) ? candidateEntryId : null;
  const contact = text(input.contact, 254);
  const details = text(input.details, 5_000, true);
  const complaintId = id("complaint");
  const now = Date.now();
  getDatabase().prepare(`
    INSERT INTO content_complaints (id, kind, target_url, entry_id, contact, details, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(complaintId, kind, targetUrl, entryId, contact, details, now, now);
  return { id: complaintId };
}

const METRIC_ROUTE_CLASSES = new Set(["home", "catalog", "detail", "result", "history", "bookmarks", "journal", "community"]);
const METRIC_QUIZ_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const METRIC_LANG_DEVICE = /^(?:zh|en):(?:mobile|desktop)$/;
const METRIC_LANG_DEVICE_LENGTH = /^(?:zh|en):(?:mobile|desktop):(?:short|medium|long)$/;
const METRIC_RETURN_BUCKETS = /^completion:(?:1d|2-7d|8-28d)$/;

/**
 * Every aggregate event reduces to (event_name, entity_type, entity_id,
 * value, day) dimensions. No account, attempt, request, or device identifier
 * is ever part of a dimension, so the stored rows can never be linked back
 * to a person or connected across events.
 */
function aggregateEventDimensions(input: Record<string, unknown>) {
  const eventName = typeof input.event === "string" ? input.event : null;
  if (!eventName) throw new JournalError("事件类型无效");
  const metricValue = typeof input.value === "string" ? input.value : null;

  if (eventName === "quiz_visual_helpfulness") {
    const allowedQuizIds = new Set(["animal-personality", "emotion-regulation", "attachment-style", "life-satisfaction"]);
    const quizId = typeof input.quizId === "string" && allowedQuizIds.has(input.quizId) ? input.quizId : null;
    if (!quizId) throw new JournalError("测评标识无效");
    const visualKey = typeof input.visualKey === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/.test(input.visualKey) ? input.visualKey : null;
    if (!visualKey) throw new JournalError("图像标识无效");
    if (typeof input.helpful !== "boolean") throw new JournalError("反馈值无效");
    return { eventName, entityType: "quiz_visual", entityId: quizId, value: `${visualKey}:${input.helpful ? "helpful" : "not_helpful"}` };
  }

  if (eventName === "route_view") {
    const route = typeof input.route === "string" && METRIC_ROUTE_CLASSES.has(input.route) ? input.route : null;
    if (!route) throw new JournalError("路由标识无效");
    if (!metricValue || !METRIC_LANG_DEVICE.test(metricValue)) throw new JournalError("维度值无效");
    return { eventName, entityType: "route", entityId: route, value: metricValue };
  }

  if (eventName === "quiz_start" || eventName === "quiz_complete") {
    const quizId = typeof input.quizId === "string" && METRIC_QUIZ_ID.test(input.quizId) ? input.quizId : null;
    if (!quizId) throw new JournalError("测评标识无效");
    if (!metricValue || !METRIC_LANG_DEVICE_LENGTH.test(metricValue)) throw new JournalError("维度值无效");
    return { eventName, entityType: "quiz", entityId: quizId, value: metricValue };
  }

  if (eventName === "result_read") {
    const quizId = typeof input.quizId === "string" && METRIC_QUIZ_ID.test(input.quizId) ? input.quizId : null;
    if (!quizId) throw new JournalError("测评标识无效");
    if (!metricValue || !METRIC_LANG_DEVICE.test(metricValue)) throw new JournalError("维度值无效");
    return { eventName, entityType: "quiz", entityId: quizId, value: metricValue };
  }

  if (eventName === "baseline_cohort") {
    if (!metricValue || !METRIC_LANG_DEVICE.test(metricValue)) throw new JournalError("维度值无效");
    return { eventName, entityType: "cohort", entityId: "", value: metricValue };
  }

  if (eventName === "baseline_return") {
    if (!metricValue || !METRIC_RETURN_BUCKETS.test(metricValue)) throw new JournalError("维度值无效");
    return { eventName, entityType: "cohort", entityId: "", value: metricValue };
  }

  throw new JournalError("事件类型无效");
}

export function recordAggregateEvent(value: unknown) {
  const dimensions = aggregateEventDimensions(object(value));
  getDatabase().prepare(`
    INSERT INTO aggregate_events (event_name, entity_type, entity_id, value, event_day, event_count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(event_name, entity_type, entity_id, value, event_day)
    DO UPDATE SET event_count = event_count + 1
  `).run(dimensions.eventName, dimensions.entityType, dimensions.entityId, dimensions.value, day());
  return { ok: true };
}

export function assertJournalAdmin(userId: string) {
  assertVerifiedUser(userId, "read");
  assertAdmin(userId);
}

function governanceUsers(query: string) {
  const normalized = text(query, 200);
  const escaped = normalized.replace(/[\\%_]/gu, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  return getDatabase().prepare(`
    SELECT u.id, u.name, u.email, u.emailVerified,
      COALESCE(g.status, 'normal') AS governance_status, COALESCE(g.reason, '') AS governance_reason
    FROM "user" u LEFT JOIN user_governance g ON g.user_id = u.id
    WHERE ? = ''
      OR u.id LIKE ? ESCAPE '\\'
      OR u.name LIKE ? ESCAPE '\\'
      OR u.email LIKE ? ESCAPE '\\'
    ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, u.name COLLATE NOCASE, u.id
    LIMIT 100
  `).all(normalized, pattern, pattern, pattern, normalized);
}

export function listGovernanceUsers(adminUserId: string, query = "") {
  assertJournalAdmin(adminUserId);
  return governanceUsers(query);
}

export function listJournalModerationQueue(adminUserId: string) {
  assertJournalAdmin(adminUserId);
  return {
    entries: getDatabase().prepare(`
      SELECT e.id, e.user_id, e.title, e.status, e.hidden_at,
        (SELECT COUNT(*) FROM journal_reports r WHERE r.entry_id = e.id) AS report_count,
        (SELECT GROUP_CONCAT(DISTINCT reason) FROM journal_reports r WHERE r.entry_id = e.id) AS report_reasons
      FROM journal_entries e WHERE e.status = 'hidden' ORDER BY e.hidden_at DESC
    `).all(),
    comments: getDatabase().prepare(`
      SELECT c.id, c.entry_id, c.user_id, c.body, c.status,
        (SELECT COUNT(*) FROM journal_reports r WHERE r.comment_id = c.id) AS report_count,
        (SELECT GROUP_CONCAT(DISTINCT reason) FROM journal_reports r WHERE r.comment_id = c.id) AS report_reasons
      FROM journal_comments c WHERE c.status = 'hidden' ORDER BY c.created_at DESC
    `).all(),
    communityPosts: getDatabase().prepare(`
      SELECT p.id, p.user_id, p.reflection, p.moderation_status, p.hidden_at,
        (SELECT COUNT(*) FROM community_reports r WHERE r.post_id = p.id) AS report_count,
        (SELECT GROUP_CONCAT(DISTINCT reason) FROM community_reports r WHERE r.post_id = p.id) AS report_reasons
      FROM community_posts p WHERE p.moderation_status = 'hidden' ORDER BY p.hidden_at DESC
    `).all(),
    communityComments: getDatabase().prepare(`
      SELECT c.id, c.post_id, c.user_id, c.body, c.moderation_status, c.hidden_at,
        (SELECT COUNT(*) FROM community_reports r WHERE r.comment_id = c.id) AS report_count,
        (SELECT GROUP_CONCAT(DISTINCT reason) FROM community_reports r WHERE r.comment_id = c.id) AS report_reasons
      FROM community_comments c WHERE c.moderation_status = 'hidden' ORDER BY c.hidden_at DESC
    `).all(),
    complaints: getDatabase().prepare("SELECT * FROM content_complaints WHERE status IN ('open', 'reviewing') ORDER BY created_at ASC").all(),
    users: governanceUsers(""),
    audit: getDatabase().prepare("SELECT * FROM moderation_audit_log ORDER BY created_at DESC LIMIT 200").all(),
  };
}

function moderateJournalTargetUnlocked(adminUserId: string, value: unknown) {
  assertJournalAdmin(adminUserId);
  const input = object(value);
  const targetTypes = new Set(["entry", "comment", "community_post", "community_comment", "complaint"]);
  const targetType = typeof input.targetType === "string" && targetTypes.has(input.targetType) ? input.targetType : null;
  const targetId = text(input.targetId, 180, true);
  const contentActions = new Set(["restore", "remove"]);
  const complaintActions = new Set(["reviewing", "resolved", "rejected"]);
  const action = typeof input.action === "string" && (targetType === "complaint" ? complaintActions.has(input.action) : contentActions.has(input.action)) ? input.action : null;
  if (!targetType || !action) throw new JournalError("审核操作无效");
  const reason = text(input.reason, 1_000);
  let restoredRevisionId = "";
  try { withTransaction(() => {
    const database = getDatabase();
    if (targetType === "entry") {
      const entry = asRow(database.prepare("SELECT published_revision_id FROM journal_entries WHERE id = ? AND status = 'hidden'").get(targetId));
      if (!entry) throw new JournalError("没有找到待审核札记", "CONTENT_NOT_FOUND", 404);
      if (action === "restore") {
        restoredRevisionId = String(entry.published_revision_id ?? "");
        restoreRevisionDirectory(restoredRevisionId, false);
        database.prepare("UPDATE journal_entries SET status = 'published', hidden_at = NULL, updated_at = ? WHERE id = ?")
          .run(Date.now(), targetId);
      } else {
        database.prepare("UPDATE journal_entries SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), targetId);
      }
    } else if (targetType === "comment") {
      const status = action === "restore" ? "visible" : "deleted";
      const result = database.prepare("UPDATE journal_comments SET status = ?, deleted_at = CASE WHEN ? = 'deleted' THEN ? ELSE NULL END WHERE id = ? AND status = 'hidden'")
        .run(status, status, Date.now(), targetId);
      if (!result.changes) throw new JournalError("没有找到待审核留言", "CONTENT_NOT_FOUND", 404);
    } else if (targetType === "community_post") {
      const status = action === "restore" ? "visible" : "removed";
      const result = database.prepare("UPDATE community_posts SET moderation_status = ?, hidden_at = CASE WHEN ? = 'visible' THEN NULL ELSE hidden_at END WHERE id = ? AND moderation_status = 'hidden'")
        .run(status, status, targetId);
      if (!result.changes) throw new JournalError("没有找到待审核测评分享", "CONTENT_NOT_FOUND", 404);
    } else if (targetType === "community_comment") {
      const status = action === "restore" ? "visible" : "removed";
      const result = database.prepare("UPDATE community_comments SET moderation_status = ?, hidden_at = CASE WHEN ? = 'visible' THEN NULL ELSE hidden_at END WHERE id = ? AND moderation_status = 'hidden'")
        .run(status, status, targetId);
      if (!result.changes) throw new JournalError("没有找到待审核留言", "CONTENT_NOT_FOUND", 404);
    } else {
      const result = database.prepare("UPDATE content_complaints SET status = ?, updated_at = ? WHERE id = ? AND status IN ('open', 'reviewing')")
        .run(action, Date.now(), targetId);
      if (!result.changes) throw new JournalError("没有找到待处理投诉", "COMPLAINT_NOT_FOUND", 404);
    }
    database.prepare(`
      INSERT INTO moderation_audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, metadata_json, created_at)
      VALUES (?, 'admin', ?, ?, ?, ?, ?, '{}', ?)
    `).run(id("audit"), adminUserId, action, targetType.startsWith("community_") ? targetType : `journal_${targetType}`, targetId, reason, Date.now());
  });
    if (restoredRevisionId) activateRevisionDirectory(restoredRevisionId);
  } catch (cause) {
    if (restoredRevisionId && existsSync(storagePath("public", restoredRevisionId))) quarantineRevisionDirectory(restoredRevisionId);
    throw cause;
  }
  if (targetType === "entry" && action === "remove") removeAllEntryMedia(targetId);
  return { ok: true };
}

export function moderateJournalTarget(adminUserId: string, value: unknown) {
  return withJournalMediaLock(() => moderateJournalTargetUnlocked(adminUserId, value));
}

export function setUserGovernance(adminUserId: string, targetUserId: string, value: unknown) {
  assertJournalAdmin(adminUserId);
  userRow(targetUserId);
  const input = object(value);
  const status = typeof input.status === "string" && USER_STATUSES.has(input.status) ? input.status as GovernanceStatus : null;
  if (!status) throw new JournalError("账号状态无效");
  if (targetUserId === adminUserId && status !== "normal") {
    throw new JournalError("不能限制当前管理员账号", "ADMIN_SELF_LOCK", 409);
  }
  const reason = text(input.reason, 1_000);
  withTransaction(() => {
    const database = getDatabase();
    database.prepare(`
      INSERT INTO user_governance (user_id, status, reason, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).run(targetUserId, status, reason, adminUserId, Date.now());
    database.prepare(`
      INSERT INTO moderation_audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, metadata_json, created_at)
      VALUES (?, 'admin', ?, 'set_account_status', 'user', ?, ?, ?, ?)
    `).run(id("audit"), adminUserId, targetUserId, reason, JSON.stringify({ status }), Date.now());
  });
  return { userId: targetUserId, status };
}

function cleanupOrphanedJournalMediaUnlocked(adminUserId: string, olderThan = Date.now() - 24 * 60 * 60_000) {
  assertJournalAdmin(adminUserId);
  const rows = getDatabase().prepare(`
    SELECT a.id, v.scope, v.storage_key FROM journal_assets a
    LEFT JOIN journal_entry_assets ea ON ea.asset_id = a.id
    LEFT JOIN journal_revision_assets ra ON ra.asset_id = a.id
    LEFT JOIN journal_asset_variants v ON v.asset_id = a.id
    WHERE (a.status IN ('failed', 'deleted') OR ea.asset_id IS NULL) AND ra.asset_id IS NULL AND a.created_at < ?
  `).all(olderThan) as DatabaseRow[];
  const privateKeys = rows.filter((row) => row.scope === "private").map((row) => String(row.storage_key));
  const publicKeys = rows.filter((row) => row.scope === "public").map((row) => String(row.storage_key));
  const assetIds = [...new Set(rows.map((row) => String(row.id)))];
  withTransaction(() => {
    for (const assetId of assetIds) {
      const assetRows = rows.filter((row) => String(row.id) === assetId && row.storage_key);
      recordTombstones("journal_asset", assetId, assetRows.filter((row) => row.scope === "private").map((row) => String(row.storage_key)), "private");
      recordTombstones("journal_asset", assetId, assetRows.filter((row) => row.scope === "public").map((row) => String(row.storage_key)), "public");
      getDatabase().prepare("DELETE FROM journal_assets WHERE id = ?").run(assetId);
    }
    getDatabase().prepare(`
      INSERT INTO moderation_audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, metadata_json, created_at)
      VALUES (?, 'admin', ?, 'cleanup', 'journal_media', 'orphans', '', ?, ?)
    `).run(id("audit"), adminUserId, JSON.stringify({ assets: assetIds.length }), Date.now());
  });
  removeFiles("private", privateKeys);
  removeFiles("public", publicKeys);
  return { assetsRemoved: assetIds.length, filesRemoved: privateKeys.length + publicKeys.length };
}

export function cleanupOrphanedJournalMedia(adminUserId: string, olderThan = Date.now() - 24 * 60 * 60_000) {
  return withJournalMediaLock(() => cleanupOrphanedJournalMediaUnlocked(adminUserId, olderThan));
}

/** Run in Better Auth's delete.before hook while asset rows still exist. */
export function prepareJournalUserDeletion(userId: string) {
  return withJournalMediaLock(() => {
    userRow(userId);
    const database = getDatabase();
    const rows = database.prepare("SELECT scope, storage_key FROM journal_asset_variants WHERE asset_id IN (SELECT id FROM journal_assets WHERE user_id = ?)").all(userId) as DatabaseRow[];
    const privateKeys = rows.filter((row) => row.scope === "private").map((row) => String(row.storage_key));
    const publicKeys = rows.filter((row) => row.scope === "public").map((row) => String(row.storage_key));
    const tmpKeys = (database.prepare(`
      SELECT tmp_storage_key FROM journal_jobs
      WHERE user_id = ? AND kind = 'process_upload' AND status IN ('queued', 'running') AND tmp_storage_key <> ''
    `).all(userId) as DatabaseRow[]).map((row) => `tmp/${String(row.tmp_storage_key)}`);
    const revisionIds = (database.prepare(`
      SELECT DISTINCT published_revision_id FROM journal_entries
      WHERE user_id = ? AND published_revision_id IS NOT NULL AND published_revision_id <> ''
    `).all(userId) as DatabaseRow[]).map((row) => String(row.published_revision_id));
    const quarantined = revisionIds.filter((revisionId) => quarantineRevisionDirectory(revisionId) === "moved");
    try {
      withTransaction(() => {
        database.prepare("DELETE FROM deletion_tombstones WHERE entity_type = 'pending_user_media' AND entity_id = ?").run(userId);
        recordTombstones("pending_user_media", userId, privateKeys, "private");
        recordTombstones("pending_user_media", userId, publicKeys, "public");
        recordTombstones("pending_user_media", userId, tmpKeys);
      });
    } catch (cause) {
      for (const revisionId of quarantined) restoreRevisionDirectory(revisionId);
      throw cause;
    }
    return { privateFiles: privateKeys.length, publicFiles: publicKeys.length, tmpFiles: tmpKeys.length };
  });
}

function replayJournalDeletionTombstonesUnlocked(entityType?: string, entityId?: string) {
  const database = getDatabase();
  const rows = entityType && entityId
    ? database.prepare("SELECT id, storage_scope, storage_key FROM deletion_tombstones WHERE replayed_at IS NULL AND entity_type = ? AND entity_id = ? AND entity_type <> 'pending_user_media' ORDER BY deleted_at").all(entityType, entityId) as DatabaseRow[]
    : database.prepare("SELECT id, storage_scope, storage_key FROM deletion_tombstones WHERE replayed_at IS NULL AND entity_type <> 'pending_user_media' ORDER BY deleted_at LIMIT 1000").all() as DatabaseRow[];
  let replayed = 0;
  for (const row of rows) {
    const key = String(row.storage_key ?? "");
    const storedScope = String(row.storage_scope ?? "");
    const isTmp = key.startsWith("tmp/");
    const actualKey = isTmp ? key.slice(4) : key;
    const inferredScope = key.split("/").length >= 3 ? "public" : "private";
    const scope = storedScope === "public" || storedScope === "private" ? storedScope : inferredScope;
    const targets = isTmp
      ? [storagePath("tmp", actualKey)]
      : scope === "public"
        ? [storagePath("public", actualKey), storagePath("private", `quarantine/${actualKey}`)]
        : [storagePath("private", actualKey)];
    let removed = true;
    for (const target of targets) {
      try { unlinkSync(target); }
      catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) removed = false;
      }
    }
    if (!removed) continue;
    database.prepare("UPDATE deletion_tombstones SET replayed_at = ? WHERE id = ? AND replayed_at IS NULL").run(Date.now(), row.id);
    replayed += 1;
  }
  return { replayed, pending: rows.length - replayed };
}

export function replayJournalDeletionTombstones(entityType?: string, entityId?: string) {
  return withJournalMediaLock(() => replayJournalDeletionTombstonesUnlocked(entityType, entityId));
}

/** Run in Better Auth's delete.after hook; it is safe to retry after a crash. */
export function replayJournalUserDeletion(userId: string) {
  return withJournalMediaLock(() => {
    getDatabase().prepare(`
      UPDATE deletion_tombstones SET entity_type = 'user_media'
      WHERE entity_type = 'pending_user_media' AND entity_id = ?
    `).run(userId);
    return replayJournalDeletionTombstonesUnlocked("user_media", userId);
  });
}

export function deleteJournalUserData(userId: string) {
  prepareJournalUserDeletion(userId);
  const database = getDatabase();
  withTransaction(() => {
    database.prepare("DELETE FROM journal_reactions WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM journal_reports WHERE reporter_id = ?").run(userId);
    database.prepare("DELETE FROM journal_comments WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM journal_entries WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM journal_assets WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM journal_upload_batches WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM journal_jobs WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM journal_daily_usage WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM user_governance WHERE user_id = ?").run(userId);
  });
  const replay = replayJournalUserDeletion(userId);
  return { ok: true, filesRemoved: replay.replayed, pendingFiles: replay.pending };
}
