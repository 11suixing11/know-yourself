"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Lang } from "@/core/quiz";

interface AiInsightSectionProps {
  testId: string;
  lang: Lang;
  resultKey: string;
  percentages: Record<string, number>;
}

const COPY = {
  title: { zh: "另一个视角", en: "Another angle" },
  note: {
    zh: "实验功能：由 AI 根据你的分数与本站人工编写的量表文案组装，仅供参考，不是诊断。",
    en: "Experimental: assembled by AI from your scores and this site's hand-written scale copy. A perspective, not a diagnosis.",
  },
  generate: { zh: "生成另一个视角", en: "Generate another angle" },
  regenerate: { zh: "重新生成", en: "Regenerate" },
  retry: { zh: "重试", en: "Retry" },
  loading: { zh: "正在组装…", en: "Assembling…" },
  error: { zh: "暂时生成不了，稍后再试一次。", en: "Could not generate this right now. Please try again later." },
  feedbackLegend: { zh: "这段文字有没有带来一点新东西", en: "Did this passage add anything new" },
  helpful: { zh: "有帮助", en: "Yes" },
  notHelpful: { zh: "没有帮助", en: "Not really" },
  feedbackSaving: { zh: "正在记录…", en: "Saving…" },
  feedbackDone: { zh: "谢谢，你的选择已匿名计入汇总。", en: "Thank you. Your choice was added to the anonymous total." },
  feedbackError: { zh: "暂时无法记录，请重试。", en: "Could not save that choice. Please try again." },
} as const;

function copyOf(field: keyof typeof COPY, lang: Lang) {
  return COPY[field][lang];
}

type Phase = "idle" | "loading" | "ready" | "error";
type Feedback = "idle" | "sending" | "yes" | "no" | "error";

/**
 * The pilot is invisible unless the server has a provider key configured, so
 * the experiment ships dark and can be turned off by clearing one env var.
 */
export function AiInsightSection({ testId, lang, resultKey, percentages }: AiInsightSectionProps) {
  const [checked, setChecked] = useState(false);
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quiz-insight", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json().catch(() => null) : null))
      .then((data: { available?: boolean } | null) => {
        if (cancelled) return;
        setAvailable(data?.available === true);
        setChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailable(false);
        setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pingStage = useCallback((stage: "requested" | "generated" | "failed") => {
    void fetch("/api/metrics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "ai_insight", quizId: testId, stage }),
    }).catch(() => {
      // Aggregate counters only; a lost ping loses nothing personal.
    });
  }, [testId]);

  const generate = useCallback(async () => {
    if (phase === "loading") return;
    setPhase("loading");
    setFeedback("idle");
    pingStage("requested");
    try {
      const response = await fetch("/api/quiz-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: testId, lang, resultKey, percentages }),
      });
      if (!response.ok) throw new Error("Insight request failed");
      const data = (await response.json().catch(() => null)) as { text?: string } | null;
      if (typeof data?.text !== "string" || !data.text) throw new Error("Empty insight");
      setText(data.text);
      setPhase("ready");
      pingStage("generated");
    } catch {
      setPhase("error");
      pingStage("failed");
    }
  }, [lang, percentages, phase, pingStage, resultKey, testId]);

  const submitFeedback = useCallback(async (helpful: boolean) => {
    if (feedback === "sending" || feedback === "yes" || feedback === "no") return;
    setFeedback("sending");
    try {
      const response = await fetch("/api/metrics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "ai_insight", quizId: testId, stage: helpful ? "helpful" : "not_helpful" }),
      });
      if (!response.ok) throw new Error("Feedback request failed");
      setFeedback(helpful ? "yes" : "no");
    } catch {
      setFeedback("error");
    }
  }, [feedback, testId]);

  if (!checked || !available || !resultKey) return null;

  return (
    <section className="press-result-panel atlas-result-panel mt-8" aria-label={copyOf("title", lang)}>
      <h2 className="press-result-section-title atlas-result-section-title">{copyOf("title", lang)}</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{copyOf("note", lang)}</p>
      {phase === "ready" ? (
        <>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{text}</p>
          <fieldset className="press-visual-feedback quiz-visual-feedback" disabled={feedback === "sending" || feedback === "yes" || feedback === "no"}>
            <legend>{copyOf("feedbackLegend", lang)}</legend>
            <div>
              <button type="button" onClick={() => submitFeedback(true)} aria-pressed={feedback === "yes"}><ThumbsUp aria-hidden="true" />{copyOf("helpful", lang)}</button>
              <button type="button" onClick={() => submitFeedback(false)} aria-pressed={feedback === "no"}><ThumbsDown aria-hidden="true" />{copyOf("notHelpful", lang)}</button>
            </div>
            <p role="status" aria-live="polite">{feedback === "sending" ? copyOf("feedbackSaving", lang) : feedback === "yes" || feedback === "no" ? copyOf("feedbackDone", lang) : feedback === "error" ? copyOf("feedbackError", lang) : ""}</p>
          </fieldset>
          <div className="mt-5">
            <button type="button" onClick={generate} className="press-secondary-action atlas-secondary-action"><Sparkles className="size-4" aria-hidden="true" />{copyOf("regenerate", lang)}</button>
          </div>
        </>
      ) : phase === "loading" ? (
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground" role="status">{copyOf("loading", lang)}</p>
      ) : phase === "error" ? (
        <div className="mt-5 flex flex-col items-start gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground" role="status">{copyOf("error", lang)}</p>
          <button type="button" onClick={generate} className="press-secondary-action atlas-secondary-action">{copyOf("retry", lang)}</button>
        </div>
      ) : (
        <div className="mt-5">
          <button type="button" onClick={generate} className="press-primary-action atlas-primary-action"><Sparkles className="size-4" aria-hidden="true" />{copyOf("generate", lang)}</button>
        </div>
      )}
    </section>
  );
}
