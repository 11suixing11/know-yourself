"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3, Trash2 } from "lucide-react";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useAccountIdentity, useAccountSync } from "@/components/account-provider";
import { useAttempts, useLanguage } from "@/hooks/use-local-storage";
import { getQuizEntry, getResultKey, getResultScore, getScoreBand, loadQuizDefinition, type QuizDefinition, type QuizResult } from "@/core/quiz";
import { clearCloudAttempts, deleteCloudAttempt } from "@/lib/account";
import { clearAttempts } from "@/lib/storage";
import { pingContinuationHistory } from "@/lib/metrics";
import { CategoryMark } from "@/components/quiz/category-mark";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function friendlyLabel(value: string | undefined, key: string) {
  if (!value) return undefined;
  const label = value.trim().replace(new RegExp(`^${escapeRegExp(key)}\\s*[-–—:：]\\s*`, "u"), "");
  if (!label || label === key || /^[A-Z0-9_-]{1,16}$/u.test(label)) return undefined;
  return label;
}

function storedAssessmentTitle(value: string | undefined, testId: string) {
  const title = value?.trim();
  if (!title || title.toLowerCase() === testId.toLowerCase() || /^[a-z0-9]+(?:-[a-z0-9]+)*$/iu.test(title)) return undefined;
  return title;
}

function resultLabel(result: QuizResult, language: "zh" | "en", definition?: QuizDefinition) {
  const key = getResultKey(result);
  if (definition) {
    const scoreBand = getScoreBand(definition, result);
    const scoreLabel = scoreBand?.title[language];
    if (scoreLabel) return scoreLabel;

    if (key) {
      const typeData = definition.resultContent.types?.[key]?.[language];
      const typeLabel = friendlyLabel(typeData?.name, key);
      if (typeLabel) return typeLabel;

      const narrative = definition.resultContent.narrative?.[key]?.[language];
      const narrativeLabel = friendlyLabel(narrative?.archetype, key);
      if (narrativeLabel) return narrativeLabel;

      const archetype = definition.resultContent.archetypes?.[key];
      const archetypeLabel = friendlyLabel(language === "zh" ? archetype?.title_zh : archetype?.title_en, key);
      if (archetypeLabel) return archetypeLabel;
    }

    const percentages = result.percentages;
    if (percentages && definition.resultContent.dimensions) {
      const [dominantKey] = Object.entries(percentages).sort(([, left], [, right]) => right - left)[0] ?? [];
      const dominant = definition.resultContent.dimensions[dominantKey];
      const dominantLabel = friendlyLabel(language === "zh" ? dominant?.zh : dominant?.name, dominantKey ?? "");
      if (dominantLabel) return dominantLabel;
    }

    const dimension = [...(result.dimensions ?? [])].sort((left, right) => right.score - left.score)[0];
    const dimensionMetadata = dimension ? definition.resultContent.dimensions?.[dimension.name] : undefined;
    const dimensionLabel = friendlyLabel(
      language === "zh" ? dimensionMetadata?.zh ?? dimension?.zh : dimensionMetadata?.name ?? dimension?.en ?? dimension?.name,
      dimension?.name ?? "",
    );
    if (dimensionLabel) return dimensionLabel;
  }

  const score = getResultScore(result);
  if (score !== null) return `${Math.round(score)}${language === "zh" ? " 分" : " points"}`;
  const dimension = [...(result.dimensions ?? [])].sort((left, right) => right.score - left.score)[0];
  const dimensionLabel = friendlyLabel(language === "zh" ? dimension?.zh : dimension?.en ?? dimension?.name, dimension?.name ?? "");
  if (dimensionLabel) return dimensionLabel;
  if (key) return language === "zh" ? "已完成" : "Completed";
  return language === "zh" ? "已完成" : "Completed";
}

