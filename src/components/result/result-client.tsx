"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Award, Check, Cloud, RefreshCw, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { getQuizVisualSelection, getResultKey, getResultScore, getScoreBand } from "@/core/quiz/scoring";
import { useAccountActions, useAccountIdentity, useAccountSync } from "@/components/account-provider";
import { AppHeader, FocusHeader, PageContainer } from "@/components/shell/app-shell";
import { AiInsightSection } from "@/components/result/ai-insight-section";
import { NarrativeSection } from "@/components/result/narrative-section";
import { ReflectionGuide } from "@/components/result/reflection-guide";
import { ResultDetails } from "@/components/result/result-details";
import { QuizVisualFrame } from "@/components/quiz/quiz-visual";
import { useLanguage } from "@/hooks/use-local-storage";
import { getAttemptById, getLatestAttempt } from "@/lib/storage";
import { pingResultRead } from "@/lib/metrics";
import { copyOrShare } from "@/lib/share";
/**
 * The composer is a form, an upload and a preview that only a minority of
 * readers open. It is fetched when they do, not with the result page.
 */
const CommunityComposer = dynamic(() => import("@/components/community/community-composer").then((mod) => mod.CommunityComposer), { ssr: false });
import type { ArchetypeData, DimensionData, Lang, PublicQuizCatalogEntry, QuizPaper, QuizResult, ScoreBand } from "@/core/quiz/types";

function pickNarrative(definition: QuizPaper, key: string, language: Lang) {
  const entry = definition.resultContent.narrative?.[key] ?? definition.resultContent.narrative?.[Object.keys(definition.resultContent.narrative ?? {})[0]];
  return entry?.[language];
}

function pickType(definition: QuizPaper, key: string, language: Lang) {
  const entry = definition.resultContent.types?.[key] ?? definition.resultContent.types?.[Object.keys(definition.resultContent.types ?? {})[0]];
  return entry?.[language];
}

function pickArchetype(definition: QuizPaper, key: string, language: Lang) {
  const entry = definition.resultContent.archetypes?.[key];
  if (!entry) return undefined;
  const localize = (zh: keyof ArchetypeData, en: keyof ArchetypeData) => language === "zh" ? entry[zh] : entry[en];
  const splitList = (value: unknown) => typeof value === "string"
    ? value.split(/[;；]/u).map((item) => item.trim()).filter(Boolean)
    : undefined;
  return {
    title: language === "zh" ? entry.title_zh ?? key : entry.title_en ?? key,
    description: language === "zh" ? entry.desc_zh : entry.desc_en,
    high: localize("high_zh", "high_en"),
    low: localize("low_zh", "low_en"),
    quote: localize("quote_zh", "quote_en"),
    traits: localize("traits_zh", "traits_en"),
    scenes: splitList(localize("scenes_zh", "scenes_en")),
    contradiction: localize("contradiction_zh", "contradiction_en"),
    growthCost: localize("growth_cost_zh", "growth_cost_en"),
    coreDesire: localize("core_desire_zh", "core_desire_en"),
    coreFear: localize("core_fear_zh", "core_fear_en"),
    loveStyle: localize("love_style_zh", "love_style_en"),
    breakdownStyle: localize("breakdown_style_zh", "breakdown_style_en"),
    defenseMechanism: localize("defense_mechanism_zh", "defense_mechanism_en"),
    growthPath: localize("growth_path_zh", "growth_path_en"),
    bestRelationship: localize("best_relationship_zh", "best_relationship_en"),
  };
}

function Loading({ language }: { language: Lang }) {
  return <div className="press-page atlas-page min-h-screen"><AppHeader /><main id="main-content" tabIndex={-1} className="atlas-loading" aria-busy="true"><span className="atlas-loading-orbit" aria-hidden="true" /><p role="status" aria-live="polite">{language === "zh" ? "正在整理你的回答…" : "Reading your responses…"}</p></main></div>;
}

