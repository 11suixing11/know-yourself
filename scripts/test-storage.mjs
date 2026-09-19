import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
async function compile(relativePath, dependencies = {}) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: relativePath });
  const testModule = { exports: {} };
  const requireModule = (request) => { if (request in dependencies) return dependencies[request]; throw new Error(`Unexpected runtime import in ${relativePath}: ${request}`); };
  new Function("require", "module", "exports", outputText)(requireModule, testModule, testModule.exports);
  return testModule.exports;
}

class LocalStorageMock {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries).map(([key, value]) => [key, String(value)])); }
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

function setupStorage(entries = {}) {
  const localStorage = new LocalStorageMock(entries);
  const events = [];
  globalThis.window = { localStorage, dispatchEvent(event) { events.push(event); return true; } };
  globalThis.Blob ??= class Blob { constructor(parts) { this.size = parts.join("").length; } };
  return { localStorage, events };
}

const storage = await compile("src/lib/storage.ts");
const registry = await compile("src/lib/test-registry.ts");
const homeFacets = await compile("src/lib/home-facets.ts");
const coreTests = await compile("src/lib/core-tests.ts", { "./test-registry": registry, "./home-facets": homeFacets });
const localProfile = await compile("src/lib/local-profile.ts");
const accountSync = await compile("src/lib/account-sync.ts");
const dataManager = await compile("src/lib/data-manager.ts", { "./storage": storage, "./core-tests": coreTests, "./local-profile": localProfile, "./account-sync": accountSync });

{
  const { localStorage } = setupStorage({
    "quiz-platform-theme": "dark",
    "quiz-platform-lang": "en",
    "quiz-platform:v2:attempts": JSON.stringify([{ testId: "legacy", result: { type: "OLD" }, timestamp: 1 }]),
  });
  assert.deepEqual(storage.getAttempts(), []);
  assert.deepEqual(storage.getBookmarks(), []);
  assert.deepEqual(storage.getPreferences(), { lang: "zh", theme: "system" });
  assert.equal(storage.getQuizSession("legacy"), null);
  assert.equal(localStorage.getItem(storage.STORAGE_KEY), null);
}

{
  const { events, localStorage } = setupStorage();
  const timestamp = 1_700_000_000_000;
  const attempt = storage.saveAttempt({ testId: "mbti", result: { type: "INTJ" }, answers: [1, 2], timestamp });
  storage.setBookmarks(["mbti", "big-five", "mbti"]);
  storage.setPreference("lang", "en");
  storage.setPreference("theme", "dark");
  storage.saveQuizSession("big-five", [1, null, 2], 1);
  assert.equal(storage.getAttempts().length, 1);
  assert.equal(storage.getAttemptById(attempt.id)?.testId, "mbti");
  const replaced = storage.replaceAttempt(attempt.id, { id: "server:1:replacement", testId: "mbti", result: { type: "INFJ" }, answers: [1, 2], timestamp });
  assert.equal(replaced?.id, "server:1:replacement");
  assert.equal(storage.getAttemptById(attempt.id), null);
  assert.equal(storage.getAttemptById("server:1:replacement")?.result.type, "INFJ");
  assert.equal(storage.getAttempts().length, 1);
  assert.deepEqual(storage.getBookmarks(), ["mbti", "big-five"]);
  assert.deepEqual(storage.getPreferences(), { lang: "en", theme: "dark" });
  assert.deepEqual(storage.getQuizSession("big-five")?.answers, [1, null, 2]);
  assert.equal(JSON.parse(localStorage.getItem(storage.STORAGE_KEY)).version, 3);
  assert(events.some((event) => event.type === storage.STORAGE_EVENT));
}

{
  setupStorage();
  const base = { version: 3, preferences: { lang: "en", theme: "light" }, attempts: [{ id: "a", testId: "mbti", result: { type: "ENTP" }, answers: [0], timestamp: 10 }], bookmarks: ["mbti"], sessions: {} };
  const merge = dataManager.importData(JSON.stringify(base), "merge");
  assert.equal(merge.success, true);
  assert.equal(storage.getAttempts().length, 1);
  assert.equal(storage.getLanguage(), "en");
  const replace = dataManager.importData(JSON.stringify({ ...base, attempts: [{ id: "b", testId: "big-five", result: { percentages: { O: 80 } }, answers: [1], timestamp: 20 }], bookmarks: ["big-five"] }), "replace");
  assert.equal(replace.success, true);
  assert.equal(replace.imported, 1);
  assert.deepEqual(storage.getAttempts().map((item) => item.id), ["b"]);
  assert.deepEqual(storage.getBookmarks(), ["big-five"]);
}

