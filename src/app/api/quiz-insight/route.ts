import { loadQuizPaper } from "@/core/quiz";
import { AI_INSIGHT_QUIZ_IDS, AiInsightError, aiInsightConfig, generateInsight, parseInsightProfile } from "@/lib/server/ai-insight";
import { allowRateLimitedRequest, assertTrustedMutation, error, json, rateLimitResponse, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The result pages are statically prerendered, so the pilot's availability —
 * which depends on a runtime-only key — cannot be baked into the page. The
 * card probes this endpoint instead and renders nothing when unavailable.
 */
export async function GET() {
  const { apiKey, model } = aiInsightConfig();
  return json({ available: apiKey !== "", ...(apiKey ? { model } : {}) });
}

export async function POST(request: Request) {
  const trustedError = await assertTrustedMutation(request);
  if (trustedError) return trustedError;
  // Unlike the free funnel counters, every generation call spends real tokens.
  if (!allowRateLimitedRequest(request, "ai-insight", 6)) return rateLimitResponse();
  try {
    const body = await readJson(request, 1_500) as Record<string, unknown>;
    const quizId = body.quizId;
    if (typeof quizId !== "string" || !(AI_INSIGHT_QUIZ_IDS as readonly string[]).includes(quizId)) {
      return error("测评标识无效", 400, "INVALID_QUIZ");
    }
    const paper = await loadQuizPaper(quizId);
    if (!paper) return error("测评不存在", 404, "QUIZ_NOT_FOUND");
    const profile = parseInsightProfile(body, paper);
    const text = await generateInsight(paper, profile);
    return json({ text });
  } catch (cause) {
    if (cause instanceof AiInsightError) return error(cause.message, cause.status, cause.code);
    return error("暂时无法生成，请稍后再试", 500, "AI_INSIGHT_FAILED");
  }
}