const resultLeadCopy: Record<string, { zh: string; en: string }> = {
  self: {
    zh: "你更常用什么方式，走进这个世界？",
    en: "How do you tend to move through the world?",
  },
  emotion: {
    zh: "情绪起来时，你通常怎样照顾自己？",
    en: "How do you tend to care for yourself when emotions rise?",
  },
  relationship: {
    zh: "在靠近别人时，你也在保护什么？",
    en: "What are you protecting as you move closer to others?",
  },
  life: {
    zh: "你的日常，正在为哪些事留位置？",
    en: "What is your daily life making room for?",
  },
};

function getResultLead(category: string, language: Lang) {
  const copy = resultLeadCopy[category] ?? {
    zh: "这次回答，带来了什么线索？",
    en: "What clues did this response bring up?",
  };
  return language === "zh" ? copy.zh : copy.en;
}

function getDominantDimension(definition: QuizPaper, result: QuizResult, language: Lang) {
  const first = Object.entries(result.percentages ?? {}).sort((a, b) => b[1] - a[1])[0];
  if (!first) return undefined;
  const [key, score] = first;
  const metadata = definition.resultContent.dimensions?.[key];
  return {
    key,
    score,
    label: language === "zh" ? metadata?.zh ?? key : metadata?.name ?? key,
  };
}

interface ResultSummaryItem {
  label: string;
  value: string;
}

function getResultSummary(definition: QuizPaper, result: QuizResult, language: Lang): ResultSummaryItem[] {
  if (result.dimensions?.length) {
    return result.dimensions.map((dimension) => {
      const metadata = definition.resultContent.dimensions?.[dimension.name];
      const label = language === "zh"
        ? metadata?.zh ?? dimension.zh ?? dimension.name
        : metadata?.name ?? dimension.en ?? dimension.name;
      const hasPair = dimension.left && dimension.right
        && typeof dimension.leftScore === "number"
        && typeof dimension.rightScore === "number";
      const value = hasPair
        ? `${dimension.left} ${Math.round(dimension.leftScore ?? 0)}% / ${dimension.right} ${Math.round(dimension.rightScore ?? 0)}%`
        : `${Math.round(dimension.score)}%`;
      return { label, value };
    });
  }

  if (result.percentages && Object.keys(result.percentages).length) {
    return Object.entries(result.percentages).map(([key, score]) => {
      const metadata = definition.resultContent.dimensions?.[key];
      return {
        label: language === "zh" ? metadata?.zh ?? key : metadata?.name ?? key,
        value: `${Math.round(score)}%`,
      };
    });
  }

  const score = getResultScore(result);
  return score === null
    ? []
    : [{
        label: language === "zh" ? "这次的分数" : "Score in this response",
        value: `${Math.round(score)}%`,
      }];
}

type ResultDetailItem = { label: string; text: string };
type LocalizedArchetype = NonNullable<ReturnType<typeof pickArchetype>>;

interface ResultDetailsCopy {
  title: string;
  subtitle: string;
  items: ResultDetailItem[];
  quote?: string;
}

interface ResultDimensionEntry {
  key: string;
  label: string;
  score: number;
  metadata?: DimensionData;
}

function getResultDimensionEntries(definition: QuizPaper, result: QuizResult, language: Lang): ResultDimensionEntry[] {
  if (result.dimensions?.length) {
    return result.dimensions.map((dimension) => ({
      key: dimension.name,
      label: language === "zh"
        ? definition.resultContent.dimensions?.[dimension.name]?.zh ?? dimension.zh ?? dimension.name
        : definition.resultContent.dimensions?.[dimension.name]?.name ?? dimension.en ?? dimension.name,
      score: dimension.score,
      metadata: definition.resultContent.dimensions?.[dimension.name],
    }));
  }

  return Object.entries(result.percentages ?? {}).map(([key, score]) => ({
    key,
    label: language === "zh"
      ? definition.resultContent.dimensions?.[key]?.zh ?? key
      : definition.resultContent.dimensions?.[key]?.name ?? key,
    score,
    metadata: definition.resultContent.dimensions?.[key],
  }));
}

