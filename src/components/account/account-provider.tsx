"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAccount,
  getCloudSnapshot,
  importCloudSnapshot,
  isSyncRevisionConflict,
  logoutAccount,
  getRemoteProfile,
  saveRemoteProfile,
  type AccountUser,
  type SyncChoice,
} from "@/lib/account";
import { mergeAccountSnapshots, readSyncBaseline, writeSyncBaseline } from "@/lib/account-sync";
import { AUTH_SESSION_EVENT, useSession } from "@/lib/auth-client";
import { PROFILE_EVENT, mergeLocalProfiles, parseLocalProfile, profileStorageKey, readLocalProfile, writeLocalProfile, type LocalProfile } from "@/lib/local-profile";
import { STORAGE_EVENT, activateStorageScope, isStorageAvailable, isStorageScopeActive, readSnapshot, writeAccountSnapshot, writeSnapshot, type StorageSnapshot } from "@/lib/storage";

export type { SyncChoice } from "@/lib/account";

type SyncState = "guest" | "loading" | "ready" | "syncing" | "error";

export interface SyncSummary {
  attempts: number;
  bookmarks: number;
  sessions: number;
}

/**
 * The account state is split by how often it changes. Most consumers only need
 * to know who is signed in; keeping the sync ticker and the action callbacks in
 * their own contexts means a sync no longer re-renders every avatar and feed on
 * the page.
 */
export interface AccountIdentity {
  user: AccountUser | null;
  profile: LocalProfile | null;
}

export interface AccountSyncStatus {
  syncState: SyncState;
  syncError: string;
  syncChoice: SyncChoice | null;
  /** Counts from the last successful cloud synchronization. */
  cloudSummary: SyncSummary | null;
  /** When the last successful synchronization finished, for "saved / synced" copy. */
  lastSyncedAt: number | null;
}

export interface AccountActions {
  saveProfile(profile: LocalProfile): Promise<{ profile: LocalProfile; localSaved: boolean; remoteSaved: boolean }>;
  refreshAccount(): Promise<void>;
  syncNow(): Promise<void>;
  signOut(): Promise<void>;
}

const AccountIdentityContext = createContext<AccountIdentity | null>(null);
const AccountSyncContext = createContext<AccountSyncStatus | null>(null);
const AccountActionsContext = createContext<AccountActions | null>(null);

function reconcileCloudSnapshot(local: StorageSnapshot, remote: StorageSnapshot): StorageSnapshot {
  const localById = new Map(local.attempts.map((attempt) => [attempt.id, attempt]));
  const remoteIds = new Set(remote.attempts.map((attempt) => attempt.id));
  const remoteAttempts = remote.attempts.map((attempt) => {
    const localAttempt = localById.get(attempt.id);
    return localAttempt ? { ...attempt, answers: localAttempt.answers } : attempt;
  });
  const localOnlyAttempts = local.attempts.filter((attempt) =>
    !remoteIds.has(attempt.id) && !attempt.id.startsWith("server:"),
  );
  return {
    ...remote,
    preferences: remote.preferences,
    attempts: [...remoteAttempts, ...localOnlyAttempts].sort((a, b) => a.timestamp - b.timestamp),
    bookmarks: remote.bookmarks,
    sessions: remote.sessions,
  };
}

function summarizeSnapshot(snapshot: StorageSnapshot): SyncSummary {
  return {
    attempts: snapshot.attempts.length,
    bookmarks: snapshot.bookmarks.length,
    sessions: Object.keys(snapshot.sessions).length,
  };
}

function emptyProfile(): LocalProfile {
  return { avatar: "", bio: "", tags: [], updatedAt: 0 };
}

