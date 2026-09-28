import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getQuizEntry } from "@/core/quiz";
import type { QuizAttempt, QuizSession, StoragePreferences, StorageSnapshot } from "@/lib/storage";
import { STORAGE_VERSION } from "@/lib/storage";

/**
 * Limits are deliberately kept here rather than in individual route handlers.
 * This makes every write path (normal sync and backup import) use the same
 * resource and payload limits.
 */
export const CLOUD_DATA_LIMITS = {
  snapshotBytes: 1_500_000,
  resultBytes: 250_000,
  maxAttempts: 500,
  maxBookmarks: 200,
  maxSessions: 50,
  maxQuestions: 200,
  maxAnswer: 20,
  maxTestIdLength: 100,
  maxAttemptIdLength: 180,
  maxNameLength: 200,
  sessionTtlMs: 24 * 60 * 60 * 1000,
} as const;

const id = z.string().min(1).max(CLOUD_DATA_LIMITS.maxTestIdLength).regex(/^[a-z0-9-]+$/);
const attemptId = z.string().min(1).max(CLOUD_DATA_LIMITS.maxAttemptIdLength).regex(/^[a-zA-Z0-9:_-]+$/);
const answer = z.number().int().min(0).max(CLOUD_DATA_LIMITS.maxAnswer);
const sessionAnswer = answer.nullable();
const jsonObject = z.record(z.string(), z.json()).refine(
  (value) => Object.keys(value).length > 0 && byteLength(value) <= CLOUD_DATA_LIMITS.resultBytes,
  "Quiz result is empty or too large",
);

const preferencesSchema = z.strictObject({
  lang: z.enum(["zh", "en"]),
  theme: z.enum(["system", "light", "dark", "fresh"]),
});

const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/*
 * Completed answers are accepted for importing an existing v3 backup, but
 * normalizeCloudSnapshot strips them before persistence. New submissions use
 * cloudSubmissionSchema and never send a result or an attempt id.
 */
const importedAttemptSchema = z.strictObject({
  id: attemptId.optional(),
  testId: id,
  result: jsonObject,
  answers: z.array(answer).max(CLOUD_DATA_LIMITS.maxQuestions).default([]),
  testName: z.string().max(CLOUD_DATA_LIMITS.maxNameLength).optional(),
  testNameEn: z.string().max(CLOUD_DATA_LIMITS.maxNameLength).optional(),
  timestamp: z.number().int().min(0),
});

const quizSessionSchema = z.strictObject({
  answers: z.array(sessionAnswer).min(1).max(CLOUD_DATA_LIMITS.maxQuestions),
  currentQuestion: z.number().int().min(0).max(CLOUD_DATA_LIMITS.maxQuestions),
  // A client timestamp is accepted for v3 compatibility, then replaced by
  // the server clock. It must still be a finite integer to avoid odd JSON.
  timestamp: z.number().int().min(0),
});

const historicalSnapshotSchema = z.strictObject({
  version: z.literal(STORAGE_VERSION),
  preferences: preferencesSchema,
  attempts: z.array(importedAttemptSchema).max(CLOUD_DATA_LIMITS.maxAttempts),
  bookmarks: z.array(id).max(CLOUD_DATA_LIMITS.maxBookmarks),
  sessions: z.record(id, quizSessionSchema).refine(
    (value) => Object.keys(value).length <= CLOUD_DATA_LIMITS.maxSessions,
    "Too many quiz sessions",
  ),
});

const mutableSnapshotSchema = z.strictObject({
  version: z.literal(STORAGE_VERSION),
  preferences: preferencesSchema,
  bookmarks: z.array(id).max(CLOUD_DATA_LIMITS.maxBookmarks),
  sessions: z.record(id, quizSessionSchema).refine(
    (value) => Object.keys(value).length <= CLOUD_DATA_LIMITS.maxSessions,
    "Too many quiz sessions",
  ),
});

export const cloudMutableSnapshotSchema = mutableSnapshotSchema;
export const cloudHistoryImportSchema = historicalSnapshotSchema;

/** Full snapshot returned by the cloud API. Completed answers must be empty. */
export const cloudSnapshotSchema = historicalSnapshotSchema.superRefine((value, context) => {
  const ids = new Set<string>();
  value.attempts.forEach((attempt, index) => {
    const normalizedId = attempt.id;
    if (normalizedId !== undefined) {
      if (ids.has(normalizedId)) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "id"],
          message: "Duplicate attempt id",
        });
      }
      ids.add(normalizedId);
    }
    if (attempt.answers.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["attempts", index, "answers"],
        message: "Completed answers must not be stored in the cloud",
      });
    }
  });
});

export const cloudSubmissionSchema = z.strictObject({
  testId: id,
  answers: z.array(answer).min(1).max(CLOUD_DATA_LIMITS.maxQuestions),
}).superRefine((value, context) => {
  const quiz = getQuizEntry(value.testId);
  if (!quiz) {
    context.addIssue({ code: "custom", path: ["testId"], message: "Unknown quiz" });
  } else if (value.answers.length !== quiz.questions) {
    context.addIssue({ code: "custom", path: ["answers"], message: "Answer count does not match the quiz" });
  }
});

/** Regular sync can update mutable state, but cannot create completed records. */
export const cloudPutSchema = z.strictObject({
  baseRevision: revisionSchema,
  mode: z.enum(["merge", "replace"]).default("merge"),
  snapshot: mutableSnapshotSchema,
});

/** Browser history is accepted only through the dedicated history sync route. */
export const cloudImportPutSchema = z.strictObject({
  baseRevision: revisionSchema,
  mode: z.enum(["merge", "replace"]).default("merge"),
  snapshot: historicalSnapshotSchema,
});

