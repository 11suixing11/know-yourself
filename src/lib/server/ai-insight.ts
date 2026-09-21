import "server-only";

import type { Lang, QuizPaper } from "@/core/quiz/types";

/**
 * Experimental scope: the AI perspective pilot runs on one assessment only.
 * Widening the pilot is a deliberate decision, never an accident of config.
 */
export const AI_INSIGHT_QUIZ_IDS = ["attachment-style"] as const;

export class AiInsightError extends Error {
  constructor(message: string, public readonly code = "AI_INSIGHT_FAILED", public readonly status = 500) {
    super(message);
    this.name = "AiInsightError";
  }
}

export interface AiInsightProfile {
  lang: Lang;
  resultKey: string;
  percentages: Record<string, number>;
}

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: unknown;
    };
  }[];
}

const MAX_PROFILE_DIMENSIONS = 12;

/**
 * Any OpenAI-compatible chat endpoint works. Swapping providers means editing
 * the base URL and model name, never this module — the pilot key is filled in
 * at deploy time, so an empty key simply keeps the feature hidden.
 * AI_INSIGHT_HEADERS carries extra request headers as JSON for relays that
 * gate on client identity (e.g. agentrouter's codex-style UA check).
 */
export function aiInsightConfig() {
  const timeoutRaw = Number(process.env.AI_INSIGHT_TIMEOUT_MS);
  let extraHeaders: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(process.env.AI_INSIGHT_HEADERS ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      extraHeaders = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => typeof value === "string" && value !== "")
          .map(([name, value]) => [name, value as string]),
      );
    }
  } catch {
    extraHeaders = {};
  }
  return {
    apiKey: process.env.AI_INSIGHT_API_KEY?.trim() ?? "",
    baseUrl: process.env.AI_INSIGHT_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.AI_INSIGHT_MODEL?.trim() || "deepseek-v4.1-flash",
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1_000 && timeoutRaw <= 120_000 ? timeoutRaw : 25_000,
    extraHeaders,
  };
}

export function isAiInsightConfigured() {
  return aiInsightConfig().apiKey !== "";
}

/**
 * Only scores travel to the model — never raw answers and never an account,
 * attempt, or device identifier. The profile can describe a shape, not a
 * person.
 */
export function parseInsightProfile(value: unknown, paper: QuizPaper): AiInsightProfile {
  const input = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (input.lang !== "zh" && input.lang !== "en") throw new AiInsightError("语言无效", "INVALID_LANG", 400);

  const resultKey = typeof input.resultKey === "string" ? input.resultKey : "";
  const content = paper.resultContent;
  const knownResult = resultKey
    && (resultKey in (content.types ?? {}) || resultKey in (content.narrative ?? {}) || resultKey in (content.archetypes ?? {}));
  if (!knownResult) throw new AiInsightError("结果标识无效", "INVALID_RESULT_KEY", 400);

  const raw = (typeof input.percentages === "object" && input.percentages !== null ? input.percentages : {}) as Record<string, unknown>;
  const knownDimensions = content.dimensions ?? {};
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > MAX_PROFILE_DIMENSIONS) throw new AiInsightError("得分数据无效", "INVALID_PERCENTAGES", 400);
  const percentages: Record<string, number> = {};
  for (const [key, score] of entries) {
    if (!(key in knownDimensions)) throw new AiInsightError("得分数据无效", "INVALID_PERCENTAGES", 400);
    const value = typeof score === "number" ? score : Number(score);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new AiInsightError("得分数据无效", "INVALID_PERCENTAGES", 400);
    percentages[key] = value;
  }

  return { lang: input.lang, resultKey, percentages };
}

const SYSTEM_PROMPT: Record<Lang, string> = {
  zh: [
    "你是一名心理学内容编辑。用户刚完成一次自我反思测评，你会收到该测评的人工编写结果文案（语料块）和用户本次的维度得分。",
    "你的唯一任务：把语料块组装成一段写给读者本人的“另一个视角”补充文字。",
    "硬性要求：",
    "1. 只能使用语料块中出现的事实和措辞风格，不得添加语料之外的性格判断、新概念或新标签。",
    "2. 不做任何诊断、治疗或专业评估暗示；不使用“你就是”“永远”“注定”“典型的”这类定论句式，多用“这次回答里”“可能”“更容易”。",
    "3. 第二人称书写，温和、口语、克制；一到两段，120-200 个汉字。",
    "4. 不使用标题、列表或任何 Markdown；不重复具体分数数字；以陈述句结尾。",
  ].join("\n"),
  en: [
    "You are a psychology copy editor. The reader has just finished a self-reflection assessment. You receive the assessment's hand-written result copy (source blocks) and the reader's dimension scores.",
    "Your only task: assemble those blocks into one short \"another angle\" passage addressed to the reader.",
    "Hard rules:",
    "1. Use only facts and phrasing found in the source blocks. Do not add personality judgments, concepts, or labels that are not in them.",
    "2. Never suggest diagnosis, treatment, or professional assessment. Avoid absolute phrasing such as \"you always\" or \"you are destined to\"; prefer \"in these answers\", \"may\", \"more easily\".",
    "3. Second person, warm, conversational, restrained; one or two paragraphs, 90-140 words.",
    "4. No headings, lists, or Markdown; do not repeat the numeric scores; end with a statement.",
  ].join("\n"),
};

function dimensionBlock(paper: QuizPaper, key: string, score: number, lang: Lang) {
  const meta = paper.resultContent.dimensions?.[key];
  if (!meta) return null;
  const label = lang === "zh" ? meta.zh : meta.name;
  const description = lang === "zh" ? meta.description : meta.descriptionEn;
  const observation = meta.observation?.[lang];
  const parts = [`${label}（${Math.round(score)}%）`, description, observation].filter(Boolean);
  return parts.length > 1 ? parts.join("：") : null;
}