{
  setupStorage();
  storage.saveAttempt({ testId: "mbti", result: { score: 80 }, answers: [], timestamp: 10 });
  storage.saveAttempt({ testId: "attachment-style", result: { score: 60 }, answers: [], timestamp: 20 });
  assert.deepEqual(dataManager.getDataStats().categories, { self: 1, relationship: 1 });
}

{
  const { events, localStorage } = setupStorage();
  localProfile.writeLocalProfile("user-a", { avatar: "data:image/jpeg;base64,test", bio: "  保持好奇  ", tags: ["安静", "探索者"], updatedAt: 10 });
  localProfile.writeLocalProfile("user-b", { avatar: "", bio: "Different account", tags: ["Reader"], updatedAt: 20 });
  assert.equal(localProfile.readLocalProfile("user-a").bio, "  保持好奇  ");
  assert.deepEqual(localProfile.readLocalProfile("user-a").tags, ["安静", "探索者"]);
  assert.equal(localProfile.readLocalProfile("user-b").bio, "Different account");
  assert.equal(localStorage.length, 2);
  assert(events.some((event) => event.type === localProfile.PROFILE_EVENT && event.detail.userId === "user-a"));
  assert.equal(localProfile.profileStorageKey("user-a"), "know-yourself:profile:user-a");
  const mergedProfile = localProfile.mergeLocalProfiles(
    { avatar: "old", bio: "local", tags: ["安静"], updatedAt: 10 },
    { avatar: "new", bio: "cloud", tags: ["探索者"], updatedAt: 20 },
  );
  assert.equal(mergedProfile.avatar, "new");
  assert.equal(mergedProfile.bio, "cloud");
  assert.deepEqual(mergedProfile.tags, ["探索者"]);
  const clearedProfile = localProfile.mergeLocalProfiles(
    { avatar: "", bio: "", tags: [], updatedAt: 30 },
    { avatar: "old", bio: "old", tags: ["old"], updatedAt: 20 },
  );
  assert.deepEqual(clearedProfile, { avatar: "", bio: "", tags: [], updatedAt: 30 });
  const legacyProfile = localProfile.mergeLocalProfiles(
    { avatar: "legacy", bio: "", tags: ["安静"], updatedAt: 0 },
    { avatar: "", bio: "cloud", tags: ["探索者"], updatedAt: 0 },
  );
  assert.deepEqual(legacyProfile, { avatar: "legacy", bio: "cloud", tags: ["安静", "探索者"], updatedAt: 0 });
  const mixedLegacyProfile = localProfile.mergeLocalProfiles(
    { avatar: "legacy", bio: "", tags: ["安静"], updatedAt: 0 },
    { avatar: "", bio: "cloud", tags: ["探索者"], updatedAt: 20 },
  );
  assert.deepEqual(mixedLegacyProfile, { avatar: "legacy", bio: "cloud", tags: ["探索者", "安静"], updatedAt: 20 });
  localProfile.clearLocalProfile("user-a");
  assert.deepEqual(localProfile.readLocalProfile("user-a"), { avatar: "", bio: "", tags: [], updatedAt: 0 });
  assert(events.some((event) => event.type === localProfile.PROFILE_EVENT && event.detail.userId === "user-a"));
}

{
  const { events, localStorage } = setupStorage();
  localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(localProfile.writeLocalProfile("user-a", { avatar: "", bio: "Unsaved", tags: [], updatedAt: 1 }), false);
  assert.equal(events.some((event) => event.type === localProfile.PROFILE_EVENT), false);
}

