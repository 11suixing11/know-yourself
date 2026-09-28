import type { Lang, QuizResult } from "./types";

export const STORAGE_VERSION = 3;
export const STORAGE_KEY = "know-yourself:v3";
export const STORAGE_EVENT = "know-yourself:storage-changed";
const ACCOUNT_STORAGE_PREFIX = `${STORAGE_KEY}:account:`;
const GUEST_STORAGE_KEY = `${STORAGE_KEY}:guest`;
const ACTIVE_SCOPE_KEY = `${STORAGE_KEY}:active-scope`;
const GUEST_IMPORT_BASELINE_PREFIX = `${STORAGE_KEY}:guest-import-baseline:`;

export interface QuizAttempt {
  id: string;
  testId: string;
  result: QuizResult;
  answers: number[];
  testName?: string;
  testNameEn?: string;
  timestamp: number;
}

export interface StoragePreferences {
  lang: Lang;
  theme: "system" | "light" | "dark" | "fresh";
}

export interface QuizSession {
  answers: (number | null)[];
  currentQuestion: number;
  timestamp: number;
}

export interface StorageSnapshot {
  version: typeof STORAGE_VERSION;
  preferences: StoragePreferences;
  attempts: QuizAttempt[];
  bookmarks: string[];
  sessions: Record<string, QuizSession>;
}

interface GuestImportBaseline {
  version: 1;
  preferences: StoragePreferences;
  attempts: Record<string, number>;
  bookmarks: string[];
  sessions: Record<string, number>;
}

const DEFAULT_SNAPSHOT: StorageSnapshot = {
  version: STORAGE_VERSION,
  preferences: { lang: "zh", theme: "system" },
  attempts: [],
  bookmarks: [],
  sessions: {},
};

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

function canUseStorage() {
  if (typeof window === "undefined") return false;
  try {
    return typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Whether browser storage can be read and written in this context. */
export function isStorageAvailable() {
  if (!canUseStorage()) return false;
  try {
    const key = `${STORAGE_KEY}:probe`;
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function accountStorageKey(userId: string) {
  return `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

function guestImportBaselineKey(userId: string) {
  return `${GUEST_IMPORT_BASELINE_PREFIX}${encodeURIComponent(userId)}`;
}

export function createEmptySnapshot(): StorageSnapshot {
  return {
    version: STORAGE_VERSION,
    preferences: { ...DEFAULT_SNAPSHOT.preferences },
    attempts: [],
    bookmarks: [],
    sessions: {},
  };
}

function makeAttemptId(testId: string, timestamp: number) {
  return `${testId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAttempt(value: unknown): QuizAttempt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<QuizAttempt>;
  if (!item.testId || typeof item.testId !== "string") return null;
  if (!item.result || typeof item.result !== "object" || Array.isArray(item.result)) return null;
  if (typeof item.timestamp !== "number" || !Number.isFinite(item.timestamp)) return null;
  return {
    id: typeof item.id === "string" && item.id ? item.id : makeAttemptId(item.testId, item.timestamp),
    testId: item.testId,
    result: item.result as QuizResult,
    answers: Array.isArray(item.answers) ? item.answers.filter((answer): answer is number => Number.isInteger(answer)) : [],
    testName: typeof item.testName === "string" ? item.testName : undefined,
    testNameEn: typeof item.testNameEn === "string" ? item.testNameEn : undefined,
    timestamp: item.timestamp,
  };
}

function normalizeSession(value: unknown): QuizSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const session = value as Partial<QuizSession>;
  if (!Array.isArray(session.answers) || !session.answers.every((answer) => answer === null || Number.isInteger(answer))) return null;
  if (!Number.isInteger(session.currentQuestion) || typeof session.timestamp !== "number" || !Number.isFinite(session.timestamp)) return null;
  const lastQuestion = Math.max(0, session.answers.length - 1);
  return {
    answers: session.answers,
    currentQuestion: Math.max(0, Math.min(session.currentQuestion as number, lastQuestion)),
    timestamp: session.timestamp,
  };
}

export function parseStorageSnapshot(value: unknown): StorageSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<StorageSnapshot>;
  if (input.version !== STORAGE_VERSION) return null;

  const language = input.preferences?.lang === "en" ? "en" : "zh";
  const rawTheme = input.preferences?.theme;
  const theme = rawTheme === "light" || rawTheme === "dark" || rawTheme === "fresh" ? rawTheme : "system";
  const attempts = Array.isArray(input.attempts)
    ? input.attempts.map(normalizeAttempt).filter((item): item is QuizAttempt => Boolean(item))
    : [];
  const bookmarks = Array.isArray(input.bookmarks)
    ? Array.from(new Set(input.bookmarks.filter((item): item is string => typeof item === "string" && Boolean(item))))
    : [];
  const sessions: Record<string, QuizSession> = {};
  if (input.sessions && typeof input.sessions === "object" && !Array.isArray(input.sessions)) {
    for (const [testId, rawSession] of Object.entries(input.sessions)) {
      const session = normalizeSession(rawSession);
      if (session) sessions[testId] = session;
    }
  }

  return {
    version: STORAGE_VERSION,
    preferences: { lang: language, theme },
    attempts: attempts.sort((a, b) => a.timestamp - b.timestamp),
    bookmarks,
    sessions,
  };
}

export function readSnapshot(): StorageSnapshot {
  if (!canUseStorage()) return createEmptySnapshot();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptySnapshot();
    return parseStorageSnapshot(JSON.parse(raw)) ?? createEmptySnapshot();
  } catch {
    return createEmptySnapshot();
  }
}

function emitChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_EVENT));
}