function getDimensionDetailText(
  entry: ResultDimensionEntry,
  archetype: LocalizedArchetype | undefined,
  language: Lang,
) {
  const score = Math.round(entry.score);
  const detail = score >= 65 ? archetype?.high : score <= 35 ? archetype?.low : undefined;
  const base = detail
    ?? entry.metadata?.observation?.[language]
    ?? (language === "zh" ? entry.metadata?.description : entry.metadata?.descriptionEn)
    ?? (language === "zh" ? `${entry.label} 是这次回答里的一条重要线索。` : `${entry.label} is one of the meaningful signals in this response.`);

  if (language === "zh") {
    if (detail) return `这条线索在这次回答里比较鲜明：${base}`;
    if (score >= 65) return `这已经是你比较常调用的方式：${base}`;
    if (score >= 45) return `你会在一些情境里这样反应：${base}`;
    if (score >= 35) return `这不是每次都会出现，但在某些情境里仍能被看见：${base}`;
    return `这可能不是你最先采用的方式：${base}`;
  }
  if (detail) return `This signal comes through clearly in these answers: ${base}`;
  if (score >= 65) return `This is one of the responses you call on more often: ${base}`;
  if (score >= 45) return `This shows up for you in some situations: ${base}`;
  if (score >= 35) return `This is not present every time, but it still appears in some situations: ${base}`;
  return `This may not be your first response: ${base}`;
}

