"use client";

import Link from "next/link";
import { ArrowUpRight, Bookmark, History, ShieldCheck } from "lucide-react";
import ExploreSection from "@/components/ExploreSection";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useAttempts, useLanguage } from "@/hooks/use-local-storage";
import { getQuizEntry } from "@/core/quiz";

function localized(language: "zh" | "en", zh: string, en: string) {
  return language === "zh" ? zh : en;
}

function relativeTime(timestamp: number, language: "zh" | "en") {
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return localized(language, "今天", "Today");
  if (days === 1) return localized(language, "昨天", "Yesterday");
  return language === "zh" ? `${days} 天前` : `${days} days ago`;
}

export default function AssessmentCatalogPage() {
  const { language } = useLanguage();
  const { attempts } = useAttempts();
  const latest = attempts[0];
  const latestEntry = latest ? getQuizEntry(latest.testId) : undefined;

  return (
    <div className="press-page atlas-page wellness-page assessment-catalog-page">
      <AppHeader section={localized(language, "测评", "Assessments")} />
      <PageContainer className="press-assessment-shell assessment-catalog-shell">
        <section className="press-assessment-intro assessment-catalog-intro">
          <div className="press-assessment-title">
            <span>{localized(language, "16 项已审核公开测评", "16 reviewed public assessments")}</span>
            <h1>{localized(language, "用一组问题，照见此刻。", "Use a set of questions to notice this moment.")}</h1>
          </div>
          <div className="press-assessment-intro-copy assessment-catalog-intro-copy">
            <p>{localized(language, "选择正在困扰或吸引你的主题。结果只描述这一次回答呈现出的倾向，帮助你继续观察，而不是替你定义自己。", "Choose the subject that is pulling at your attention. A result describes the pattern in this set of answers; it helps you keep noticing rather than defining you.")}</p>
            <nav aria-label={localized(language, "测评辅助入口", "Assessment shortcuts")}> 
              <Link href="/history/"><History aria-hidden="true" />{localized(language, "查看记录", "View history")}</Link>
              <Link href="/bookmarks/"><Bookmark aria-hidden="true" />{localized(language, "查看收藏", "View saved")}</Link>
            </nav>
          </div>
        </section>

        <div className="press-assessment-boundary assessment-catalog-boundary">
          <ShieldCheck aria-hidden="true" />
          <span>{localized(language, "仅供自我反思，不是诊断。游客记录保存在本机，登录后会与账号合并同步。", "For self-reflection, not diagnosis. Guest records stay on this device and merge with your account after sign-in.")}</span>
        </div>

        {latest && latestEntry && (
          <section className="press-assessment-return assessment-return" aria-label={localized(language, "继续上次的记录", "Continue your last reflection")}> 
            <div>
              <p>{localized(language, "上次完成", "Last completed")}</p>
              <strong>{language === "zh" ? latestEntry.title.zh : latestEntry.title.en}</strong>
              <span>{relativeTime(latest.timestamp, language)}</span>
            </div>
            <Link href={`/result/${latest.testId}/?attempt=${encodeURIComponent(latest.id)}`}>{localized(language, "回看结果", "Review result")}<ArrowUpRight aria-hidden="true" /></Link>
          </section>
        )}

        <section id="library" className="press-assessment-library assessment-catalog-library scroll-mt-20">
          <ExploreSection lang={language} />
        </section>
      </PageContainer>

      <footer className="press-footer wellness-footer">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-ink/70 dark:text-white/70">认识你自己 / Know Yourself</span>
          <div className="flex gap-5"><Link href="/privacy/" className="atlas-text-link">{localized(language, "隐私", "Privacy")}</Link><a href="https://github.com/11suixing11/know-yourself" target="_blank" rel="noreferrer" className="atlas-text-link">GitHub</a></div>
        </div>
      </footer>
    </div>
  );
}