export default function HistoryPage() {
  const { language } = useLanguage();
  const { attempts, deleteAttempt } = useAttempts();
  const { user } = useAccountIdentity();
  const { syncChoice } = useAccountSync();
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [definitions, setDefinitions] = useState<Record<string, QuizDefinition>>({});
  const cloudSyncEnabled = Boolean(user && syncChoice === "merge");
  const entries = useMemo(() => attempts.map((attempt) => ({ attempt, entry: getQuizEntry(attempt.testId) })).filter((item): item is { attempt: typeof attempts[number]; entry: NonNullable<ReturnType<typeof getQuizEntry>> } => Boolean(item.entry)), [attempts]);
  const formatDate = (timestamp: number) => language === "zh" ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(timestamp) : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(timestamp);

  // The P1 continuation judgment stays on the device: the visit only counts
  // when a completion from an earlier day within 28 days is already local.
  // The ledger dedupes refires from the attempts array changing after sync.
  useEffect(() => {
    pingContinuationHistory(attempts);
  }, [attempts]);

  useEffect(() => {
    let cancelled = false;
    const ids = Array.from(new Set(entries.map(({ attempt }) => attempt.testId)));
    if (!ids.length) return () => { cancelled = true; };
    void Promise.all(ids.map(async (id) => [id, await loadQuizDefinition(id)] as const)).then((loaded) => {
      if (cancelled) return;
      setDefinitions(Object.fromEntries(loaded.filter((item): item is readonly [string, QuizDefinition] => Boolean(item[1]))));
    });
    return () => { cancelled = true; };
  }, [entries]);

  const removeOne = async (id: string) => {
    setPendingDelete(id);
    setDeleteError("");
    try {
      if (cloudSyncEnabled && user) await deleteCloudAttempt(user.id, id);
      deleteAttempt(id);
    } catch {
      setDeleteError(language === "zh" ? "云端记录删除失败，请检查网络后重试。" : "The cloud record could not be deleted. Check your connection and try again.");
    } finally {
      setPendingDelete(null);
    }
  };

  const removeAll = async () => {
    setPendingDelete("*");
    setDeleteError("");
    try {
      if (cloudSyncEnabled && user) await clearCloudAttempts(user.id);
      clearAttempts();
      setConfirmClear(false);
    } catch {
      setDeleteError(language === "zh" ? "云端记录清空失败，请检查网络后重试。" : "Cloud history could not be cleared. Check your connection and try again.");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="atlas-page min-h-screen">
      <AppHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={language === "zh" ? "记录" : "History"} />
      <PageContainer>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="atlas-section-kicker">{language === "zh" ? "回看你的回答" : "Review your reflections"}</p><h1 className="atlas-section-title mt-3">{language === "zh" ? "历史记录" : "History"}</h1><p className="mt-3 text-sm leading-6 text-ink/55 dark:text-white/55">{language === "zh" ? `已完成 ${attempts.length} 次。${cloudSyncEnabled ? "记录已同步到你的账号。" : "记录保存在这台设备。"}` : `${attempts.length} completed. ${cloudSyncEnabled ? "History is synced to your account." : "History is stored on this device."}`}</p></div>{attempts.length > 0 && <div className="flex items-center gap-2">{confirmClear ? <><span className="text-xs text-ink/50 dark:text-white/50">{language === "zh" ? "确定清空全部记录？" : "Clear all records?"}</span><button type="button" onClick={() => setConfirmClear(false)} disabled={pendingDelete !== null} className="atlas-text-button disabled:opacity-40">{language === "zh" ? "取消" : "Cancel"}</button><button type="button" onClick={() => void removeAll()} disabled={pendingDelete !== null} className="atlas-danger-action disabled:opacity-40"><Trash2 className="size-3.5" />{pendingDelete === "*" ? (language === "zh" ? "正在清空" : "Clearing") : (language === "zh" ? "确认" : "Confirm")}</button></> : <button type="button" onClick={() => setConfirmClear(true)} className="atlas-text-button"><Trash2 className="size-3.5" />{language === "zh" ? "清空记录" : "Clear history"}</button>}</div>}</div>

        <p className="mt-4 min-h-5 text-sm text-[color:var(--danger)]" role="alert">{deleteError}</p>

        {entries.length === 0 ? <div className="atlas-empty-state mt-12"><div className="atlas-empty-line" /><h2 className="mt-5 text-xl font-semibold">{language === "zh" ? "还没有测评记录" : "No assessments completed yet"}</h2><p className="mt-3 max-w-sm text-sm leading-6 text-ink/50 dark:text-white/50">{language === "zh" ? "完成一次测评后，结果会保存在这里。" : "Complete an assessment and your result will be saved here."}</p><Link href="/#routes" className="atlas-primary-action mx-auto mt-7">{language === "zh" ? "选择测评" : "Choose an assessment"}<ArrowUpRight className="size-4" /></Link></div> : <div className="mt-8 space-y-3">{entries.map(({ attempt, entry }) => { const title = storedAssessmentTitle(language === "zh" ? attempt.testName : attempt.testNameEn, attempt.testId) ?? (language === "zh" ? entry.title.zh : entry.title.en); return <article key={attempt.id} className="atlas-history-row"><CategoryMark category={entry.topic.id} className="size-10 shrink-0 text-accent" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link href={`/result/${attempt.testId}/?attempt=${encodeURIComponent(attempt.id)}`} className="truncate text-sm font-semibold hover:text-accent">{title}</Link><span className="text-xs text-accent">{resultLabel(attempt.result, language, definitions[attempt.testId])}</span></div><div className="mt-2 flex items-center gap-2 text-xs text-ink/42 dark:text-white/42"><Clock3 className="size-3.5" />{formatDate(attempt.timestamp)}</div></div><div className="flex items-center gap-2"><Link href={`/result/${attempt.testId}/?attempt=${encodeURIComponent(attempt.id)}`} className="atlas-icon-link" aria-label={language === "zh" ? "查看结果" : "View result"}><ArrowUpRight className="size-4" /></Link><button type="button" onClick={() => void removeOne(attempt.id)} disabled={pendingDelete !== null} className="atlas-icon-link text-ink/35 hover:text-red-600 disabled:opacity-35 dark:text-white/35 dark:hover:text-red-300" aria-label={language === "zh" ? "删除记录" : "Delete record"}><Trash2 className="size-4" /></button></div></article>; })}</div>}
      </PageContainer>
    </div>
  );
}
