"use client";

import Link from "next/link";
import { BookmarkX, ListFilter } from "lucide-react";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { TestCard } from "@/components/assessments/test-card";
import { QUIZ_CATALOG } from "@/core/quiz";
import { useBookmarks, useLanguage } from "@/hooks/use-local-storage";

export default function BookmarksPage() {
  const { language } = useLanguage();
  const { bookmarks } = useBookmarks();
  const tests = bookmarks.map((id) => QUIZ_CATALOG.find((quiz) => quiz.id === id)).filter((quiz): quiz is NonNullable<typeof quiz> => Boolean(quiz));

  return (
    <div className="atlas-page min-h-screen">
      <AppHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={language === "zh" ? "收藏" : "Saved"} />
      <PageContainer>
        <p className="atlas-section-kicker">{language === "zh" ? "留给以后" : "For another day"}</p>
        <h1 className="atlas-section-title mt-3">{language === "zh" ? "收藏的测试" : "Saved quizzes"}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-ink/55 dark:text-white/55">{language === "zh" ? `这里有 ${tests.length} 项你想稍后再做的测评。` : `${tests.length} assessment${tests.length === 1 ? "" : "s"} saved for later.`}</p>

        {tests.length === 0 ? <div className="atlas-empty-state mt-12"><BookmarkX className="mx-auto size-8 text-accent" /><h2 className="mt-5 text-xl font-semibold">{language === "zh" ? "还没有收藏" : "Nothing saved yet"}</h2><p className="mt-3 max-w-sm text-sm leading-6 text-ink/50 dark:text-white/50">{language === "zh" ? "看到想以后再做的测评时，点一下收藏即可。" : "Save an assessment whenever you want to return later."}</p><Link href="/assessments/#library" className="atlas-primary-action mx-auto mt-7"><ListFilter className="size-4" />{language === "zh" ? "浏览全部测评" : "Browse assessments"}</Link></div> : <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tests.map((test, index) => <TestCard key={test.id} test={test} index={index} lang={language} />)}</div>}
      </PageContainer>
    </div>
  );
}