{
  const local = {
    version: 3,
    preferences: { lang: "zh", theme: "system" },
    attempts: [{ id: "local", testId: "mbti", result: { type: "INTJ" }, answers: [1], timestamp: 10 }],
    bookmarks: ["mbti"],
    sessions: { mbti: { answers: [1, null], currentQuestion: 1, timestamp: 10 } },
  };
  const remote = {
    version: 3,
    preferences: { lang: "en", theme: "dark" },
    attempts: [{ id: "remote", testId: "big-five", result: { score: 80 }, answers: [], timestamp: 20 }],
    bookmarks: ["big-five"],
    sessions: { mbti: { answers: [1, 2], currentQuestion: 2, timestamp: 20 } },
  };
  const initial = accountSync.mergeAccountSnapshots(local, remote, null);
  assert.deepEqual(initial.attempts.map((attempt) => attempt.id), ["local", "remote"]);
  assert.deepEqual(initial.bookmarks, ["mbti", "big-five"]);
  assert.deepEqual(initial.preferences, local.preferences);
  assert.equal(initial.sessions.mbti.timestamp, 20);

  setupStorage();
  accountSync.writeSyncBaseline("user-a", {
    ...initial,
    attempts: [
      ...initial.attempts,
      { id: "deleted-remotely", testId: "boundaries", result: { score: 50 }, answers: [0], timestamp: 30 },
    ],
    bookmarks: ["keep", "deleted-locally", "deleted-remotely"],
    sessions: {
      shared: { answers: [0], currentQuestion: 0, timestamp: 10 },
      "deleted-locally": { answers: [0], currentQuestion: 0, timestamp: 10 },
      "deleted-remotely": { answers: [0], currentQuestion: 0, timestamp: 10 },
    },
  });
  const baseline = accountSync.readSyncBaseline("user-a");
  const ongoing = accountSync.mergeAccountSnapshots(
    {
      ...local,
      preferences: initial.preferences,
      attempts: [...initial.attempts, { id: "deleted-remotely", testId: "boundaries", result: { score: 50 }, answers: [0], timestamp: 30 }],
      bookmarks: ["keep", "deleted-remotely", "local-new"],
      sessions: {
        shared: { answers: [1], currentQuestion: 0, timestamp: 30 },
        "deleted-remotely": { answers: [0], currentQuestion: 0, timestamp: 10 },
        "local-new": { answers: [1], currentQuestion: 0, timestamp: 30 },
      },
    },
    {
      ...remote,
      preferences: { lang: "en", theme: "dark" },
      attempts: initial.attempts,
      bookmarks: ["keep", "deleted-locally", "remote-new"],
      sessions: {
        shared: { answers: [2], currentQuestion: 0, timestamp: 20 },
        "deleted-locally": { answers: [0], currentQuestion: 0, timestamp: 10 },
        "remote-new": { answers: [2], currentQuestion: 0, timestamp: 30 },
      },
    },
    baseline,
  );
  assert.equal(ongoing.attempts.some((attempt) => attempt.id === "deleted-remotely"), false);
  assert.deepEqual(ongoing.bookmarks, ["keep", "local-new", "remote-new"]);
  assert.deepEqual(Object.keys(ongoing.sessions), ["shared", "local-new", "remote-new"]);
  assert.equal(ongoing.sessions.shared.timestamp, 30);
  assert.deepEqual(ongoing.preferences, { lang: "en", theme: "dark" });
  const recreated = accountSync.mergeAccountSnapshots(
    { ...local, sessions: { recreated: { answers: [1], currentQuestion: 0, timestamp: 20 } } },
    { ...remote, sessions: {} },
    { version: 1, preferences: local.preferences, attempts: [], bookmarks: [], sessions: { recreated: 10 } },
  );
  assert.equal(recreated.sessions.recreated.timestamp, 20);
}

{
  const { localStorage } = setupStorage();
  localProfile.writeLocalProfile("user-a", { avatar: "avatar", bio: "bio", tags: ["tag"], updatedAt: 30 });
  const exported = JSON.parse(dataManager.exportAllData("user-a"));
  assert.equal(exported.profile.bio, "bio");
  const backup = { ...exported, profile: { avatar: "", bio: "restored", tags: ["backup"], updatedAt: 40 } };
  assert.equal(dataManager.importData(JSON.stringify(backup), "merge", "user-a").success, true);
  assert.equal(localProfile.readLocalProfile("user-a").bio, "restored");
  accountSync.writeSyncBaseline("user-a", exported);
  assert.notEqual(accountSync.readSyncBaseline("user-a"), null);
  dataManager.clearAllData("user-a");
  assert.equal(localProfile.readLocalProfile("user-a").bio, "");
  assert.equal(accountSync.readSyncBaseline("user-a"), null);
  assert.equal(localStorage.getItem(storage.STORAGE_KEY) !== null, true);
}