export function writeSnapshot(snapshot: StorageSnapshot) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    emitChange();
  } catch {
    // A private window or exhausted quota must not interrupt the quiz flow.
  }
}

export function readAccountSnapshot(userId: string): StorageSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(accountStorageKey(userId));
    return raw ? parseStorageSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeAccountSnapshot(userId: string, snapshot: StorageSnapshot) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(accountStorageKey(userId), JSON.stringify(snapshot));
  } catch {
    // A private window or exhausted quota must not interrupt the quiz flow.
  }
}

export function clearAllAccountSnapshots() {
  if (!canUseStorage()) return;
  const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
  for (const key of keys) {
    if (key?.startsWith(ACCOUNT_STORAGE_PREFIX) || key?.startsWith(GUEST_IMPORT_BASELINE_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}

function readStoredSnapshot(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseStorageSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function samePreferences(left: StoragePreferences, right: StoragePreferences) {
  return left.lang === right.lang && left.theme === right.theme;
}

function createGuestImportBaseline(snapshot: StorageSnapshot): GuestImportBaseline {
  return {
    version: 1,
    preferences: { ...snapshot.preferences },
    attempts: Object.fromEntries(snapshot.attempts.map((attempt) => [attempt.id, attempt.timestamp])),
    bookmarks: [...snapshot.bookmarks],
    sessions: Object.fromEntries(Object.entries(snapshot.sessions).map(([testId, session]) => [testId, session.timestamp])),
  };
}

function parseTimestampMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter((entry): entry is [string, number] =>
    Boolean(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return Object.fromEntries(entries);
}

function readGuestImportBaseline(userId: string): GuestImportBaseline | null {
  try {
    const raw = window.localStorage.getItem(guestImportBaselineKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GuestImportBaseline> | null;
    const attempts = parseTimestampMap(value?.attempts);
    const sessions = parseTimestampMap(value?.sessions);
    if (value?.version !== 1 || !value.preferences || !attempts || !sessions || !Array.isArray(value.bookmarks)) return null;
    return {
      version: 1,
      preferences: {
        lang: value.preferences.lang === "en" ? "en" : "zh",
        theme: value.preferences.theme === "light" || value.preferences.theme === "dark" || value.preferences.theme === "fresh" ? value.preferences.theme : "system",
      },
      attempts,
      bookmarks: Array.from(new Set(value.bookmarks.filter((item): item is string => typeof item === "string" && Boolean(item)))),
      sessions,
    };
  } catch {
    return null;
  }
}

function writeGuestImportBaseline(userId: string, snapshot: StorageSnapshot) {
  try {
    window.localStorage.setItem(guestImportBaselineKey(userId), JSON.stringify(createGuestImportBaseline(snapshot)));
  } catch {
    // A missing baseline only falls back to a conservative union on next login.
  }
}

function clearGuestImportBaseline(userId: string) {
  try {
    window.localStorage.removeItem(guestImportBaselineKey(userId));
  } catch {
    // Account deletion is already complete even if local storage is unavailable.
  }
}

/**
 * Merge two local snapshots without allowing one account's data to leak into
 * another account. When a guest-import baseline exists, a baseline item that
 * was deleted on either side stays deleted unless the surviving copy has a
 * newer timestamp. Items created after the baseline still merge normally.
 */
function mergeStorageSnapshots(
  primary: StorageSnapshot,
  secondary: StorageSnapshot,
  baseline: GuestImportBaseline | null = null,
): StorageSnapshot {
  const primaryAttempts = new Map(primary.attempts.map((attempt) => [attempt.id, attempt]));
  const secondaryAttempts = new Map(secondary.attempts.map((attempt) => [attempt.id, attempt]));
  const attempts: QuizAttempt[] = [];
  for (const id of new Set([...primaryAttempts.keys(), ...secondaryAttempts.keys()])) {
    const local = primaryAttempts.get(id);
    const incoming = secondaryAttempts.get(id);
    const baselineTimestamp = baseline?.attempts[id];
    if (baselineTimestamp !== undefined && (!local || !incoming)) {
      const surviving = local ?? incoming;
      if (!surviving || surviving.timestamp <= baselineTimestamp) continue;
    }
    if (!local) {
      if (incoming) attempts.push(incoming);
      continue;
    }
    if (!incoming) {
      attempts.push(local);
      continue;
    }
    const newer = incoming.timestamp > local.timestamp ? incoming : local;
    // Prefer answers from the newer copy when present; fall back to whichever
    // copy still contains them because cloud history may intentionally omit
    // completed raw answers.
    const answers = newer.answers.length > 0
      ? newer.answers
      : local.answers.length > 0
        ? local.answers
        : incoming.answers;
    attempts.push({ ...newer, answers });
  }

  const sessions: Record<string, QuizSession> = {};
  const sessionIds = new Set([...Object.keys(primary.sessions), ...Object.keys(secondary.sessions)]);
  for (const testId of sessionIds) {
    const local = primary.sessions[testId];
    const incoming = secondary.sessions[testId];
    const baselineTimestamp = baseline?.sessions[testId];
    if (baselineTimestamp !== undefined && (!local || !incoming)) {
      const surviving = local ?? incoming;
      if (!surviving || surviving.timestamp <= baselineTimestamp) continue;
    }
    if (!local) {
      if (incoming) sessions[testId] = incoming;
    } else if (!incoming || local.timestamp >= incoming.timestamp) {
      sessions[testId] = local;
    } else {
      sessions[testId] = incoming;
    }
  }

  const primaryBookmarks = new Set(primary.bookmarks);
  const secondaryBookmarks = new Set(secondary.bookmarks);
  const baselineBookmarks = baseline ? new Set(baseline.bookmarks) : null;
  const bookmarks = Array.from(new Set([...primary.bookmarks, ...secondary.bookmarks])).filter((id) =>
    !baselineBookmarks?.has(id) || (primaryBookmarks.has(id) && secondaryBookmarks.has(id)),
  );

  let preferences = primary.preferences;
  if (baseline && samePreferences(primary.preferences, baseline.preferences) && !samePreferences(secondary.preferences, baseline.preferences)) {
    preferences = secondary.preferences;
  }

  return {
    version: STORAGE_VERSION,
    preferences: { ...preferences },
    attempts: attempts.sort((left, right) => left.timestamp - right.timestamp),
    bookmarks,
    sessions,
  };
}

function readActiveScope(): { kind: "guest" } | { kind: "account"; userId: string } | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_SCOPE_KEY);
    if (raw === "guest") return { kind: "guest" };
    if (raw?.startsWith("account:")) return { kind: "account", userId: decodeURIComponent(raw.slice(8)) };
  } catch {
    // Treat invalid scope metadata as an unscoped legacy snapshot.
  }
  return null;
}

export function isStorageScopeActive(userId: string | null) {
  if (!canUseStorage()) return false;
  const scope = readActiveScope();
  return userId === null
    ? scope?.kind === "guest"
    : scope?.kind === "account" && scope.userId === userId;
}

function writeActiveScope(scope: { kind: "guest" } | { kind: "account"; userId: string }) {
  window.localStorage.setItem(ACTIVE_SCOPE_KEY, scope.kind === "guest" ? "guest" : `account:${encodeURIComponent(scope.userId)}`);
}

/** Switch the global UI snapshot without carrying one account's data into another. */
export function activateStorageScope(userId: string | null) {
  if (!canUseStorage()) return createEmptySnapshot();
  const active = readSnapshot();
  const current = readActiveScope();
  if ((userId === null && current?.kind === "guest") || (userId !== null && current?.kind === "account" && current.userId === userId)) return active;

  // Persist the outgoing scope first. A missing scope is the legacy/global
  // snapshot and is treated as a guest snapshot, never as an account copy.
  if (current === null || current.kind === "guest") {
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(active));
  } else {
    writeAccountSnapshot(current.userId, active);
  }

  const guestSnapshot = readStoredSnapshot(GUEST_STORAGE_KEY)
    ?? (current === null || current.kind === "guest" ? active : createEmptySnapshot());
  let next: StorageSnapshot;
  if (userId === null) {
    // Signing out must restore the independent guest copy. Do not merge the
    // account being left back into it; that would make later account switches
    // leak account-specific records into guest mode.
    next = guestSnapshot;
    writeActiveScope({ kind: "guest" });
  } else {
    const accountSnapshot = readAccountSnapshot(userId);
    if (accountSnapshot) {
      // On first sign-in (or guest -> existing account), merge only the
      // current guest copy with the target account copy. Switching directly
      // between two accounts must never carry the previous account along.
      next = current === null || current.kind === "guest"
        ? mergeStorageSnapshots(guestSnapshot, accountSnapshot, readGuestImportBaseline(userId))
        : accountSnapshot;
    } else {
      next = current === null || current.kind === "guest" ? guestSnapshot : createEmptySnapshot();
    }
    // Persist the merged target immediately so a reload before the next
    // mutation still sees the same account-local view.
    writeAccountSnapshot(userId, next);
    if (current === null || current.kind === "guest") writeGuestImportBaseline(userId, guestSnapshot);
    writeActiveScope({ kind: "account", userId });
  }
  writeSnapshot(next);
  return next;
}

export function clearStorageScope(userId: string | null) {
  if (!canUseStorage()) return;
  if (userId === null) window.localStorage.removeItem(GUEST_STORAGE_KEY);
  else window.localStorage.removeItem(accountStorageKey(userId));
  if (isStorageScopeActive(userId)) writeSnapshot(createEmptySnapshot());
}

export function adoptSnapshotAsGuest(snapshot: StorageSnapshot, formerUserId: string) {
  if (!canUseStorage()) return;
  const existingGuest = readStoredSnapshot(GUEST_STORAGE_KEY) ?? createEmptySnapshot();
  // Account deletion keeps the account's current data, but also preserves any
  // guest-only records that predated sign-in. The account key is removed so it
  // cannot be resurrected by a later scope switch.
  const merged = mergeStorageSnapshots(snapshot, existingGuest);
  try {
    window.localStorage.removeItem(accountStorageKey(formerUserId));
    clearGuestImportBaseline(formerUserId);
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(merged));
    writeActiveScope({ kind: "guest" });
  } catch {
    // The in-memory page can still keep the snapshot when persistence fails.
  }
  writeSnapshot(merged);
}

function updateSnapshot(updater: (current: StorageSnapshot) => StorageSnapshot) {
  const next = updater(readSnapshot());
  writeSnapshot(next);
  return next;
}

export function getAttempts() {
  return [...readSnapshot().attempts].sort((a, b) => b.timestamp - a.timestamp);
}

export function getAttemptsForTest(testId: string) {
  return getAttempts().filter((attempt) => attempt.testId === testId);
}

export function getLatestAttempt(testId: string) {
  return getAttemptsForTest(testId)[0] ?? null;
}

export function getAttemptById(id: string) {
  return getAttempts().find((attempt) => attempt.id === id) ?? null;
}

export function saveAttempt(input: Omit<QuizAttempt, "id"> & { id?: string }) {
  const attempt: QuizAttempt = { ...input, id: input.id ?? makeAttemptId(input.testId, input.timestamp) };
  updateSnapshot((current) => ({ ...current, attempts: [...current.attempts, attempt] }));
  return attempt;
}

export function replaceAttempt(id: string, input: QuizAttempt) {
  const attempt = normalizeAttempt(input);
  if (!attempt) return null;
  updateSnapshot((current) => ({
    ...current,
    attempts: current.attempts.some((item) => item.id === id)
      ? current.attempts.map((item) => item.id === id ? attempt : item)
      : [...current.attempts, attempt],
  }));
  return attempt;
}

export function setAttempts(attempts: QuizAttempt[]) {
  const valid = attempts.map(normalizeAttempt).filter((item): item is QuizAttempt => Boolean(item));
  updateSnapshot((current) => ({ ...current, attempts: valid }));
}

export function deleteAttempt(id: string) {
  updateSnapshot((current) => ({ ...current, attempts: current.attempts.filter((attempt) => attempt.id !== id) }));
}

export function clearAttempts() {
  updateSnapshot((current) => ({ ...current, attempts: [] }));
}

export function getBookmarks() {
  return [...readSnapshot().bookmarks];
}

export function setBookmarks(ids: string[]) {
  const bookmarks = Array.from(new Set(ids));
  updateSnapshot((current) => ({ ...current, bookmarks }));
  return bookmarks;
}

export function toggleBookmark(id: string) {
  const current = getBookmarks();
  return setBookmarks(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
}

export function isBookmarked(id: string) {
  return getBookmarks().includes(id);
}

export function getPreferences() {
  return { ...readSnapshot().preferences };
}

export function setPreference<K extends keyof StoragePreferences>(key: K, value: StoragePreferences[K]) {
  updateSnapshot((current) => ({
    ...current,
    preferences: { ...current.preferences, [key]: value },
  }));
}

export function getLanguage(): Lang {
  return readSnapshot().preferences.lang;
}

export function getQuizSession(testId: string): QuizSession | null {
  const session = readSnapshot().sessions[testId];
  if (!session) return null;
  if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
    clearQuizSession(testId);
    return null;
  }
  return session;
}

export function saveQuizSession(testId: string, answers: (number | null)[], currentQuestion: number) {
  updateSnapshot((current) => ({
    ...current,
    sessions: {
      ...current.sessions,
      [testId]: { answers, currentQuestion, timestamp: Date.now() },
    },
  }));
}

export function clearQuizSession(testId: string) {
  updateSnapshot((current) => {
    const sessions = { ...current.sessions };
    delete sessions[testId];
    return { ...current, sessions };
  });
}

export function clearAllData() {
  writeSnapshot(createEmptySnapshot());
}

export function getStorageSummary() {
  const snapshot = readSnapshot();
  const bytes = new Blob([JSON.stringify(snapshot)]).size;
  const storageUsed = bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes > 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`;
  return { attempts: snapshot.attempts.length, bookmarks: snapshot.bookmarks.length, storageUsed };
}

/** Old v2 data is intentionally not imported into the new product core. */
export function migrateLegacyStorage() {}
