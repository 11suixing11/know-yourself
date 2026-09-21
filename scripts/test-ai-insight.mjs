import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const directory = mkdtempSync(path.join(os.tmpdir(), "quiz-platform-ai-insight-"));
process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
process.env.MEDIA_ROOT = path.join(directory, "media");
process.env.BACKUP_ROOT = path.join(directory, "backups");
process.env.TURNSTILE_SECRET_KEY = "test-secret";
process.env.TURNSTILE_ALLOWED_HOSTNAMES = "localhost";
process.env.JOURNAL_ADMIN_USER_ID = "admin";
delete process.env.AI_INSIGHT_API_KEY;
delete process.env.AI_INSIGHT_BASE_URL;
delete process.env.AI_INSIGHT_MODEL;
delete process.env.AI_INSIGHT_TIMEOUT_MS;
delete process.env.AI_INSIGHT_HEADERS;

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

const journal = loadModule(path.join(root, "src/lib/server/journal.ts"));
const insight = loadModule(path.join(root, "src/lib/server/ai-insight.ts"));

const utcDay = () => new Date().toISOString().slice(0, 10);

/** A minimal attachment-style-shaped paper; sentinel strings make grounding assertions exact. */
const paper = {
  id: "attachment-style",
  kind: "type",
  title: { zh: "依恋风格测试", en: "Attachment Style Test" },
  resultContent: {
    dimensions: {
      SE: { name: "Secure", zh: "安全感", description: "SE-DESC-ZH", descriptionEn: "SE-DESC-EN", observation: { zh: "OBS-ZH-SE", en: "OBS-EN-SE" } },
      AN: { name: "Anxious", zh: "焦虑倾向", description: "AN-DESC-ZH", descriptionEn: "AN-DESC-EN", observation: { zh: "OBS-ZH-AN", en: "OBS-EN-AN" } },
      AV: { name: "Avoidant", zh: "回避倾向", description: "AV-DESC-ZH", descriptionEn: "AV-DESC-EN", observation: { zh: "OBS-ZH-AV", en: "OBS-EN-AV" } },
      DI: { name: "Disorganized", zh: "矛盾不确定", description: "DI-DESC-ZH", descriptionEn: "DI-DESC-EN", observation: { zh: "OBS-ZH-DI", en: "OBS-EN-DI" } },
    },
    types: {
      AN: {
        zh: { name: "焦虑倾向", title: "焦虑型依恋画像", description: "TYPE-DESC-ZH" },
        en: { name: "Anxious pattern", title: "Anxious Attachment Profile", description: "TYPE-DESC-EN" },
      },
    },
    narrative: {
      AN: {
        zh: { description: "NAR-DESC-ZH", scenes: ["SCENE-ZH-1", "SCENE-ZH-2"] },
        en: { description: "NAR-DESC-EN", scenes: ["SCENE-EN-1"] },
      },
    },
  },
};

const VALID_ZH_TEXT = "这次回答里，回应的快慢和关系里的距离比较容易牵动你。你可能先确认对方还在不在，再决定自己要不要放松下来；这不是想太多，而是很在意对方的心意。先在具体的情境里回看这些反应，比急着给自己一个定论更能说明发生了什么，也许会有一点点新的体会。";

function rowOf(eventName) {
  const sqlite = loadModule(path.join(root, "src/lib/server/database.ts")).getDatabase();
  return sqlite.prepare("SELECT event_name, entity_type, entity_id, value, event_day, event_count FROM aggregate_events WHERE event_name = ?").all(eventName);
}

