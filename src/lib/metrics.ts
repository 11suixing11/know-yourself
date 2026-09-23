import { getLanguage } from "./storage";
import type { QuizAttempt } from "./storage";

/**
 * Privacy-first baseline counters (METRICS.md). Every person-level judgment —
 * funnel progression, the 28-day return decision — happens here on the device
 * using data the visitor already holds in Storage v3. The server only ever
 * receives an anonymous +1 keyed by (event, day, coarse dimensions); it can
 * never connect two events to the same person.
 */

const PING_LEDGER_KEY = "know-yourself:v3:metrics-pings";
const DAY_MS = 86_400_000;
const RETURN_WINDOW_DAYS = 28;
const MOBILE_BREAKPOINT = "(max-width: 768px)";

export type MetricRouteClass =
  | "home"
  | "catalog"
  | "detail"
  | "result"
  | "history"
  | "bookmarks"
  | "journal"
  | "community";

type LengthBucket = "short" | "medium" | "long";
type ReturnBucket = "1d" | "2-7d" | "8-28d";

/** Local-midnight start of the calendar day holding `time`. */
export function startOfLocalDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole calendar days from `from` to `later`, in local time (>= 0). */
export function localDayDistance(from: number, later: number) {
  return Math.round((startOfLocalDay(later) - startOfLocalDay(from)) / DAY_MS);
}

function localDayKey(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Map a pathname to the coarse route classes the funnel is measured on. */
export function classifyRoute(pathname: string): MetricRouteClass | null {
  if (pathname === "/" ) return "home";
  if (pathname === "/community" || pathname === "/community/") return "community";
  if (pathname.startsWith("/assessments")) return "catalog";
  if (pathname.startsWith("/test/")) return "detail";
  if (pathname.startsWith("/result/")) return "result";
  if (pathname.startsWith("/history")) return "history";
  if (pathname.startsWith("/bookmarks")) return "bookmarks";
  if (pathname.startsWith("/journal")) return "journal";
  return null;
}

export function questionCountBucket(questionCount: number): LengthBucket {
  if (questionCount <= 10) return "short";
  if (questionCount <= 30) return "medium";
  return "long";
}

/**
 * The strict P0 continuation signal: this completion follows an earlier
 * completion on a different calendar day within the 28-day window. The bucket
 * records the distance to the most recent qualifying completion.
 */
export function completionReturnBucket(priorAttempts: QuizAttempt[], now = Date.now()): ReturnBucket | null {
  const latest = latestReturnWindowCompletion(priorAttempts, now);
  if (latest === null) return null;
  const distance = localDayDistance(latest, now);
  if (distance <= 1) return "1d";
  if (distance <= 7) return "2-7d";
  return "8-28d";
}

/**
 * The most recent completion that sits on an earlier calendar day within the
 * 28-day window — the shared P1 prerequisite. Same-day completions never
 * qualify: a continuation must follow the completion day, not share it.
 */
export function latestReturnWindowCompletion(priorAttempts: QuizAttempt[], now = Date.now()): number | null {
  let latest: number | null = null;
  for (const attempt of priorAttempts) {
    const distance = localDayDistance(attempt.timestamp, now);
    if (distance >= 1 && distance <= RETURN_WINDOW_DAYS) {
      if (latest === null || attempt.timestamp > latest) latest = attempt.timestamp;
    }
  }
  return latest;
}

/**
 * A revisited result only counts as a P1 continuation when the underlying
 * attempt was completed on an earlier day within the 28-day window —
 * re-reading today's fresh result is not a return.
 */
export function resultRevisitQualifies(completedAt: number, now = Date.now()) {
  const distance = localDayDistance(completedAt, now);
  return distance >= 1 && distance <= RETURN_WINDOW_DAYS;
}

function deviceClass(): "mobile" | "desktop" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  return window.matchMedia(MOBILE_BREAKPOINT).matches ? "mobile" : "desktop";
}

/** Dimension string sent with every event: `lang:device[:length-bucket]`. */
export function metricDimensions(lengthBucket?: LengthBucket) {
  const language = getLanguage() === "en" ? "en" : "zh";
  return lengthBucket ? `${language}:${deviceClass()}:${lengthBucket}` : `${language}:${deviceClass()}`;
}