function getResultDetails(
  definition: QuizPaper,
  result: QuizResult,
  language: Lang,
  narrative: ReturnType<typeof pickNarrative>,
  typeData: ReturnType<typeof pickType>,
  archetype: LocalizedArchetype | undefined,
  scoreBand: ScoreBand | undefined,
): ResultDetailsCopy | null {
  const items: ResultDetailItem[] = [];
  const add = (label: string, text?: unknown) => {
    if (typeof text === "string" && text.trim()) items.push({ label, text: text.trim() });
  };

  if (definition.kind === "type") {
    add(language === "zh" ? "你身上的小特质" : "Small traits that show up", archetype?.traits);
    add(language === "zh" ? "你真正想要的" : "What you may be protecting", archetype?.coreDesire);
    add(language === "zh" ? "你表达在乎的方式" : "How you show care", archetype?.loveStyle);
    add(language === "zh" ? "容易拉扯的地方" : "Where it can pull both ways", archetype?.contradiction ?? archetype?.growthCost);
    add(
      language === "zh" ? "压力上来时" : "When pressure rises",
      narrative?.underPressure
        ?? typeData?.underPressure
        ?? archetype?.growthCost
        ?? archetype?.breakdownStyle
        ?? archetype?.defenseMechanism,
    );
    add(language === "zh" ? "可以带走的一点" : "A useful direction", archetype?.growthPath);

    if (items.length < 3) {
      const ranked = getResultDimensionEntries(definition, result, language).sort((a, b) => b.score - a.score).slice(0, 2);
      ranked.forEach((entry) => add(entry.label, getDimensionDetailText(entry, undefined, language)));
    }

    if (!items.length) {
      add(language === "zh" ? "关系里的你" : "You in relationships", narrative?.inRelationship ?? typeData?.inRelationship);
      add(language === "zh" ? "你可以依靠的部分" : "What you can rely on", narrative?.hiddenStrength ?? typeData?.hiddenStrength);
    }

    if (!items.length) return null;
    return {
      title: language === "zh" ? "你可能会认出的细节" : "The details you may recognize",
      subtitle: language === "zh"
        ? "不是给你贴的新标签，而是把这次回答里容易被忽略的部分说得更具体。"
        : "Not a new label — just a closer look at the parts of this response that are easy to miss.",
      items: items.slice(0, 6),
      quote: archetype?.quote,
    };
  }

  if (definition.kind === "dimensions") {
    const ranked = getResultDimensionEntries(definition, result, language).sort((a, b) => b.score - a.score);
    ranked.slice(0, 3).forEach((entry) => {
      const dimensionArchetype = pickArchetype(definition, entry.key, language);
      add(entry.label, getDimensionDetailText(entry, dimensionArchetype, language));
    });

    if (ranked.length > 1) {
      const first = ranked[0];
      const second = ranked[1];
      add(
        language === "zh" ? "放在一起看" : "Look at the combination",
        language === "zh"
          ? `这次不只是「${first.label}」突出，「${second.label}」也同时出现。比起只盯着最高的一条，更值得留意的是：你可能会在不同场景里调用这两种方式。`
          : `It is not only “${first.label}” that stands out; “${second.label}” appears alongside it. Rather than focusing only on the highest score, notice how different situations may call on both tendencies.`,
      );
    }

    if (!items.length) return null;
    return {
      title: language === "zh" ? "你可能会认出的细节" : "The details you may recognize",
      subtitle: language === "zh"
        ? "分数只是入口，真正有用的是看见这些倾向在日常里怎样变成你的反应。"
        : "The scores are only an entry point. What matters is how these tendencies become real reactions in daily life.",
      items: items.slice(0, 4),
    };
  }

  if (definition.kind === "score") {
    const score = getResultScore(result);
    const ranked = getResultDimensionEntries(definition, result, language).sort((a, b) => b.score - a.score);
    add(
      language === "zh" ? "这个分数在生活里的样子" : "How this may feel in daily life",
      scoreBand?.description[language],
    );

    const suggestions = scoreBand?.suggestions?.[language];
    if (suggestions?.length) {
      add(
        language === "zh" ? "可以先试试" : "A place to begin",
        suggestions.join(language === "zh" ? "；" : " · "),
      );
    }

    ranked.slice(0, 3).forEach((entry) => add(entry.label, getDimensionDetailText(entry, undefined, language)));
    if (ranked.length > 1) {
      add(
        language === "zh" ? "分数背后的组合" : "The pattern behind the score",
        language === "zh"
          ? `整体分数之外，「${ranked[0].label}」和「${ranked.at(-1)?.label ?? ranked[1].label}」之间的差异，可能更能解释你在什么情况下会感觉顺手或费力。`
          : `Beyond the overall score, the difference between “${ranked[0].label}” and “${ranked.at(-1)?.label ?? ranked[1].label}” may explain when this feels easier or harder for you.`,
      );
    }

    if (!items.length && score !== null) {
      add(
        language === "zh" ? "先从这里看起" : "A place to start",
        language === "zh"
          ? `这次得分是 ${Math.round(score)}。比起把它当成高低判断，更值得留意的是哪些问题让你停顿，哪些部分最近最像你的生活。`
          : `This response landed at ${Math.round(score)}. Rather than treating it as a high-or-low judgment, notice which questions made you pause and what has felt most like your life lately.`,
      );
    }

    if (!items.length) return null;
    const hasSupportingSignals = ranked.length > 0;
    return {
      title: hasSupportingSignals
        ? (language === "zh" ? "把分数拆开看" : "Look beneath the score")
        : (language === "zh" ? "这个分数的更多细节" : "A closer look at this score"),
      subtitle: hasSupportingSignals
        ? (language === "zh"
          ? "整体分数告诉你大致位置，分项线索更接近你在生活里真正遇到的细节。"
          : "The overall score gives you a position. The separate signals are closer to what you actually experience day to day.")
        : (language === "zh"
          ? "分数不是结论，结合最近的生活情境看，它才会变成真正属于你的线索。"
          : "A score is not a conclusion. It becomes useful when you place it beside what has been happening in your life lately."),
      items: items.slice(0, 5),
    };
  }

  return null;
}

/** The topic label travels as plain data so the result never imports the catalog. */
type ResultTopic = PublicQuizCatalogEntry["topic"];

