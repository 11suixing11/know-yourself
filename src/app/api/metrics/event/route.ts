import { JournalError, recordAggregateEvent } from "@/lib/server/journal";
import { allowRateLimitedRequest, assertTrustedMutation, error, json, rateLimitResponse, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const trustedError = await assertTrustedMutation(request);
  if (trustedError) return trustedError;
  // One result-page visit can legitimately fire 5-6 funnel counters within a
  // minute, so this action gets a wider window than single-shot mutations.
  if (!allowRateLimitedRequest(request, "aggregate-event", 30)) return rateLimitResponse();
  try {
    return json(recordAggregateEvent(await readJson(request, 1_500)), 202);
  } catch (cause) {
    if (cause instanceof JournalError) return error(cause.message, cause.status, cause.code);
    return error("暂时无法记录反馈", 500, "METRIC_FAILED");
  }
}
