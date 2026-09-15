"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CircleHelp, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import type { QuizQuestionSet } from "@/core/quiz";
import { FocusHeader } from "@/components/shell/app-shell";
import { useAccountIdentity, useAccountSync } from "@/components/account-provider";
import { useLanguage } from "@/hooks/use-local-storage";
import { submitCloudQuiz } from "@/lib/account";
import { clearQuizSession, getQuizSession, saveAttempt, saveQuizSession } from "@/lib/storage";
import { cn } from "@/lib/utils";

/** Hoisted: `questionTitleClass` runs once per character of every prompt. */
const WHITESPACE = /\s/;
const WIDE_GLYPH = /[㐀-鿿豈-﫿]/;
const AUTO_ADVANCE_MS = 160;
const SWIPE_DISTANCE = 55;

function questionTitleClass(prompt: string) {
  let visualLength = 0;
  for (const character of prompt) {
    if (WHITESPACE.test(character)) visualLength += 0.25;
    else if (WIDE_GLYPH.test(character)) visualLength += 1;
    else visualLength += 0.5;
  }

  if (visualLength >= 38) return "quiz-question-title--compact";
  if (visualLength >= 22) return "quiz-question-title--long";
  return undefined;
}

/** Every state of the answering flow shares one frame: back to the brief, and the quiz title. */
function QuizShell({ testId, section, className, labelledBy, busy, children }: {
  testId: string;
  section?: string;
  className?: string;
  labelledBy?: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const { language } = useLanguage();
  return (
    <div className="press-quiz-page atlas-page min-h-screen">
      <FocusHeader backHref={`/test/${testId}/`} backLabel={language === "zh" ? "测评说明" : "Assessment details"} section={section} />
      <main id="main-content" tabIndex={-1} className={className} aria-labelledby={labelledBy} aria-busy={busy}>{children}</main>
    </div>
  );
}

function DraftSaveStatus({ savedAt, label, warning }: { savedAt: string | null; label: string; warning: boolean }) {
  const { language } = useLanguage();
  if (!savedAt) return null;
  return (
    <div className={cn("quiz-draft-status", warning && "quiz-draft-status--warning")} role="status" aria-live="polite">
      <span className="quiz-draft-status-dot" aria-hidden="true" />
      <span>{language === "zh" ? "最近保存" : "Last saved"} {savedAt}</span>
      <span className="quiz-draft-status-separator" aria-hidden="true">·</span>
      <span>{label}</span>
    </div>
  );
}

interface DraftSession {
  answers: (number | null)[];
  currentQuestion: number;
  timestamp: number;
}

/**
 * The answering flow. Questions arrive prerendered from the server, so the first
 * paint is question one — there is no loading state to sit through. Only a saved
 * draft (read from this device after mount) can replace it with the resume panel.
 */
export default function QuizEngine({ questionSet }: { questionSet: QuizQuestionSet }) {
  const router = useRouter();
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const { syncChoice, syncState, lastSyncedAt } = useAccountSync();
  const total = questionSet.questions.length;

  const [answers, setAnswers] = useState<(number | null)[]>(() => new Array(total).fill(null) as (number | null)[]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [resumeSession, setResumeSession] = useState<DraftSession | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [direction, setDirection] = useState(1);

  /** The answers as of this instant. Handlers write a draft in the same tick they change them. */
  const answersRef = useRef(answers);
  const advanceTimer = useRef<number | null>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const optionListRef = useRef<HTMLDivElement>(null);
  const swipeAreaRef = useRef<HTMLDivElement>(null);
  const shouldFocusQuestion = useRef(false);

  const question = questionSet.questions[currentQuestion];
  const currentAnswer = answers[currentQuestion] ?? null;
  const isLast = currentQuestion === total - 1;
  const progress = total ? ((currentQuestion + 1) / total) * 100 : 0;

  /** One pass over the answers instead of a `filter` plus a `some` on every render. */
  const { answered, allAnswered } = useMemo(() => {
    let count = 0;
    for (const answer of answers) if (answer !== null) count += 1;
    return { answered: count, allAnswered: count === answers.length && answers.length > 0 };
  }, [answers]);

  const cloudSyncEnabled = Boolean(user && syncChoice === "merge");
  /**
   * Derived, not stored: a draft is waiting for the cloud whenever it was saved
   * after the last completed synchronization. The provider publishes
   * `lastSyncedAt`, which removes the state flag and the two effects the old
   * version needed to keep it honest.
   */
  const draftCloudPending = cloudSyncEnabled && draftSavedAt !== null && (lastSyncedAt === null || lastSyncedAt < draftSavedAt);

  // A draft belongs to this device, so it can only be read after mount. The
  // server-rendered question stays on screen for everyone without one. Deferred
  // by a tick, the way every other storage read in this codebase is.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const session = getQuizSession(questionSet.id);
      if (!session || session.answers.length !== total) return;
      setResumeSession({
        answers: session.answers,
        currentQuestion: Math.min(session.currentQuestion, total - 1),
        timestamp: session.timestamp,
      });
      setDraftSavedAt(session.timestamp);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [questionSet.id, total]);

  useEffect(() => {
    const updateConnection = () => setIsOffline(!window.navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
  }, []);

  const draftStatus = useMemo(() => {
    if (isOffline) {
      return { label: language === "zh" ? "本机已保存 · 当前离线" : "Saved on this device · Currently offline", warning: true };
    }
    if (cloudSyncEnabled && syncState === "error") {
      return { label: language === "zh" ? "本机已保存 · 云端同步失败" : "Saved on this device · Cloud sync failed", warning: true };
    }
    if (cloudSyncEnabled && syncState === "syncing") {
      return { label: language === "zh" ? "本机已保存 · 正在同步" : "Saved on this device · Syncing", warning: false };
    }
    if (cloudSyncEnabled && syncState === "ready") {
      return {
        label: draftCloudPending
          ? (language === "zh" ? "本机已保存 · 等待云端同步" : "Saved on this device · Waiting to sync")
          : (language === "zh" ? "本机已保存 · 云端同步已开启" : "Saved on this device · Cloud sync is on"),
        warning: false,
      };
    }
    return {
      label: user
        ? (language === "zh" ? "本机已保存，等待同步" : "Saved here, waiting to sync")
        : (language === "zh" ? "已保存到本机" : "Saved on this device"),
      warning: false,
    };
  }, [cloudSyncEnabled, draftCloudPending, isOffline, language, syncState, user]);

  const draftSavedLabel = useMemo(() => (draftSavedAt
    ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(draftSavedAt)
    : null), [draftSavedAt, language]);

  /** Writing the draft where the answers change, rather than in an effect that watches them. */
  const persistDraft = useCallback((nextAnswers: (number | null)[], nextQuestion: number) => {
    if (!nextAnswers.some((answer) => answer !== null)) return;
    saveQuizSession(questionSet.id, nextAnswers, nextQuestion);
    setDraftSavedAt(Date.now());
  }, [questionSet.id]);

  const move = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(next, total - 1));
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    if (bounded === currentQuestion) return;
    shouldFocusQuestion.current = true;
    setDirection(bounded > currentQuestion ? 1 : -1);
    setCurrentQuestion(bounded);
    persistDraft(answersRef.current, bounded);
  }, [currentQuestion, persistDraft, total]);

  const writeAnswer = useCallback((index: number) => {
    const next = [...answersRef.current];
    next[currentQuestion] = index;
    answersRef.current = next;
    setAnswers(next);
    persistDraft(next, currentQuestion);
  }, [currentQuestion, persistDraft]);

  /** Choosing an option: the answer lands, then the flow moves on by itself. */
  const recordAnswer = useCallback((index: number) => {
    writeAnswer(index);
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    if (isLast) return;
    const from = currentQuestion;
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null;
      move(from + 1);
    }, AUTO_ADVANCE_MS);
  }, [currentQuestion, isLast, move, writeAnswer]);

  /** Arrow keys inside the group behave like a radio group: select, stay put. */
  const selectOption = useCallback((index: number) => {
    writeAnswer(index);
    const options = optionListRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    options?.[index]?.focus({ preventScroll: true });
  }, [writeAnswer]);

  const submit = useCallback(async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const numericAnswers = answersRef.current as number[];
      let cloudFailed = false;
      let attempt;

      if (user && syncChoice === "merge") {
        try {
          const response = await submitCloudQuiz(user.id, questionSet.id, numericAnswers);
          attempt = saveAttempt({ ...response.attempt, answers: numericAnswers });
        } catch {
          cloudFailed = true;
        }
      }

      if (!attempt) {
        // The calculator is the one part of a quiz that cannot be prerendered.
        // It is fetched here, once, and only when it is actually needed.
        const { loadQuizDefinition, scoreQuiz } = await import("@/core/quiz");
        const definition = await loadQuizDefinition(questionSet.id);
        if (!definition) throw new Error("QUIZ_UNAVAILABLE");
        attempt = saveAttempt({
          testId: questionSet.id,
          result: scoreQuiz(definition, numericAnswers),
          answers: numericAnswers,
          testName: questionSet.title.zh,
          testNameEn: questionSet.title.en,
          timestamp: Date.now(),
        });
      }
      clearQuizSession(questionSet.id);
      const params = new URLSearchParams({ attempt: attempt.id });
      if (cloudFailed) params.set("sync", "failed");
      router.push(`/result/${questionSet.id}/?${params}`);
    } catch {
      setSubmitting(false);
      setSubmitError(language === "zh" ? "结果暂时无法保存，请再试一次。" : "Your result could not be saved. Please try again.");
    }
  }, [allAnswered, language, questionSet.id, questionSet.title.en, questionSet.title.zh, router, submitting, syncChoice, user]);

  const advance = useCallback(() => {
    if (currentAnswer === null) return;
    if (isLast) void submit();
    else move(currentQuestion + 1);
  }, [currentAnswer, currentQuestion, isLast, move, submit]);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (!question || submitting || resumeSession) return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select, [role='textbox']")))) return;
    if (document.querySelector("dialog[open], [role='dialog'][aria-modal='true']")) return;

    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < question.options.length) recordAnswer(index);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = question.options.length;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = currentAnswer ?? (step === 1 ? -1 : 0);
      selectOption((from + step + count) % count);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      advance();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(currentQuestion - 1);
    }
  }, [advance, currentAnswer, currentQuestion, move, question, recordAnswer, resumeSession, selectOption, submitting]);

  // One window listener for the life of the page. The ref keeps it reading the
  // current handler, so answering a question no longer re-binds it.
  const keyHandler = useRef(onKeyDown);
  useEffect(() => { keyHandler.current = onKeyDown; }, [onKeyDown]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const swipeHandler = useRef(advance);
  useEffect(() => { swipeHandler.current = advance; }, [advance]);
  const backHandler = useRef(move);
  useEffect(() => { backHandler.current = move; }, [move]);
  const questionIndex = useRef(currentQuestion);
  useEffect(() => { questionIndex.current = currentQuestion; }, [currentQuestion]);

  // Attached natively so both listeners can be passive: React's onTouchStart is
  // registered non-passively and makes the browser wait on the scroll.
  useEffect(() => {
    const node = swipeAreaRef.current;
    if (!node) return;
    let start: { x: number; y: number } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const from = start;
      start = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (dx < 0) swipeHandler.current();
      else backHandler.current(questionIndex.current - 1);
    };
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchend", onTouchEnd);
    };
  }, [resumeSession]);

  useEffect(() => {
    if (resumeSession || !shouldFocusQuestion.current) return;
    const heading = questionHeadingRef.current;
    if (!heading) return;
    shouldFocusQuestion.current = false;
    heading.focus({ preventScroll: true });
  }, [currentQuestion, resumeSession]);

  const startFresh = useCallback(() => {
    const fresh = new Array(total).fill(null) as (number | null)[];
    shouldFocusQuestion.current = true;
    clearQuizSession(questionSet.id);
    answersRef.current = fresh;
    setAnswers(fresh);
    setCurrentQuestion(0);
    setDraftSavedAt(null);
    setResumeSession(null);
  }, [questionSet.id, total]);

  const continueDraft = useCallback(() => {
    if (!resumeSession) return;
    shouldFocusQuestion.current = true;
    answersRef.current = resumeSession.answers;
    setAnswers(resumeSession.answers);
    setCurrentQuestion(resumeSession.currentQuestion);
    setResumeSession(null);
  }, [resumeSession]);

  if (!question) {
    return (
      <QuizShell testId={questionSet.id} className="atlas-empty-state mx-auto mt-24 max-w-md">
        <div role="alert">
          <CircleHelp className="mx-auto size-8 text-accent" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold">{language === "zh" ? "这项测评没有可用题目" : "This assessment has no available questions"}</h1>
          <Link href={`/test/${questionSet.id}/`} className="atlas-primary-action mx-auto mt-6">
            {language === "zh" ? "返回测评说明" : "Back to assessment details"}
          </Link>
        </div>
      </QuizShell>
    );
  }

  if (resumeSession) {
    const answeredInSession = resumeSession.answers.filter((answer) => answer !== null).length;
    return (
      <QuizShell testId={questionSet.id} className="mx-auto flex min-h-[70vh] max-w-lg items-center px-5 py-16">
        <div className="press-resume-panel atlas-resume-panel w-full">
          <span className="atlas-resume-symbol" aria-hidden="true">↗</span>
          <h1 className="mt-6 text-3xl font-semibold">{language === "zh" ? "你有一段未完成的回答。" : "You have an unfinished assessment."}</h1>
          <p className="mt-4 text-sm leading-6 text-ink/58 dark:text-white/58">
            {language === "zh"
              ? `已经回答 ${answeredInSession} 题，可以从第 ${resumeSession.currentQuestion + 1} 题继续。`
              : `${answeredInSession} answered. Continue from question ${resumeSession.currentQuestion + 1}.`}
          </p>
          <DraftSaveStatus savedAt={draftSavedLabel} label={draftStatus.label} warning={draftStatus.warning} />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={startFresh} className="press-secondary-action atlas-secondary-action flex-1 justify-center">
              <RotateCcw className="size-4" aria-hidden="true" />
              {language === "zh" ? "重新开始" : "Start fresh"}
            </button>
            <button type="button" onClick={continueDraft} className="press-primary-action atlas-primary-action flex-1 justify-center">
              <ArrowRight className="size-4" aria-hidden="true" />
              {language === "zh" ? "继续回答" : "Continue"}
            </button>
          </div>
        </div>
      </QuizShell>
    );
  }

  const quizTitle = language === "zh" ? questionSet.title.zh : questionSet.title.en;
  return (
    <QuizShell
      testId={questionSet.id}
      section={quizTitle}
      labelledBy="quiz-title"
      busy={submitting}
      className="press-quiz-main quiz-main mx-auto w-full max-w-3xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10"
    >
      <div className="press-quiz-heading-row quiz-heading-row">
        <h1 id="quiz-title" className="quiz-main-title">{quizTitle}</h1>
        <span className="atlas-progress-count">
          {String(currentQuestion + 1).padStart(2, "0")} <span>/ {String(total).padStart(2, "0")}</span>
        </span>
      </div>

      <div className="press-quiz-progress quiz-progress-block">
        <div
          className="atlas-meter"
          style={{ "--progress": progress / 100 } as React.CSSProperties}
          role="progressbar"
          aria-label={language === "zh" ? "答题进度" : "Quiz progress"}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={currentQuestion + 1}
          aria-valuetext={language === "zh" ? `第 ${currentQuestion + 1} 题，共 ${total} 题` : `Question ${currentQuestion + 1} of ${total}`}
        >
          <span className="atlas-meter-fill" />
        </div>
        <div className="quiz-progress-meta"><span>{answered} {language === "zh" ? "题已回答" : "answered"}</span></div>
        <DraftSaveStatus savedAt={answered > 0 ? draftSavedLabel : null} label={draftStatus.label} warning={draftStatus.warning} />
      </div>

      <div ref={swipeAreaRef} className="press-quiz-question-area quiz-question-area">
        <section key={question.id} className={cn("press-quiz-stage quiz-question-stage", direction > 0 ? "quiz-question-stage--next" : "quiz-question-stage--prev")}>
          <h2 ref={questionHeadingRef} tabIndex={-1} className={cn("press-quiz-question-title quiz-question-title", questionTitleClass(question.prompt[language]))}>
            {question.prompt[language]}
          </h2>
          <div className="press-answer-group quiz-answer-group">
            <div
              ref={optionListRef}
              className="press-answer-list quiz-answer-list"
              role="radiogroup"
              aria-label={language === "zh" ? "选择最接近你的回答" : "Choose the response closest to you"}
            >
              {question.options.map((option, index) => {
                const selected = currentAnswer === index;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={currentAnswer === null ? (index === 0 ? 0 : -1) : (selected ? 0 : -1)}
                    onClick={() => recordAnswer(index)}
                    className={cn("atlas-answer-option", selected && "atlas-answer-selected")}
                  >
                    <span className="atlas-answer-key" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                    <span className="flex-1 text-left">{option.label[language]}</span>
                    {selected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <div className="press-quiz-actions quiz-actions">
        <button type="button" onClick={() => move(currentQuestion - 1)} disabled={currentQuestion === 0} className="press-secondary-action atlas-secondary-action">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {language === "zh" ? "上一题" : "Previous"}
        </button>
        {isLast ? (
          <button type="button" onClick={submit} disabled={currentAnswer === null || submitting || !allAnswered} className="press-primary-action atlas-primary-action">
            {submitting ? (language === "zh" ? "正在整理……" : "Reading…") : (language === "zh" ? "查看结果" : "See result")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={() => move(currentQuestion + 1)} disabled={currentAnswer === null} className="press-primary-action atlas-primary-action">
            {language === "zh" ? "下一题" : "Next"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="press-quiz-submit-status mt-4 min-h-5 text-center text-xs" role="status" aria-live="polite">{submitError}</div>
      <p className="press-quiz-tip mt-5 text-center text-[11px] text-ink/35 dark:text-white/35">
        {language === "zh" ? "提示：1–9 选择，↑ ↓ 换选项，← → 换题" : "Tip: 1–9 to choose, ↑ ↓ between options, ← → between questions"}
      </p>
    </QuizShell>
  );
}
