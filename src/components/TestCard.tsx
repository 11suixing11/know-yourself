"use client";

import Link from "next/link";
import { ArrowRight, Bookmark, BookmarkCheck, Clock3 } from "lucide-react";
import type { PublicQuizCard, PublicQuizCatalogEntry } from "@/core/quiz";
import type { QuizTrustProfile } from "@/core/quiz/types";
import type { TestRegistryEntry } from "@/lib/test-registry";
import type { Lang } from "@/lib/types";
import { TEST_CATEGORIES } from "@/lib/constants";
import { getHomeFacet } from "@/lib/home-facets";
import { useBookmarks } from "@/hooks/use-local-storage";
import { CategoryMark } from "@/components/quiz/category-mark";
import { QuizVisualFrame } from "@/components/quiz/quiz-visual";
import { getQuizCover } from "@/lib/quiz-media";

type TestCardItem = TestRegistryEntry | PublicQuizCatalogEntry | PublicQuizCard;

function getCardCopy(test: TestCardItem, lang: Lang) {
  if ("title" in test) {
    return {
      title: test.title[lang],
      description: test.description[lang],
      duration: test.duration,
    };
  }
  return {
    title: test[lang].name,
    description: test[lang].description,
    duration: test.time,
  };
}

function getCategoryLabel(category: string, lang: Lang) {
  const item = TEST_CATEGORIES.find((candidate) => candidate.id === category);
  return item ? (lang === "zh" ? item.zh : item.en) : category;
}

export function TestCard({ test, index = 0, lang = "zh", variant = "card" }: { test: TestCardItem; index?: number; lang?: Lang; variant?: "card" | "catalog" }) {
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const saved = isBookmarked(test.id);
  const { title, description, duration } = getCardCopy(test, lang);
  const group = "topic" in test ? test.topic : undefined;
  const fallbackGroup = getHomeFacet(test.id);
  const categoryLabel = group?.label[lang] ?? (fallbackGroup ? (lang === "zh" ? fallbackGroup.zh : fallbackGroup.en) : getCategoryLabel(test.category, lang));
  const category = group?.id ?? fallbackGroup?.id ?? test.category;
  const trust = "trust" in test ? (test as TestCardItem & { trust?: QuizTrustProfile }).trust : undefined;
  const trustLabel = trust?.label[lang];
  // Art exists for 5 of 16 assessments. In the square grid a single illustrated
  // card stretched its whole row, so the cover runs only in the browse list, whose
  // layout already handles both cases side by side.
  const cover = variant === "catalog" ? getQuizCover(test.id) : undefined;

  return (
    <article className={`press-test-card atlas-test-card${cover ? " atlas-test-card--visual" : ""}${variant === "catalog" ? " atlas-test-card--catalog" : ""}`}>
      <Link href={`/test/${test.id}/`} className="atlas-test-card-link group block h-full">
        {cover && <QuizVisualFrame visual={cover} lang={lang} sizes={variant === "catalog" ? "(max-width: 799px) 38vw, 10rem" : "(max-width: 640px) calc(100vw - 2.5rem), (max-width: 1024px) 45vw, 24rem"} className="atlas-test-card-visual" />}
        <div className="press-test-card-body atlas-test-card-body flex h-full flex-col">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <CategoryMark category={category} className="text-accent" />
              <span className="min-w-0">
                <span className="atlas-card-category block truncate">{categoryLabel}</span>
                {trustLabel && <span className="atlas-card-trust mt-1 inline-flex">{trustLabel}</span>}
              </span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="press-test-card-title font-semibold text-ink transition group-hover:text-accent dark:text-white">{title}</h3>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <div className="atlas-test-card-foot flex items-center justify-between gap-3 border-t border-ink/14 pt-4 text-xs text-muted-foreground dark:border-white/16">
            <span className="atlas-test-card-meta inline-flex min-w-0 items-center gap-2"><span className="atlas-index">{String(index + 1).padStart(2, "0")}</span><span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{test.questions} {lang === "zh" ? "题" : "questions"} · {duration} {lang === "zh" ? "分钟" : "min"}</span></span>
            <span className="atlas-test-card-cta inline-flex items-center gap-1 font-semibold text-ink/70 transition group-hover:text-accent dark:text-white/70"><span>{lang === "zh" ? "先了解" : "Explore"}</span><ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
          </div>
        </div>
      </Link>
      <button type="button" onClick={() => toggleBookmark(test.id)} className="atlas-card-save" aria-pressed={saved} aria-label={saved ? (lang === "zh" ? "取消收藏" : "Remove bookmark") : (lang === "zh" ? "收藏测评" : "Save assessment")}>
        {saved ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
      </button>
    </article>
  );
}