function sameProfile(left: LocalProfile, right: LocalProfile) {
  return left.avatar === right.avatar
    && left.bio === right.bio
    && left.tags.join("\0") === right.tags.join("\0");
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { data: authSession, isPending: authSessionPending, refetch: refetchAuthSession } = useSession();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [syncChoice, setSyncChoiceState] = useState<SyncChoice | null>(null);
  const [cloudSummary, setCloudSummary] = useState<SyncSummary | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState("");
  const timer = useRef<number | null>(null);
  const applyingRemote = useRef(false);
  const syncing = useRef(false);
  const syncQueued = useRef(false);
  const userRef = useRef<AccountUser | null>(null);
  const writingLocalProfile = useRef(false);
  const profileWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const profileWriteVersion = useRef(0);
  const choiceRef = useRef<SyncChoice | null>(null);
  const refreshVersion = useRef(0);

  const setChoice = useCallback((choice: SyncChoice | null) => {
    choiceRef.current = choice;
    setSyncChoiceState(choice);
  }, []);

  const setProfileSafely = useCallback((next: LocalProfile | null) => {
    setProfile(next);
  }, []);

  const enqueueProfileWrite = useCallback(<T,>(task: () => Promise<T>) => {
    const next = profileWriteQueue.current.catch(() => undefined).then(task);
    profileWriteQueue.current = next.catch(() => undefined);
    return next;
  }, []);

  const persistLocalProfile = useCallback((userId: string, value: LocalProfile) => {
    writingLocalProfile.current = true;
    try {
      return writeLocalProfile(userId, value);
    } finally {
      writingLocalProfile.current = false;
    }
  }, []);

  const writeRemoteSafely = useCallback((snapshot: StorageSnapshot) => {
    applyingRemote.current = true;
    try {
      writeSnapshot(snapshot);
    } finally {
      applyingRemote.current = false;
    }
  }, []);

  const activateScopeSafely = useCallback((userId: string | null) => {
    applyingRemote.current = true;
    try {
      return activateStorageScope(userId);
    } finally {
      applyingRemote.current = false;
    }
  }, []);

  const isCurrentSync = useCallback((userId: string, version: number) =>
    version === refreshVersion.current
      && userRef.current?.id === userId
      && isStorageScopeActive(userId), []);

  const isCurrentAccount = useCallback((userId: string, version: number) =>
    version === refreshVersion.current && userRef.current?.id === userId, []);

  const loadProfile = useCallback(async (currentUser: AccountUser, version: number) => {
    const local = isStorageAvailable() ? readLocalProfile(currentUser.id) : emptyProfile();
    if (!isCurrentAccount(currentUser.id, version)) return;
    setProfileSafely(local);
    const mutationAtStart = profileWriteVersion.current;
    try {
      const response = await getRemoteProfile(currentUser.id);
      if (!isCurrentAccount(currentUser.id, version) || profileWriteVersion.current !== mutationAtStart || response.userId !== currentUser.id) return;
      const merged = mergeLocalProfiles(local, response.profile);
      let synced = merged;
      if (!sameProfile(merged, response.profile)) {
        const saved = await enqueueProfileWrite(async () => {
          if (!isCurrentAccount(currentUser.id, version) || profileWriteVersion.current !== mutationAtStart) return null;
          return saveRemoteProfile(currentUser.id, merged);
        });
        if (!saved || !isCurrentAccount(currentUser.id, version) || profileWriteVersion.current !== mutationAtStart) return;
        synced = saved.profile;
      }
      if (!isCurrentAccount(currentUser.id, version) || profileWriteVersion.current !== mutationAtStart) return;
      persistLocalProfile(currentUser.id, synced);
      setProfileSafely(synced);
    } catch {
      // Keep the local profile visible when the account profile is temporarily
      // unavailable. The next account refresh can reconcile it again.
    }
  }, [enqueueProfileWrite, isCurrentAccount, persistLocalProfile, setProfileSafely]);

  const saveProfile = useCallback(async (value: LocalProfile) => {
    const currentUser = userRef.current;
    const normalized = parseLocalProfile(value) ?? emptyProfile();
    const operation = ++profileWriteVersion.current;
    if (!currentUser) throw new Error("ACCOUNT_CHANGED");
    setProfileSafely(normalized);
    const localSaved = persistLocalProfile(currentUser.id, normalized);
    let saved;
    try {
      saved = await enqueueProfileWrite(async () => {
        if (userRef.current?.id !== currentUser.id || profileWriteVersion.current !== operation) return null;
        return saveRemoteProfile(currentUser.id, normalized);
      });
    } catch (error) {
      if (userRef.current?.id === currentUser.id && profileWriteVersion.current === operation) setProfileSafely(normalized);
      if (localSaved) return { profile: normalized, localSaved: true, remoteSaved: false };
      throw error;
    }
    if (!saved || userRef.current?.id !== currentUser.id || profileWriteVersion.current !== operation) throw new Error("PROFILE_SAVE_CANCELLED");
    const next = parseLocalProfile(saved.profile) ?? normalized;
    const finalLocalSaved = persistLocalProfile(currentUser.id, next);
    setProfileSafely(next);
    return { profile: next, localSaved: localSaved || finalLocalSaved, remoteSaved: true };
  }, [enqueueProfileWrite, persistLocalProfile, setProfileSafely]);

  const performSync = useCallback(async (currentUser: AccountUser, version: number) => {
    setSyncState("syncing");
    setSyncError("");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isCurrentSync(currentUser.id, version)) return false;
      const { snapshot: remote, revision } = await getCloudSnapshot(currentUser.id);
      if (!isCurrentSync(currentUser.id, version)) return false;
      const local = readSnapshot();
      const localFingerprint = JSON.stringify(local);
      const merged = mergeAccountSnapshots(local, remote, readSyncBaseline(currentUser.id));
      try {
        const { snapshot } = await importCloudSnapshot(currentUser.id, merged, revision, "merge");
        if (!isCurrentSync(currentUser.id, version)) return false;
        const next = reconcileCloudSnapshot(merged, snapshot);
        writeSyncBaseline(currentUser.id, next);
        setCloudSummary(summarizeSnapshot(next));

        const latestLocal = readSnapshot();
        if (JSON.stringify(latestLocal) === localFingerprint) {
          writeAccountSnapshot(currentUser.id, next);
          writeRemoteSafely(next);
        } else {
          writeAccountSnapshot(currentUser.id, latestLocal);
          syncQueued.current = true;
        }
        setLastSyncedAt(Date.now());
        setSyncState("ready");
        return true;
      } catch (error) {
        if (isSyncRevisionConflict(error)) continue;
        throw error;
      }
    }
    throw new Error("云端数据持续更新，请稍后重试");
  }, [isCurrentSync, writeRemoteSafely]);

  const syncNow = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser || choiceRef.current !== "merge" || applyingRemote.current || !isStorageScopeActive(currentUser.id)) return;
    if (syncing.current) {
      syncQueued.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        syncQueued.current = false;
        const nextUser = userRef.current;
        if (!nextUser || choiceRef.current !== "merge" || applyingRemote.current || !isStorageScopeActive(nextUser.id)) break;
        const version = refreshVersion.current;
        try {
          const completed = await performSync(nextUser, version);
          if (!completed && !syncQueued.current) break;
        } catch (error) {
          if (!isCurrentSync(nextUser.id, version)) {
            if (syncQueued.current) continue;
            break;
          }
          setSyncError(error instanceof Error ? error.message : "同步失败");
          setSyncState("error");
          syncQueued.current = false;
          break;
        }
      } while (syncQueued.current);
    } finally {
      syncing.current = false;
    }
  }, [isCurrentSync, performSync]);

  const refreshAccount = useCallback(async () => {
    const version = ++refreshVersion.current;
    profileWriteVersion.current += 1;
    setProfileSafely(null);
    setChoice(null);
    setSyncState("loading");
    setSyncError("");
    try {
      const account = await getAccount();
      if (version !== refreshVersion.current) return;
      activateScopeSafely(account.user?.id ?? null);
      userRef.current = account.user;
      setUser(account.user);
      if (!account.user) {
        setChoice(null);
        setCloudSummary(null);
        setLastSyncedAt(null);
        setSyncState("guest");
        return;
      }

      setChoice("merge");
      void loadProfile(account.user, version);
      // Private browsing and hardened browser policies can disable localStorage.
      // Keep the signed-in account usable with cloud-only reads in that case
      // instead of leaving the provider in its loading state forever.
      if (!isStorageAvailable()) {
        setCloudSummary(null);
        setSyncState("ready");
        return;
      }
      await syncNow();
    } catch (error) {
      if (version !== refreshVersion.current) return;
      setSyncError(error instanceof Error ? error.message : "账号状态加载失败");
      setSyncState("error");
    }
  }, [activateScopeSafely, loadProfile, setChoice, setProfileSafely, syncNow]);

  const signOut = useCallback(async () => {
    try {
      await logoutAccount();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "退出失败");
      setSyncState("error");
      return;
    }
    refreshVersion.current += 1;
    profileWriteVersion.current += 1;
    activateScopeSafely(null);
    userRef.current = null;
    syncing.current = false;
    syncQueued.current = false;
    setUser(null);
    setProfileSafely(null);
    setChoice(null);
    setCloudSummary(null);
    setLastSyncedAt(null);
    setSyncState("guest");
    setSyncError("");
  }, [activateScopeSafely, setChoice, setProfileSafely]);

  useEffect(() => {
    const readActiveProfile = () => {
      const currentUser = userRef.current;
      if (!currentUser || !isStorageAvailable()) return;
      setProfileSafely(readLocalProfile(currentUser.id));
    };
    const onProfileChange = (event: Event) => {
      const currentUser = userRef.current;
      if (!currentUser) return;
      const userId = (event as CustomEvent<{ userId?: unknown }>).detail?.userId;
      if (typeof userId === "string" && userId !== currentUser.id) return;
      if (!writingLocalProfile.current) profileWriteVersion.current += 1;
      readActiveProfile();
    };
    const onStorageChange = (event: StorageEvent) => {
      const currentUser = userRef.current;
      if (!currentUser || event.key !== profileStorageKey(currentUser.id)) return;
      profileWriteVersion.current += 1;
      readActiveProfile();
    };
    window.addEventListener(PROFILE_EVENT, onProfileChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      window.removeEventListener(PROFILE_EVENT, onProfileChange);
      window.removeEventListener("storage", onStorageChange);
    };
  }, [setProfileSafely]);

  useEffect(() => {
    if (authSessionPending) return;
    const timerId = window.setTimeout(() => { void refreshAccount(); }, 0);
    return () => window.clearTimeout(timerId);
  }, [authSession?.session.id, authSessionPending, refreshAccount]);

  useEffect(() => {
    const onAuthStorage = (event: StorageEvent) => {
      if (event.key === AUTH_SESSION_EVENT) void refetchAuthSession();
    };
    window.addEventListener("storage", onAuthStorage);
    return () => window.removeEventListener("storage", onAuthStorage);
  }, [refetchAuthSession]);

  useEffect(() => {
    if (!user || syncChoice !== "merge") return;
    const onStorageChange = () => {
      if (applyingRemote.current) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { void syncNow(); }, 700);
    };
    window.addEventListener(STORAGE_EVENT, onStorageChange);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onStorageChange);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [syncChoice, syncNow, user]);

  const identity = useMemo<AccountIdentity>(() => ({ user, profile }), [profile, user]);
  const sync = useMemo<AccountSyncStatus>(
    () => ({ syncState, syncError, syncChoice, cloudSummary, lastSyncedAt }),
    [cloudSummary, lastSyncedAt, syncChoice, syncError, syncState],
  );
  const actions = useMemo<AccountActions>(
    () => ({ saveProfile, refreshAccount, syncNow, signOut }),
    [refreshAccount, saveProfile, signOut, syncNow],
  );

  return (
    <AccountActionsContext.Provider value={actions}>
      <AccountIdentityContext.Provider value={identity}>
        <AccountSyncContext.Provider value={sync}>{children}</AccountSyncContext.Provider>
      </AccountIdentityContext.Provider>
    </AccountActionsContext.Provider>
  );
}

function requireAccountContext<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} must be used inside AccountProvider`);
  return value;
}

/** Who is signed in. The hook most consumers want. */
export function useAccountIdentity(): AccountIdentity {
  return requireAccountContext(use(AccountIdentityContext), "useAccountIdentity");
}

/** Cloud synchronization status. Re-renders on every sync tick by design. */
export function useAccountSync(): AccountSyncStatus {
  return requireAccountContext(use(AccountSyncContext), "useAccountSync");
}

/** Stable callbacks; this context value never changes after mount. */
export function useAccountActions(): AccountActions {
  return requireAccountContext(use(AccountActionsContext), "useAccountActions");
}