type Ledger = Record<string, string>;

function readLedger(): Ledger {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PING_LEDGER_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Ledger>) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const ledger: Ledger = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) ledger[key] = value;
    }
    return ledger;
  } catch {
    return {};
  }
}

function writeLedger(ledger: Ledger) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PING_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // A full private-mode quota must not break the flow being measured.
  }
}

/**
 * Pure ledger decision, exported for tests: returns true only when this call
 * wins the slot. Same claim twice → false; a later claim (next day, or a
 * re-claim after "sent") → true again.
 */
export function claimLedgerSlot(ledger: Record<string, string>, ledgerKey: string, claim: string) {
  if (ledger[ledgerKey] === claim) return false;
  ledger[ledgerKey] = claim;
  return true;
}

/**
 * Claim a ping slot synchronously so React's double-invoked effects and rapid
 * re-mounts cannot double-send. A claim is released again if the request
 * fails, letting the next trigger retry.
 */
function claimPing(ledgerKey: string, claim: string) {
  const ledger = readLedger();
  if (!claimLedgerSlot(ledger, ledgerKey, claim)) return false;
  writeLedger(ledger);
  return true;
}

function releasePing(ledgerKey: string) {
  const ledger = readLedger();
  delete ledger[ledgerKey];
  writeLedger(ledger);
}

async function sendMetricEvent(payload: Record<string, unknown>) {
  try {
    const response = await fetch("/api/metrics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function pingOnce(event: string, payload: Record<string, unknown>, ledgerKey: string, once: "per-day" | "per-device") {
  if (typeof window === "undefined") return;
  const claim = once === "per-day" ? localDayKey(Date.now()) : "sent";
  if (!claimPing(ledgerKey, claim)) return;
  void sendMetricEvent({ event, ...payload }).then((delivered) => {
    if (!delivered) releasePing(ledgerKey);
  });
}

export function pingRouteView(route: MetricRouteClass) {
  pingOnce("route_view", { route, value: metricDimensions() }, `route_view:${route}`, "per-day");
}

export function pingQuizStart(testId: string, questionCount: number) {
  pingOnce("quiz_start", { quizId: testId, value: metricDimensions(questionCountBucket(questionCount)) }, `quiz_start:${testId}`, "per-day");
}

export function pingResultRead(testId: string) {
  pingOnce("result_read", { quizId: testId, value: metricDimensions() }, `result_read:${testId}`, "per-day");
}

/**
 * Called with the attempts that existed *before* the completion being saved,
 * so the 28-day return decision is made against local history only.
 */
export function pingQuizCompletion(testId: string, questionCount: number, priorAttempts: QuizAttempt[]) {
  pingOnce("quiz_complete", { quizId: testId, value: metricDimensions(questionCountBucket(questionCount)) }, `quiz_complete:${testId}`, "per-day");
  pingOnce("baseline_cohort", { value: metricDimensions() }, "baseline_cohort", "per-device");
  const returnBucket = completionReturnBucket(priorAttempts);
  if (returnBucket) pingOnce("baseline_return", { value: `completion:${returnBucket}` }, "baseline_return", "per-device");
}

/**
 * The P1 continuation signals (METRICS.md §5). Each one silently no-ops unless
 * the device already holds a completion from an earlier day within the
 * 28-day window — the same person-level judgment the P0 return uses, made
 * here on the device. The server only ever receives the anonymous +1.
 */
export function pingContinuationHistory(priorAttempts: QuizAttempt[]) {
  if (latestReturnWindowCompletion(priorAttempts) === null) return;
  pingOnce("continuation_history", { value: metricDimensions() }, "continuation_history", "per-day");
}

export function pingContinuationBookmark(priorAttempts: QuizAttempt[]) {
  if (latestReturnWindowCompletion(priorAttempts) === null) return;
  pingOnce("continuation_bookmark", { value: metricDimensions() }, "continuation_bookmark", "per-day");
}

export function pingContinuationResultRevisit(completedAt: number) {
  if (!resultRevisitQualifies(completedAt)) return;
  pingOnce("continuation_result_revisit", { value: metricDimensions() }, "continuation_result_revisit", "per-day");
}