{
  setupStorage();
  storage.saveAttempt({ id: "guest", testId: "mbti", result: { type: "INTJ" }, answers: [], timestamp: 1 });
  storage.activateStorageScope(null);
  storage.activateStorageScope("user-a");
  storage.saveAttempt({ id: "account-a", testId: "big-five", result: { score: 70 }, answers: [], timestamp: 2 });
  storage.activateStorageScope("user-b");
  assert.deepEqual(storage.getAttempts(), []);
  storage.saveAttempt({ id: "account-b", testId: "boundaries", result: { score: 60 }, answers: [], timestamp: 3 });
  storage.activateStorageScope("user-a");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["account-a", "guest"]);
  storage.activateStorageScope(null);
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["guest"]);
  storage.activateStorageScope("user-b");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["account-b", "guest"]);
  assert.equal(storage.isStorageScopeActive("user-b"), true);
  assert.equal(storage.isStorageScopeActive("user-a"), false);
}

// Signing in to an existing account merges the guest copy into that account,
// while switching accounts and signing out keep each scope isolated.
{
  setupStorage();
  storage.activateStorageScope(null);
  storage.saveAttempt({ id: "guest-only", testId: "mbti", result: { type: "INTJ" }, answers: [1], timestamp: 1 });
  storage.setBookmarks(["guest-bookmark"]);
  storage.saveQuizSession("mbti", [1, null], 1);

  // Seed an existing account snapshot without making it the active scope.
  storage.writeAccountSnapshot("existing", {
    version: 3,
    preferences: { lang: "en", theme: "dark" },
    attempts: [
      { id: "account-only", testId: "big-five", result: { score: 70 }, answers: [], timestamp: 2 },
      { id: "shared", testId: "boundaries", result: { score: 40 }, answers: [], timestamp: 3 },
    ],
    bookmarks: ["account-bookmark"],
    sessions: { "big-five": { answers: [0], currentQuestion: 0, timestamp: 2 } },
  });
  storage.saveAttempt({ id: "shared", testId: "boundaries", result: { score: 80 }, answers: [2, 1], timestamp: 4 });

  storage.activateStorageScope("existing");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["shared", "account-only", "guest-only"]);
  assert.deepEqual(storage.getAttemptById("shared")?.answers, [2, 1]);
  assert.equal(storage.getAttemptById("shared")?.result.score, 80);
  assert.deepEqual(storage.getBookmarks(), ["guest-bookmark", "account-bookmark"]);
  assert.deepEqual(Object.keys(storage.readAccountSnapshot("existing").sessions).sort(), ["big-five", "mbti"]);
  assert.deepEqual(storage.getPreferences(), { lang: "zh", theme: "system" });

  // Signing out restores the original guest copy, not the merged account.
  storage.activateStorageScope(null);
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["shared", "guest-only"]);
  assert.deepEqual(storage.getBookmarks(), ["guest-bookmark"]);
  assert.deepEqual(Object.keys(storage.readAccountSnapshot("existing").sessions).sort(), ["big-five", "mbti"]);
}

// Deleting an account preserves pre-existing guest data instead of replacing it.
{
  setupStorage();
  storage.activateStorageScope(null);
  storage.saveAttempt({ id: "guest-before-delete", testId: "mbti", result: { type: "INFP" }, answers: [], timestamp: 1 });
  storage.activateStorageScope("former-user");
  storage.saveAttempt({ id: "account-before-delete", testId: "big-five", result: { score: 60 }, answers: [], timestamp: 2 });
  const accountSnapshot = storage.readSnapshot();
  storage.adoptSnapshotAsGuest(accountSnapshot, "former-user");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["account-before-delete", "guest-before-delete"]);
  assert.equal(storage.readAccountSnapshot("former-user"), null);
  storage.activateStorageScope(null);
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["account-before-delete", "guest-before-delete"]);
  storage.writeAccountSnapshot("former-user", storage.createEmptySnapshot());
  storage.activateStorageScope("former-user");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["account-before-delete", "guest-before-delete"]);
}