export type CloudQuizSubmission = z.infer<typeof cloudSubmissionSchema>;
export type CloudSnapshotInput = z.infer<typeof cloudSnapshotSchema>;
export type CloudPutInput = z.infer<typeof cloudPutSchema>;
export type CloudImportPutInput = z.infer<typeof cloudImportPutSchema>;
export type CloudMutableSnapshot = z.infer<typeof mutableSnapshotSchema>;

export class CloudDataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudDataValidationError";
  }
}

function byteLength(value: unknown) {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (encoded === undefined) return Number.POSITIVE_INFINITY;
  return Buffer.byteLength(encoded, "utf8");
}

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new CloudDataValidationError(issue ? `${message}: ${issue.message}` : message);
  }
  return result.data;
}

function normalizeTimestamp(timestamp: number, now: number) {
  // Imported timestamps may be historical, but a client must not create
  // records materially in the future.
  if (timestamp > now + 24 * 60 * 60 * 1000) {
    throw new CloudDataValidationError("Invalid timestamp");
  }
  return Math.round(timestamp);
}

function normalizeImportedAttempt(value: z.infer<typeof importedAttemptSchema>, now: number): QuizAttempt {
  const fallbackId = createHash("sha256")
    .update(JSON.stringify([value.testId, value.timestamp, value.result]))
    .digest("hex")
    .slice(0, 16);
  const normalized: QuizAttempt = {
    // The id is optional in a v3 backup. A deterministic fallback lets a
    // repeated import remain idempotent without trusting client randomness.
    id: value.id ?? `${value.testId}:${value.timestamp}:${fallbackId}`,
    testId: value.testId,
    result: value.result,
    // Completed answers are intentionally not persisted in the cloud.
    answers: [],
    timestamp: normalizeTimestamp(value.timestamp, now),
  };
  if (value.testName !== undefined) normalized.testName = value.testName;
  if (value.testNameEn !== undefined) normalized.testNameEn = value.testNameEn;
  return normalized;
}

/** Validate a new completion request. No result, timestamp, or id is client-controlled. */
export function parseCloudSubmission(value: unknown): CloudQuizSubmission {
  if (byteLength(value) > 64_000) throw new CloudDataValidationError("Submission is too large");
  return parse(cloudSubmissionSchema, value, "Invalid quiz submission");
}

function normalizeMutableSnapshot(input: CloudMutableSnapshot, now: number): CloudMutableSnapshot {
  const sessions: Record<string, QuizSession> = {};
  for (const [testId, session] of Object.entries(input.sessions)) {
    if (session.timestamp > now + 24 * 60 * 60 * 1000) {
      throw new CloudDataValidationError("Invalid quiz session timestamp");
    }
    if (now - session.timestamp > CLOUD_DATA_LIMITS.sessionTtlMs) continue;
    const maxQuestion = session.answers.length - 1;
    sessions[testId] = {
      answers: [...session.answers],
      currentQuestion: Math.min(session.currentQuestion, maxQuestion),
      timestamp: now,
    };
  }
  return {
    version: STORAGE_VERSION,
    preferences: { ...input.preferences },
    bookmarks: Array.from(new Set(input.bookmarks)),
    sessions,
  };
}

/**
 * Validate and canonicalize a v3 snapshot received from the settings backup
 * flow. The returned value is safe to persist and contains no completed raw
 * answers. Session timestamps are refreshed to the server clock and stale
 * sessions are omitted.
 */
export function parseCloudSnapshot(value: unknown, now = Date.now()): StorageSnapshot {
  if (byteLength(value) > CLOUD_DATA_LIMITS.snapshotBytes) {
    throw new CloudDataValidationError("The backup is too large");
  }
  const input = parse(historicalSnapshotSchema, value, "Invalid storage snapshot");
  const attempts = input.attempts.map((attempt) => normalizeImportedAttempt(attempt, now));
  const attemptIds = new Set<string>();
  for (const attempt of attempts) {
    if (attemptIds.has(attempt.id)) {
      throw new CloudDataValidationError("Duplicate attempt id");
    }
    attemptIds.add(attempt.id);
  }
  const mutable = normalizeMutableSnapshot(input, now);
  return {
    version: STORAGE_VERSION,
    preferences: { ...mutable.preferences } satisfies StoragePreferences,
    attempts,
    bookmarks: mutable.bookmarks,
    sessions: mutable.sessions,
  };
}

/** Parse regular sync data. This route cannot import or forge attempts. */
export function parseCloudPut(value: unknown, now = Date.now()): { baseRevision: number; mode: "merge" | "replace"; snapshot: CloudMutableSnapshot } {
  if (byteLength(value) > CLOUD_DATA_LIMITS.snapshotBytes + 32_000) {
    throw new CloudDataValidationError("The request is too large");
  }
  const input = parse(cloudPutSchema, value, "Invalid cloud data request");
  return { baseRevision: input.baseRevision, mode: input.mode, snapshot: normalizeMutableSnapshot(input.snapshot, now) };
}

/** Parse a v3 history synchronization payload, including its merge/replace mode. */
export function parseCloudImportPut(value: unknown, now = Date.now()): { baseRevision: number; mode: "merge" | "replace"; snapshot: StorageSnapshot } {
  if (byteLength(value) > CLOUD_DATA_LIMITS.snapshotBytes + 32_000) {
    throw new CloudDataValidationError("The request is too large");
  }
  const input = parse(cloudImportPutSchema, value, "Invalid cloud import request");
  return { baseRevision: input.baseRevision, mode: input.mode, snapshot: parseCloudSnapshot(input.snapshot, now) };
}

/** A narrow helper for endpoint code that wants a stable error boundary. */
export function isCloudDataValidationError(value: unknown): value is CloudDataValidationError {
  return value instanceof CloudDataValidationError;
}
