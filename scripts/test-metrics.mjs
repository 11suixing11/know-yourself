import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const directory = mkdtempSync(path.join(os.tmpdir(), "quiz-platform-metrics-"));
process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
process.env.MEDIA_ROOT = path.join(directory, "media");
process.env.BACKUP_ROOT = path.join(directory, "backups");
process.env.TURNSTILE_SECRET_KEY = "test-secret";
process.env.TURNSTILE_ALLOWED_HOSTNAMES = "localhost";
process.env.JOURNAL_ADMIN_USER_ID = "admin";

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
const metrics = loadModule(path.join(root, "src/lib/metrics.ts"));

const utcDay = () => new Date().toISOString().slice(0, 10);

/** Local noon `daysAgo` — a stable anchor for calendar-day bucket tests. */
function localNoon(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

function makeAttempt(timestamp) {
  return { id: `t:${timestamp}`, testId: "mbti", result: { title: "x" }, answers: [], timestamp };
}

function rowOf(eventName) {
  const sqlite = database.getDatabase();
  const rows = sqlite.prepare("SELECT event_name, entity_type, entity_id, value, event_day, event_count FROM aggregate_events WHERE event_name = ?").all(eventName);
  return rows;
}

try {
  // --- Server whitelist: every P0 event writes its documented dimensions.
  journal.recordAggregateEvent({ event: "route_view", route: "detail", value: "zh:mobile" });
  journal.recordAggregateEvent({ event: "quiz_start", quizId: "big-five", value: "zh:desktop:medium" });
  journal.recordAggregateEvent({ event: "quiz_complete", quizId: "mbti", value: "en:mobile:long" });
  journal.recordAggregateEvent({ event: "result_read", quizId: "life-satisfaction", value: "zh:desktop" });
  journal.recordAggregateEvent({ event: "baseline_cohort", value: "en:mobile" });
  journal.recordAggregateEvent({ event: "baseline_return", value: "completion:2-7d" });

  assert.deepEqual(rowOf("route_view"), [{ event_name: "route_view", entity_type: "route", entity_id: "detail", value: "zh:mobile", event_day: utcDay(), event_count: 1 }]);
  assert.deepEqual(rowOf("quiz_start"), [{ event_name: "quiz_start", entity_type: "quiz", entity_id: "big-five", value: "zh:desktop:medium", event_day: utcDay(), event_count: 1 }]);
  assert.deepEqual(rowOf("quiz_complete"), [{ event_name: "quiz_complete", entity_type: "quiz", entity_id: "mbti", value: "en:mobile:long", event_day: utcDay(), event_count: 1 }]);
  assert.deepEqual(rowOf("result_read"), [{ event_name: "result_read", entity_type: "quiz", entity_id: "life-satisfaction", value: "zh:desktop", event_day: utcDay(), event_count: 1 }]);
  assert.deepEqual(rowOf("baseline_cohort"), [{ event_name: "baseline_cohort", entity_type: "cohort", entity_id: "", value: "en:mobile", event_day: utcDay(), event_count: 1 }]);
  assert.deepEqual(rowOf("baseline_return"), [{ event_name: "baseline_return", entity_type: "cohort", entity_id: "", value: "completion:2-7d", event_day: utcDay(), event_count: 1 }]);

  // --- The existing image feedback keeps its shape and its pilot-only scope.
  journal.recordAggregateEvent({ event: "quiz_visual_helpfulness", quizId: "animal-personality", visualKey: "type:quiet", helpful: true });
  assert.deepEqual(rowOf("quiz_visual_helpfulness"), [{ event_name: "quiz_visual_helpfulness", entity_type: "quiz_visual", entity_id: "animal-personality", value: "type:quiet:helpful", event_day: utcDay(), event_count: 1 }]);
  assert.throws(() => journal.recordAggregateEvent({ event: "quiz_visual_helpfulness", quizId: "mbti", visualKey: "type:quiet", helpful: true }), /测评标识无效/);

  // --- Repeats of the same day+dimension upsert into one counter.
  journal.recordAggregateEvent({ event: "route_view", route: "detail", value: "zh:mobile" });
  assert.equal(rowOf("route_view")[0].event_count, 2, "the same day and dimensions must accumulate, not duplicate rows");

  // --- Reject matrix: unknown events, unlisted routes, forged dimensions.
  assert.throws(() => journal.recordAggregateEvent({ event: "nonsense" }), /事件类型无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "page_view", value: "zh:desktop" }), /事件类型无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "route_view", route: "admin", value: "zh:desktop" }), /路由标识无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "route_view", route: "home", value: "fr:desktop" }), /维度值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "route_view", route: "home" }), /维度值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "quiz_start", quizId: "big-five", value: "zh:desktop" }), /维度值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "quiz_complete", quizId: "Big-Five", value: "zh:desktop:short" }), /测评标识无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "result_read", quizId: "mbti", value: "zh:desktop:short" }), /维度值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "baseline_cohort", value: "zh:mobile:short" }), /维度值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "baseline_return", value: "history:1d" }), /维度值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "baseline_return", value: "completion:9-28d" }), /维度值无效/);

  // --- Privacy: the counter table still stores nothing person-identifying.
  assert.equal(
    database.getDatabase().prepare("PRAGMA table_info(aggregate_events)").all().some((column) => /user|ip|attempt|result|account|device/i.test(column.name)),
    false,
    "aggregate_events must never gain person-identifying columns",
  );

  // --- Client route classification: measured classes in, unmeasured out.
  assert.equal(metrics.classifyRoute("/"), "home");
  assert.equal(metrics.classifyRoute("/community/"), "community");
  assert.equal(metrics.classifyRoute("/assessments/"), "catalog");
  assert.equal(metrics.classifyRoute("/test/big-five/"), "detail");
  assert.equal(metrics.classifyRoute("/result/mbti/"), "result");
  assert.equal(metrics.classifyRoute("/history/"), "history");
  assert.equal(metrics.classifyRoute("/bookmarks/"), "bookmarks");
  assert.equal(metrics.classifyRoute("/journal/new"), "journal");
  assert.equal(metrics.classifyRoute("/journal/abc/edit"), "journal");
  assert.equal(metrics.classifyRoute("/account/"), null);
  assert.equal(metrics.classifyRoute("/settings/"), null);
  assert.equal(metrics.classifyRoute("/admin/moderation/"), null);
  assert.equal(metrics.classifyRoute("/complaints/"), null);
  assert.equal(metrics.classifyRoute("/privacy/"), null);
  assert.equal(metrics.classifyRoute("/api/metrics/event"), null);

  // --- Length buckets: the P0 segmentation boundaries.
  assert.equal(metrics.questionCountBucket(1), "short");
  assert.equal(metrics.questionCountBucket(10), "short");
  assert.equal(metrics.questionCountBucket(11), "medium");
  assert.equal(metrics.questionCountBucket(30), "medium");
  assert.equal(metrics.questionCountBucket(31), "long");

  // --- Calendar-day distance in local time.
  const todayNoon = localNoon(0);
  assert.equal(metrics.localDayDistance(todayNoon, todayNoon), 0);
  assert.equal(metrics.localDayDistance(localNoon(3), todayNoon), 3);
  const almostYesterday = new Date();
  almostYesterday.setDate(almostYesterday.getDate() - 1);
  almostYesterday.setHours(23, 59, 59, 999);
  assert.equal(metrics.localDayDistance(almostYesterday.getTime(), todayNoon), 1);

  // --- The strict P0 return judgment: another calendar day within 28 days.
  assert.equal(metrics.completionReturnBucket([], todayNoon), null, "no prior attempts can never qualify");
  assert.equal(metrics.completionReturnBucket([makeAttempt(todayNoon - 1)], todayNoon), null, "a same-day completion is not a return");
  assert.equal(metrics.completionReturnBucket([makeAttempt(localNoon(1))], todayNoon), "1d");
  assert.equal(metrics.completionReturnBucket([makeAttempt(localNoon(3))], todayNoon), "2-7d");
  assert.equal(metrics.completionReturnBucket([makeAttempt(localNoon(20))], todayNoon), "8-28d");
  assert.equal(metrics.completionReturnBucket([makeAttempt(localNoon(40))], todayNoon), null, "beyond 28 days no longer counts");
  assert.equal(metrics.completionReturnBucket([makeAttempt(localNoon(40)), makeAttempt(localNoon(3))], todayNoon), "2-7d", "the most recent qualifying attempt sets the bucket");
  assert.equal(metrics.completionReturnBucket([makeAttempt(localNoon(1)), makeAttempt(localNoon(3))], todayNoon), "1d");

  // --- Ping ledger dedup: same claim twice is refused, a new claim wins.
  const ledger = {};
  assert.equal(metrics.claimLedgerSlot(ledger, "quiz_start:mbti", "2026-09-17"), true);
  assert.equal(metrics.claimLedgerSlot(ledger, "quiz_start:mbti", "2026-09-17"), false, "a second same-day ping must be deduped");
  assert.equal(metrics.claimLedgerSlot(ledger, "quiz_start:mbti", "2026-09-18"), true, "the next day is a new claim");
  assert.equal(metrics.claimLedgerSlot(ledger, "baseline_cohort", "sent"), true);
  assert.equal(metrics.claimLedgerSlot(ledger, "baseline_cohort", "sent"), false, "per-device counters fire at most once");
  delete ledger["baseline_cohort"];
  assert.equal(metrics.claimLedgerSlot(ledger, "baseline_cohort", "sent"), true, "a released claim (failed send) can retry");

  // --- Dimension encoding (no window in Node: zh + desktop defaults).
  assert.equal(metrics.metricDimensions(), "zh:desktop");
  assert.equal(metrics.metricDimensions("short"), "zh:desktop:short");
} finally {
  globalThis.__knowYourselfDatabase?.close();
  globalThis.__knowYourselfDatabase = undefined;
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log("✓ Metrics whitelist, aggregate counters, and client-side baseline judgments behave as specified");