// A guest item imported into an account must not be resurrected after it is
// deleted from the account, even though the independent guest copy still has
// the old item. Guest data created after that import still merges normally.
{
  setupStorage();
  storage.activateStorageScope(null);
  storage.saveAttempt({ id: "guest-imported", testId: "mbti", result: { type: "INTJ" }, answers: [1], timestamp: 10 });
  storage.setBookmarks(["guest-imported"]);
  storage.saveQuizSession("guest-imported", [1, null], 1);

  storage.activateStorageScope("user-with-deletion");
  storage.deleteAttempt("guest-imported");
  storage.setBookmarks([]);
  storage.clearQuizSession("guest-imported");
  storage.setPreference("lang", "en");
  storage.setPreference("theme", "dark");

  storage.activateStorageScope(null);
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["guest-imported"]);
  assert.deepEqual(storage.getBookmarks(), ["guest-imported"]);
  assert.notEqual(storage.getQuizSession("guest-imported"), null);
  storage.saveAttempt({ id: "guest-new", testId: "big-five", result: { score: 75 }, answers: [2], timestamp: 20 });
  storage.setBookmarks(["guest-imported", "guest-new"]);
  storage.saveQuizSession("guest-new", [2], 0);

  storage.activateStorageScope("user-with-deletion");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["guest-new"]);
  assert.deepEqual(storage.getBookmarks(), ["guest-new"]);
  assert.equal(storage.getQuizSession("guest-imported"), null);
  assert.notEqual(storage.getQuizSession("guest-new"), null);
  assert.deepEqual(storage.getPreferences(), { lang: "en", theme: "dark" });
}

{
  setupStorage();
  storage.activateStorageScope(null);
  storage.saveAttempt({ id: "guest", testId: "mbti", result: { type: "INTJ" }, answers: [], timestamp: 1 });
  storage.activateStorageScope("user-a");
  storage.saveAttempt({ id: "account-a", testId: "big-five", result: { score: 70 }, answers: [], timestamp: 2 });
  storage.activateStorageScope("user-b");
  storage.saveAttempt({ id: "account-b", testId: "boundaries", result: { score: 60 }, answers: [], timestamp: 3 });
  localProfile.writeLocalProfile("user-a", { avatar: "", bio: "A", tags: [], updatedAt: 1 });
  localProfile.writeLocalProfile("user-b", { avatar: "", bio: "B", tags: [], updatedAt: 1 });
  accountSync.writeSyncBaseline("user-a", { ...storage.readSnapshot(), attempts: [], bookmarks: [], sessions: {} });
  accountSync.writeSyncBaseline("user-b", storage.readSnapshot());
  dataManager.clearAllData("user-b");
  assert.deepEqual(storage.getAttempts(), []);
  assert.equal(localProfile.readLocalProfile("user-b").bio, "");
  assert.equal(accountSync.readSyncBaseline("user-b"), null);
  storage.activateStorageScope("user-a");
  assert.deepEqual(storage.getAttempts().map((attempt) => attempt.id), ["account-a", "guest"]);
  assert.equal(localProfile.readLocalProfile("user-a").bio, "A");
  assert.notEqual(accountSync.readSyncBaseline("user-a"), null);
}

{
  setupStorage({
    ["know-yourself:v3"]: JSON.stringify({
      version: 3,
      preferences: { lang: "zh", theme: "system" },
      attempts: [],
      bookmarks: [],
      sessions: { mbti: { answers: [1, null], currentQuestion: 99, timestamp: Date.now() } },
    }),
  });
  assert.equal(storage.getQuizSession("mbti")?.currentQuestion, 1);
}

{
  setupStorage();
  storage.saveAttempt({ testId: "mbti", result: { type: "INTJ" }, answers: [], timestamp: 1 });
  storage.setBookmarks(["mbti"]);
  storage.saveQuizSession("mbti", [null], 0);
  storage.clearAllData();
  assert.deepEqual(storage.getAttempts(), []);
  assert.deepEqual(storage.getBookmarks(), []);
  assert.equal(storage.getQuizSession("mbti"), null);
  assert.deepEqual(storage.getPreferences(), { lang: "zh", theme: "system" });
}

console.log("✓ Storage v3 snapshot, history, bookmarks, sessions, import/export, and legacy isolation");