const originalFetch = globalThis.fetch;
try {
  // --- Config: an empty key keeps the whole pilot dark.
  assert.equal(insight.isAiInsightConfigured(), false);
  delete process.env.AI_INSIGHT_API_KEY;
  const config = insight.aiInsightConfig();
  assert.equal(config.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(config.model, "deepseek-v4.1-flash");
  assert.equal(config.timeoutMs, 25_000);
  process.env.AI_INSIGHT_TIMEOUT_MS = "999999";
  assert.equal(insight.aiInsightConfig().timeoutMs, 25_000, "out-of-range timeouts must fall back to the default");
  delete process.env.AI_INSIGHT_TIMEOUT_MS;

  process.env.AI_INSIGHT_HEADERS = "{broken json";
  assert.deepEqual(insight.aiInsightConfig().extraHeaders, {}, "malformed header JSON must be ignored");
  process.env.AI_INSIGHT_HEADERS = '{"User-Agent":"codex_cli_rs/0.52.0","originator":"codex_cli_rs","count":7,"empty":""}';
  assert.deepEqual(
    insight.aiInsightConfig().extraHeaders,
    { "User-Agent": "codex_cli_rs/0.52.0", originator: "codex_cli_rs" },
    "only non-empty string header values apply",
  );
  delete process.env.AI_INSIGHT_HEADERS;

  // --- Profile validation: only real dimensions, real result keys, sane scores.
  const profile = insight.parseInsightProfile(
    { lang: "zh", resultKey: "AN", percentages: { SE: 62, AN: 80, AV: 35, DI: 20 } },
    paper,
  );
  assert.equal(profile.lang, "zh");
  assert.deepEqual(Object.keys(profile.percentages).sort(), ["AN", "AV", "DI", "SE"]);
  assert.throws(() => insight.parseInsightProfile({ lang: "fr", resultKey: "AN", percentages: { SE: 60 } }, paper), /语言无效/);
  assert.throws(() => insight.parseInsightProfile({ lang: "zh", resultKey: "NOPE", percentages: { SE: 60 } }, paper), /结果标识无效/);
  assert.throws(() => insight.parseInsightProfile({ lang: "zh", resultKey: "AN", percentages: { SE: 60, GHOST: 10 } }, paper), /得分数据无效/);
  assert.throws(() => insight.parseInsightProfile({ lang: "zh", resultKey: "AN", percentages: { SE: 120 } }, paper), /得分数据无效/);
  assert.throws(() => insight.parseInsightProfile({ lang: "zh", resultKey: "AN", percentages: {} }, paper), /得分数据无效/);

  // --- Prompt grounding: the model sees hand-written corpus blocks, not raw answers.
  const zhPrompt = insight.buildInsightPrompt(paper, profile);
  assert.ok(zhPrompt.system.includes("诊断"), "the system prompt must carry the non-diagnosis rule");
  for (const sentinel of ["OBS-ZH-AN", "OBS-ZH-SE", "OBS-ZH-AV", "TYPE-DESC-ZH", "NAR-DESC-ZH", "SCENE-ZH-1", "焦虑倾向 80%", "安全感 62%"]) {
    assert.ok(zhPrompt.user.includes(sentinel), `the zh prompt must ground on ${sentinel}`);
  }
  assert.ok(!zhPrompt.user.includes("OBS-EN-AN"), "the zh prompt must not leak the en corpus");
  assert.ok(!zhPrompt.user.includes("OBS-ZH-DI"), "only the three most visible dimensions travel");

  const enPrompt = insight.buildInsightPrompt(paper, { lang: "en", resultKey: "AN", percentages: { AN: 80, SE: 62 } });
  for (const sentinel of ["OBS-EN-AN", "OBS-EN-SE", "TYPE-DESC-EN", "SCENE-EN-1", "Anxious 80%"]) {
    assert.ok(enPrompt.user.includes(sentinel), `the en prompt must ground on ${sentinel}`);
  }
  assert.ok(!enPrompt.user.includes("OBS-ZH-AN"), "the en prompt must not leak the zh corpus");

  // --- Output validation: the defensive second wall.
  assert.equal(insight.validateInsightOutput(VALID_ZH_TEXT, "zh"), null);
  assert.equal(insight.validateInsightOutput("太短了。", "zh"), "too_short");
  assert.equal(insight.validateInsightOutput(`${VALID_ZH_TEXT}${VALID_ZH_TEXT}${VALID_ZH_TEXT}`, "zh"), "too_long");
  assert.equal(insight.validateInsightOutput(`${VALID_ZH_TEXT}建议你进行治疗。`, "zh"), "banned_pattern");
  assert.equal(insight.validateInsightOutput(`**${VALID_ZH_TEXT}**`, "zh"), "banned_pattern");
  assert.equal(insight.validateInsightOutput(`${VALID_ZH_TEXT}你就是一个典型的敏感者。`, "zh"), "banned_pattern");
  assert.equal(insight.validateInsightOutput("This response suggests that you always look for reassurance before you can truly settle, and that a slow reply can quietly change how safe the connection feels; that is worth noticing with some gentleness, and none of this is a diagnosis of any disorder, just one more angle for looking at your own patterns calmly.", "en"), "banned_pattern");

  // --- Generation: unconfigured stays dark; upstream failures never leak raw model output.
  assert.rejects(insight.generateInsight(paper, profile), (cause) => cause instanceof Error && cause.code === "AI_NOT_CONFIGURED" && cause.status === 503);

  process.env.AI_INSIGHT_API_KEY = "test-key";
  process.env.AI_INSIGHT_BASE_URL = "https://example.test/v1";
  process.env.AI_INSIGHT_MODEL = "test-model";
  process.env.AI_INSIGHT_TIMEOUT_MS = "2000";
  process.env.AI_INSIGHT_HEADERS = '{"User-Agent":"codex_cli_rs/0.52.0","originator":"codex_cli_rs"}';

  let calls = [];
  const fakeFetch = (handler) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    };
  };

  fakeFetch(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `另一个视角：${VALID_ZH_TEXT}` } }] }) }));
  const text = await insight.generateInsight(paper, profile);
  assert.equal(text, VALID_ZH_TEXT, "the wrapper prefix must be stripped before validation returns it");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].init.headers["User-Agent"], "codex_cli_rs/0.52.0", "relay client-identity headers must travel with the request");
  assert.equal(calls[0].init.headers.originator, "codex_cli_rs");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");
  assert.ok(body.messages[1].content.includes("OBS-ZH-AN"));

  fakeFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await assert.rejects(insight.generateInsight(paper, profile), (cause) => cause.status === 502 && cause.code === "AI_UPSTREAM_FAILED");

  fakeFetch(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "太短。" } }] }) }));
  await assert.rejects(insight.generateInsight(paper, profile), (cause) => cause.status === 500 && cause.code === "AI_OUTPUT_REJECTED");

  fakeFetch(async () => ({ ok: true, json: async () => ({ choices: [] }) }));
  await assert.rejects(insight.generateInsight(paper, profile), (cause) => cause.status === 500 && cause.code === "AI_OUTPUT_REJECTED");

  process.env.AI_INSIGHT_TIMEOUT_MS = "50";
  fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      reject(abortError);
    });
  }));
  await assert.rejects(insight.generateInsight(paper, profile), (cause) => cause.status === 502 && cause.code === "AI_UPSTREAM_FAILED");
  delete process.env.AI_INSIGHT_TIMEOUT_MS;

  // --- Whitelist: the funnel counters stay pilot-scoped and dimension-only.
  journal.recordAggregateEvent({ event: "ai_insight", quizId: "attachment-style", stage: "requested" });
  journal.recordAggregateEvent({ event: "ai_insight", quizId: "attachment-style", stage: "generated" });
  const aiRows = rowOf("ai_insight").sort((a, b) => (a.value < b.value ? -1 : 1));
  assert.deepEqual(aiRows, [
    { event_name: "ai_insight", entity_type: "quiz_ai", entity_id: "attachment-style", value: "generated", event_day: utcDay(), event_count: 1 },
    { event_name: "ai_insight", entity_type: "quiz_ai", entity_id: "attachment-style", value: "requested", event_day: utcDay(), event_count: 1 },
  ]);
  assert.throws(() => journal.recordAggregateEvent({ event: "ai_insight", quizId: "mbti", stage: "generated" }), /测评标识无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "ai_insight", quizId: "attachment-style", stage: "clicked" }), /阶段值无效/);
  assert.throws(() => journal.recordAggregateEvent({ event: "ai_insight", quizId: "attachment-style" }), /阶段值无效/);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.__knowYourselfDatabase?.close();
  globalThis.__knowYourselfDatabase = undefined;
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log("✓ AI insight pilot: prompt grounding, output walls, provider call, and pilot-scoped counters behave as specified");