export default function ResultClient({ paper, topic }: { paper: QuizPaper; topic: ResultTopic }) {
  const router = useRouter();
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const { syncChoice, syncState } = useAccountSync();
  const { syncNow } = useAccountActions();
  const testId = paper.id;
  const [result, setResult] = useState<QuizResult | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attemptAnswers, setAttemptAnswers] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [syncWarning, setSyncWarning] = useState(false);
  const [visualFeedback, setVisualFeedback] = useState<"idle" | "sending" | "yes" | "no" | "error">("idle");
  const [loadedAccountScope, setLoadedAccountScope] = useState<string | null>();
  const accountScope = user?.id ?? null;

  // The quiz arrives prerendered; only the attempt is local. This waits for the
  // account scope to settle, then reads it — there is no paper to fetch.
  useEffect(() => {
    if (syncState === "loading" || syncState === "syncing") return;
    const timer = window.setTimeout(() => {
      setVisualFeedback("idle");
      const query = new URLSearchParams(window.location.search);
      setSyncWarning(query.get("sync") === "failed");
      const queryAttempt = query.get("attempt");
      const stored = queryAttempt ? getAttemptById(queryAttempt) : getLatestAttempt(testId);
      if (stored?.testId === testId) {
        setResult(stored.result);
        setAttemptId(stored.id);
        setAttemptAnswers(stored.answers.length > 0 ? stored.answers : null);
      } else {
        setResult(null);
        setAttemptId(null);
        setAttemptAnswers(null);
      }
      setLoadedAccountScope(accountScope);
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountScope, syncChoice, syncState, testId]);

  const content = useMemo(() => {
    if (!result) return null;
    const dominantDimension = getDominantDimension(paper, result, language);
    const key = getResultKey(result) || dominantDimension?.key || "";
    const narrative = pickNarrative(paper, key, language);
    const typeData = pickType(paper, key, language);
    const archetype = pickArchetype(paper, key, language);
    const scoreBand = getScoreBand(paper, result);
    const title = (scoreBand?.title[language] ?? narrative?.archetype ?? archetype?.title ?? typeData?.name ?? dominantDimension?.label ?? key) || (language === "zh" ? "这次的结果" : "Your result");
    const description = scoreBand?.description[language]
      ?? narrative?.subtitle
      ?? narrative?.description
      ?? narrative?.hero
      ?? archetype?.description
      ?? typeData?.description
      ?? (dominantDimension
        ? (language === "zh"
          ? `在这次回答里，「${dominantDimension.label}」相对更明显。它只是整体轮廓的一部分，其他方向也会随着情境变化。`
          : `${dominantDimension.label} stands out more in this response. It is one part of a wider profile, and other tendencies may shift with context.`)
        : undefined);
    const resultLabel = paper.kind === "type"
      ? (language === "zh" ? "你的类型" : "Your type")
      : paper.kind === "score"
        ? (language === "zh" ? "这次的状态区间" : "Your current range")
        : (language === "zh" ? "这次更鲜明的方向" : "What stands out this time");
    const identityNote = paper.kind === "type"
      ? (language === "zh"
        ? "这是一种你可以认领的倾向；在不同情境里，它也会呈现出不同侧面。"
        : "This is a tendency you can claim as your own; different situations may bring out different sides.")
      : paper.kind === "score"
        ? (language === "zh" ? "把它当作理解最近状态的一扇窗。" : "Use it as a window into how you have been lately.")
        : (language === "zh" ? "这些方向共同构成了这次回答的轮廓。" : "Together, these directions form the shape of this response.");
    return {
      key,
      narrative,
      typeData,
      title,
      description,
      resultLabel,
      identityNote,
      summary: getResultSummary(paper, result, language),
      lead: getResultLead(topic.id, language),
      details: getResultDetails(paper, result, language, narrative, typeData, archetype, scoreBand),
      visualSelection: getQuizVisualSelection(paper, result),
    };
  }, [language, paper, result, topic.id]);

  const share = useCallback(async () => {
    if (!content) return;
    setShareError(false);
    const shareUrl = new URL(window.location.href);
    const resultRoute = `/result/${testId}`;
    const resultRouteIndex = shareUrl.pathname.lastIndexOf(resultRoute);
    const basePath = resultRouteIndex >= 0 ? shareUrl.pathname.slice(0, resultRouteIndex) : "";
    shareUrl.pathname = `${basePath}/test/${testId}/`;
    shareUrl.search = "";
    shareUrl.hash = "";
    const url = shareUrl.toString();
    const text = language === "zh"
      ? `我完成了「${paper.title.zh}」，结果是 ${content.title}。`
      : `I completed “${paper.title.en}” and got ${content.title}.`;
    try {
      const outcome = await copyOrShare(navigator, { title: content.title, text, url });
      setCopied(outcome === "copied");
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setShareError(true);
    }
  }, [content, language, paper.title.en, paper.title.zh, testId]);

  const handleAttemptSynced = useCallback((nextAttemptId: string) => {
    setAttemptId(nextAttemptId);
    setSyncWarning(false);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("attempt", nextAttemptId);
    nextUrl.searchParams.delete("sync");
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  const submitVisualFeedback = useCallback(async (helpful: boolean) => {
    if (!content?.visualSelection || visualFeedback === "sending" || visualFeedback === "yes" || visualFeedback === "no") return;
    setVisualFeedback("sending");
    try {
      const response = await fetch("/api/metrics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "quiz_visual_helpfulness",
          quizId: testId,
          visualKey: content.visualSelection.key,
          helpful,
        }),
      });
      if (!response.ok) throw new Error("Feedback request failed");
      setVisualFeedback(helpful ? "yes" : "no");
    } catch {
      setVisualFeedback("error");
    }
  }, [content, testId, visualFeedback]);

  // The comprehension proxy: the disclaimer sits at the very end of the
  // result narrative, so seeing half of it means the reader scrolled through.
  const resultEndRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!result || typeof IntersectionObserver === "undefined") return;
    const node = resultEndRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          pingResultRead(testId);
        }
      }
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [result, testId]);

  if (loading || syncState === "loading" || loadedAccountScope !== accountScope) return <Loading language={language} />;
  if (!result || !content) {
    return <div className="press-page atlas-page min-h-screen"><AppHeader /><PageContainer><div className="atlas-empty-state mx-auto mt-16 max-w-lg"><h1 className="text-2xl font-semibold">{language === "zh" ? "还没有找到这次结果" : "No result found yet"}</h1><p className="mt-3 max-w-md text-sm leading-6 text-ink/55 dark:text-white/55">{language === "zh" ? "先完成一次测评。游客结果保存在本机；登录后会自动同步，也能在其他登录设备查看。" : "Complete the assessment once. Guest results stay on this device; after sign-in they sync automatically and are available on your other signed-in devices."}</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href={`/test/${testId}/`} className="press-primary-action atlas-primary-action justify-center">{language === "zh" ? "查看测评说明" : "View assessment details"}<ArrowRight className="size-4" /></Link><Link href="/" className="press-secondary-action atlas-secondary-action justify-center">{language === "zh" ? "返回首页" : "Back home"}</Link></div></div></PageContainer></div>;
  }

  const pattern = paper.kind;
  const accent = paper.accent;
  const testName = language === "zh" ? paper.title.zh : paper.title.en;
  const cloudSyncEnabled = Boolean(user && syncChoice === "merge");
  const saveStatus = syncWarning
    ? {
        title: language === "zh" ? "已保存在本机，云端同步失败" : "Saved on this device; cloud sync failed",
        description: language === "zh" ? "结果不会丢失，但这次记录尚未写入你的账号。" : "Your result is safe here, but this attempt was not added to your account.",
        warning: true,
      }
    : cloudSyncEnabled
      ? {
          title: language === "zh" ? "已同步到账号" : "Synced to your account",
          description: language === "zh" ? "可以在其他已登录设备查看这次结果。" : "You can view this result on your other signed-in devices.",
          warning: false,
        }
      : {
          title: language === "zh" ? "已保存在本机" : "Saved on this device",
          description: user
            ? (language === "zh" ? "当前未开启云同步，这次结果只保存在这台设备。" : "Cloud sync is off, so this result stays on this device.")
            : (language === "zh" ? "这次结果可以继续在当前设备查看。" : "You can return to this result on this device."),
          warning: false,
        };
  const showGuestAccountAction = !user && syncState === "guest";

  return (
    <div className="press-page atlas-page min-h-screen">
      <FocusHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={testName} />
      <PageContainer className="press-result-main">
        <section className={`press-result-status atlas-result-save-status${saveStatus.warning ? " atlas-result-save-status--warning" : ""}`} aria-label={language === "zh" ? "保存状态" : "Save status"}>
          <div className="press-result-status-copy atlas-result-save-status-copy" role="status">
            {saveStatus.warning ? <AlertTriangle aria-hidden="true" /> : cloudSyncEnabled ? <Cloud aria-hidden="true" /> : <Check aria-hidden="true" />}
            <div><strong>{saveStatus.title}</strong><p>{saveStatus.description}</p></div>
          </div>
          {showGuestAccountAction && <Link href="/account/" className="atlas-text-link shrink-0">{language === "zh" ? "登录后跨设备查看" : "Sign in for access across devices"}<ArrowRight className="size-3.5" aria-hidden="true" /></Link>}
        </section>
        <p className="press-result-badge-note atlas-result-badge-note"><Award className="size-3.5" aria-hidden="true" />{user ? <>{language === "zh" ? "新徽章已加入收藏 · " : "New badge added to your collection · "}<Link href="/account/">{language === "zh" ? "在个人资料中佩戴" : "wear it from your profile"}</Link></> : <Link href="/account/">{language === "zh" ? "登录后可收藏并佩戴这枚徽章" : "Sign in to collect and wear this badge"}</Link>}</p>
        <div className="press-result-intro atlas-result-intro-block" style={{ "--result-accent": accent } as React.CSSProperties}>
          <p className="press-result-question atlas-result-question">{content.lead}</p>
          <div className={`atlas-result-visual-layout${content.visualSelection ? " atlas-result-visual-layout--active" : ""}`}>
            {content.visualSelection && <QuizVisualFrame visual={content.visualSelection.visual} lang={language} sizes="(max-width: 720px) calc(100vw - 2.5rem), 26rem" className="atlas-result-visual" preload />}
            <div className="atlas-result-identity">
              <span className="atlas-result-identity-label">{content.resultLabel}</span>
              <h1 className="atlas-result-identity-title">{content.title}</h1>
              {content.description && <p className="atlas-result-identity-description">{content.description}</p>}
            </div>
          </div>
          {content.summary.length > 0 && (
            <div className={`atlas-result-summary${content.summary.length === 4 ? " atlas-result-summary--four" : ""}`} aria-label={language === "zh" ? "结果摘要" : "Result summary"}>
              {content.summary.map((item) => (
                <div key={item.label} className="atlas-result-summary-item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          )}
          <p className="atlas-result-identity-note">{content.identityNote}</p>
          {content.visualSelection && (
            <fieldset className="press-visual-feedback quiz-visual-feedback" disabled={visualFeedback === "sending" || visualFeedback === "yes" || visualFeedback === "no"}>
              <legend>{language === "zh" ? "图像是否帮助理解这次结果" : "Did the image help you understand this result?"}</legend>
              <div>
                <button type="button" onClick={() => submitVisualFeedback(true)} aria-pressed={visualFeedback === "yes"}><ThumbsUp aria-hidden="true" />{language === "zh" ? "有帮助" : "Yes"}</button>
                <button type="button" onClick={() => submitVisualFeedback(false)} aria-pressed={visualFeedback === "no"}><ThumbsDown aria-hidden="true" />{language === "zh" ? "没有帮助" : "No"}</button>
              </div>
              <p role="status" aria-live="polite">{visualFeedback === "sending" ? (language === "zh" ? "正在记录…" : "Saving…") : visualFeedback === "yes" || visualFeedback === "no" ? (language === "zh" ? "谢谢，你的选择已匿名计入汇总。" : "Thank you. Your choice was added to the anonymous total.") : visualFeedback === "error" ? (language === "zh" ? "暂时无法记录，请重试。" : "Could not save that choice. Please try again.") : ""}</p>
            </fieldset>
          )}
        </div>

        {content.details && <ResultDetails {...content.details} />}

        {!(paper.kind === "score" && !Object.keys(result.percentages ?? {}).length && !content.narrative && !content.typeData) && (
          <section className="press-result-panel atlas-result-panel mt-8"><h2 className="press-result-section-title atlas-result-section-title">{language === "zh" ? "结果解释" : "Result interpretation"}</h2><div className="mt-7"><NarrativeSection pattern={pattern} result={result} narrative={content.narrative} typeData={content.typeData} dimensions={paper.resultContent.dimensions} archetypes={paper.resultContent.archetypes} accentColor="var(--accent)" lang={language} introDescription={content.description} /></div></section>
        )}

        {testId === "attachment-style" && (
          <AiInsightSection testId={testId} lang={language} resultKey={content.key} percentages={result.percentages ?? {}} />
        )}

        <ReflectionGuide testId={testId} entry={{ topic }} pattern={pattern} result={result} dimensions={paper.resultContent.dimensions} accentColor={accent} lang={language} />

        {communityOpen && attemptId && <CommunityComposer attemptId={attemptId} testId={testId} answers={attemptAnswers ?? undefined} testName={testName} resultTitle={content.title} summary={content.summary} language={language} syncNow={syncNow} onAttemptSynced={handleAttemptSynced} onClose={() => setCommunityOpen(false)} />}
        <section className="press-result-actions mt-8 flex flex-col gap-3 border-t border-ink/10 pt-6 dark:border-white/10 sm:flex-row" aria-label={language === "zh" ? "结果操作" : "Result actions"}><button type="button" onClick={() => router.push(`/quiz/${testId}/`)} className="press-secondary-action atlas-secondary-action flex-1 justify-center"><RefreshCw className="size-4" aria-hidden="true" />{language === "zh" ? "重新测评" : "Retake"}</button><button type="button" onClick={share} className="press-secondary-action atlas-secondary-action flex-1 justify-center" aria-describedby="share-status">{copied ? <Check className="size-4" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}{copied ? (language === "zh" ? "已复制" : "Copied") : (language === "zh" ? "复制分享链接" : "Copy share link")}</button><button type="button" onClick={() => setCommunityOpen(true)} className="press-primary-action atlas-primary-action flex-1 justify-center"><Share2 className="size-4" aria-hidden="true" />{language === "zh" ? "公开分享结果" : "Share publicly"}</button></section>
        <p id="share-status" className="mt-3 min-h-5 text-center text-xs text-ink/55 dark:text-white/55" role="status" aria-live="polite">{copied ? (language === "zh" ? "分享文字和链接已复制。" : "Share text and link copied.") : shareError ? (language === "zh" ? "暂时无法分享或复制，请稍后再试。" : "Sharing and clipboard access are unavailable. Please try again.") : ""}</p>
        <div className="mt-5 flex flex-col gap-3 text-center text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-center"><Link href="/history/" className="atlas-text-link justify-center">{language === "zh" ? "查看历史" : "View history"}</Link><span className="hidden sm:inline">/</span><Link href={`/test/${testId}/`} className="atlas-text-link justify-center">{language === "zh" ? "查看测评说明" : "Assessment details"}</Link></div>
        <p ref={resultEndRef} className="mt-9 text-center text-xs leading-5 text-muted-foreground">{language === "zh" ? "仅用于自我反思，不构成诊断或专业评估。" : "For self-reflection only. This is not a diagnosis or professional assessment."}</p>
      </PageContainer>
    </div>
  );
}
