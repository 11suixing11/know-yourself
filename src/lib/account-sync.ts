"use client";

import type { QuizSession, StoragePreferences, StorageSnapshot } from "./storage";

interface SyncBaseline {
  version: 1;
  preferences: StoragePreferences;
  attempts: string[];
  bookmarks: string[];
  sessions: Record<string, number>;
}

const BASELINE_PREFIX = "know-yourself:sync-baseline:";

function baselineKey(userId: string) {
  return `${BASELINE_PREFIX}${encodeURIComponent(userId)}`;
}

function samePreferences(left: StoragePreferences, right: StoragePreferences) {
  return left.lang === right.lang && left.theme === right.theme;
}

function mergeSessions(
  local: Record<string, QuizSession>,
  remote: Record<string, QuizSession>,
  baseline: Record<string, number> | null,
) {
  const merged: Record<string, QuizSession> = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const localSession = local[key];
    const remoteSession = remote[key];
    const baselineTimestamp = baseline?.[key];
    if (baselineTimestamp !== undefined && (!localSession || !remoteSession)) {
      const surviving = localSession ?? remoteSession;
      if (!surviving || surviving.timestamp <= baselineTimestamp) continue;
    }
    if (!localSession) {
      if (remoteSession) merged[key] = remoteSession;
      continue;
    }
    if (!remoteSession || localSession.timestamp >= remoteSession.timestamp) {
      merged[key] = localSession;
    } else {
      merged[key] = remoteSession;
    }
  }
  return merged;
}

export function mergeAccountSnapshots(
  local: StorageSnapshot,
  remote: StorageSnapshot,
  baseline: SyncBaseline | null,
): StorageSnapshot {
  const localAttempts = new Map(local.attempts.map((attempt) => [attempt.id, attempt]));
  const remoteAttempts = new Map(remote.attempts.map((attempt) => [attempt.id, attempt]));
  const remotelyDeletedAttempts = new Set(
    baseline?.attempts.filter((id) => !remoteAttempts.has(id)) ?? [],
  );
  const attemptIds = new Set([...localAttempts.keys(), ...remoteAttempts.keys()]);
  const attempts = Array.from(attemptIds)
    .filter((id) => !remotelyDeletedAttempts.has(id))
    .map((id) => {
      const localAttempt = localAttempts.get(id);
      const remoteAttempt = remoteAttempts.get(id);
      return remoteAttempt && localAttempt
        ? { ...remoteAttempt, answers: localAttempt.answers }
        : localAttempt ?? remoteAttempt!;
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  const localBookmarks = new Set(local.bookmarks);
  const remoteBookmarks = new Set(remote.bookmarks);
  const baselineBookmarks = baseline ? new Set(baseline.bookmarks) : null;
  const bookmarks = Array.from(new Set([...local.bookmarks, ...remote.bookmarks])).filter((id) =>
    !baselineBookmarks?.has(id) || (localBookmarks.has(id) && remoteBookmarks.has(id)),
  );

  let preferences = local.preferences;
  if (baseline && samePreferences(local.preferences, baseline.preferences) && !samePreferences(remote.preferences, baseline.preferences)) {
    preferences = remote.preferences;
  }

  return {
    version: local.version,
    preferences,
    attempts,
    bookmarks,
    sessions: mergeSessions(local.sessions, remote.sessions, baseline?.sessions ?? null),
  };
}

export function readSyncBaseline(userId: string): SyncBaseline | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(baselineKey(userId)) || "null") as Partial<SyncBaseline> | null;
    if (!value || value.version !== 1 || !value.preferences || !Array.isArray(value.attempts) || !Array.isArray(value.bookmarks) || !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions)) return null;
    const preferences: StoragePreferences = {
      lang: value.preferences.lang === "en" ? "en" : "zh",
      theme: value.preferences.theme === "light" || value.preferences.theme === "dark" || value.preferences.theme === "fresh" ? value.preferences.theme : "system",
    };
    const strings = (items: unknown[]) => items.filter((item): item is string => typeof item === "string");
    return {
      version: 1,
      preferences,
      attempts: strings(value.attempts),
      bookmarks: strings(value.bookmarks),
      sessions: Object.fromEntries(Object.entries(value.sessions).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))),
    };
  } catch {
    return null;
  }
}

export function writeSyncBaseline(userId: string, snapshot: StorageSnapshot) {
  const baseline: SyncBaseline = {
    version: 1,
    preferences: { ...snapshot.preferences },
    attempts: snapshot.attempts.map((attempt) => attempt.id),
    bookmarks: [...snapshot.bookmarks],
    sessions: Object.fromEntries(Object.entries(snapshot.sessions).map(([key, session]) => [key, session.timestamp])),
  };
  try {
    window.localStorage.setItem(baselineKey(userId), JSON.stringify(baseline));
  } catch {
    // Sync still works when storage is unavailable; only conflict tracking is lost.
  }
}

export function clearSyncBaseline(userId: string) {
  try {
    window.localStorage.removeItem(baselineKey(userId));
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

export function clearAllSyncBaselines() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
    for (const key of keys) if (key?.startsWith(BASELINE_PREFIX)) window.localStorage.removeItem(key);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