function localizedType(paper: QuizPaper, key: string, lang: Lang) {
  const type = paper.resultContent.types?.[key]?.[lang];
  if (!type) return null;
  return [type.title ?? type.name, type.description, type.inRelationship, type.underPressure, type.hiddenStrength]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "");
}

function localizedNarrative(paper: QuizPaper, key: string, lang: Lang) {
  const narrative = paper.resultContent.narrative?.[key]?.[lang];
  if (!narrative) return null;
  const parts = [
    narrative.description ?? narrative.subtitle ?? narrative.hero,
    ...narrative.scenes ?? [],
  ];
  return parts.some(Boolean) ? parts.filter((part): part is string => typeof part === "string" && part.trim() !== "") : null;
}

function localizedArchetype(paper: QuizPaper, key: string, lang: Lang) {
  const archetype = paper.resultContent.archetypes?.[key];
  if (!archetype) return null;
  const suffix = lang === "zh" ? "zh" : "en";
  const pick = (field: string) => {
    const value = archetype[`${field}_${suffix}` as keyof typeof archetype];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  const parts = [pick("traits"), pick("core_desire"), pick("contradiction"), pick("growth_path")];
  const found = parts.filter((part): part is string => part !== null);
  return found.length ? found : null;
}

/**
 * The prompt is assembled server-side from the definition's hand-written copy,
 * so a client can never inject text into it — it can only choose which real
 * dimensions and result key are emphasized.
 */
export function buildInsightPrompt(paper: QuizPaper, profile: AiInsightProfile) {
  const lang = profile.lang;
  const ranked = Object.entries(profile.percentages).sort(([, a], [, b]) => b - a);

  const scoreLine = ranked
    .map(([key, score]) => {
      const meta = paper.resultContent.dimensions?.[key];
      return `${lang === "zh" ? meta?.zh ?? key : meta?.name ?? key} ${Math.round(score)}%`;
    })
    .join(lang === "zh" ? "；" : ", ");

  const blocks: string[] = [];
  for (const [key, score] of ranked.slice(0, 3)) {
    const block = dimensionBlock(paper, key, score, lang);
    if (block) blocks.push(block);
  }
  for (const collect of [localizedType, localizedNarrative, localizedArchetype]) {
    const block = collect(paper, profile.resultKey, lang);
    if (block) blocks.push(block.join(lang === "zh" ? "\n" : "\n"));
  }

  const user = lang === "zh"
    ? [
        "【本次得分（按显著度排序）】",
        scoreLine,
        "【命中结果】",
        profile.resultKey,
        "【语料块】",
        ...blocks.map((block, index) => `${index + 1}. ${block}`),
        "【任务】",
        "根据语料块和得分，组装一段“另一个视角”补充文字，直接输出正文。",
      ].join("\n")
    : [
        "[Scores this time, most visible first]",
        scoreLine,
        "[Result reached]",
        profile.resultKey,
        "[Source blocks]",
        ...blocks.map((block, index) => `${index + 1}. ${block}`),
        "[Task]",
        "Assemble the source blocks into an \"another angle\" passage. Output the passage only.",
      ].join("\n");

  return { system: SYSTEM_PROMPT[lang], user };
}

function normalizeInsightText(raw: string) {
  return raw
    .replace(/^```(?:text|markdown)?\s*/iu, "")
    .replace(/```\s*$/u, "")
    .replace(/^(?:另一个视角|另一个角度|another angle)\s*[:：]?\s*/iu, "")
    .replace(/^[「“"'']*|["'」”'']*$/gu, "")
    .trim();
}

const BANNED_PATTERNS: RegExp[] = [
  /\*\*/u,
  /^#{1,6}\s/mu,
  /```/u,
  /诊断|治疗|治愈|心理疾病|精神疾病|建议就医|心理咨询/u,
  /你就是|你永远|你注定|典型的你/u,
  /\b(?:diagnos\w*|therapy|treatment|disorder)\b/iu,
  /\b(?:you always|you will always|you are destined|seek (?:a )?(?:professional|therapist))\b/iu,
];

/** A defensive second wall: the model is grounded, but the model is still a model. */
export function validateInsightOutput(text: string, lang: Lang): string | null {
  const body = text.replace(/\s/gu, "");
  if (lang === "zh") {
    if (body.length < 60) return "too_short";
    if (body.length > 320) return "too_long";
  } else {
    const words = text.split(/\s+/u).filter(Boolean).length;
    if (words < 40) return "too_short";
    if (words > 240) return "too_long";
  }
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) return "banned_pattern";
  }
  return null;
}

export async function generateInsight(paper: QuizPaper, profile: AiInsightProfile): Promise<string> {
  const { apiKey, baseUrl, model, timeoutMs, extraHeaders } = aiInsightConfig();
  if (!apiKey) throw new AiInsightError("AI 视角暂未开放", "AI_NOT_CONFIGURED", 503);

  const { system, user } = buildInsightPrompt(paper, profile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new AiInsightError("模型服务暂时不可用", "AI_UPSTREAM_FAILED", 502);
    const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const raw = typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
    const text = normalizeInsightText(raw);
    if (validateInsightOutput(text, profile.lang)) {
      throw new AiInsightError("生成内容未通过校验", "AI_OUTPUT_REJECTED", 500);
    }
    return text;
  } catch (cause) {
    if (cause instanceof AiInsightError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new AiInsightError("生成超时，请重试", "AI_UPSTREAM_FAILED", 502);
    }
    throw new AiInsightError("生成失败，请稍后再试", "AI_UPSTREAM_FAILED", 502);
  } finally {
    clearTimeout(timer);
  }
}
