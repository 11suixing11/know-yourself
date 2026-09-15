"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { QUIZ_CATALOG } from "@/core/quiz";
import type { Lang } from "@/lib/types";
import { CORE_TEST_GROUPS, type CoreTestGroupId } from "@/lib/core-tests";
import { TestCard } from "@/components/TestCard";
import { cn } from "@/lib/utils";

type LengthFilter = "all" | "short" | "medium" | "long";
type TopicFilter = "all" | CoreTestGroupId;

export default function ExploreSection({ lang = "zh" }: { lang?: Lang }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TopicFilter>("all");
  const [length, setLength] = useState<LengthFilter>("all");
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return QUIZ_CATALOG.filter((test) => {
      const matchesQuery = !normalizedQuery || [test.id, test.title.zh, test.title.en, test.description.zh, test.description.en]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesCategory = category === "all" || test.topic.id === category;
      const matchesLength = length === "all"
        || (length === "short" && test.questions <= 16)
        || (length === "medium" && test.questions > 16 && test.questions <= 25)
        || (length === "long" && test.questions > 25);
      return matchesQuery && matchesCategory && matchesLength;
    });
  }, [category, length, query]);

  const hasFilters = Boolean(query || category !== "all" || length !== "all");
  const reset = () => { setQuery(""); setCategory("all"); setLength("all"); };
  const lengthLabels = lang === "zh"
    ? { all: "全部题量", short: "16 题以内", medium: "17 至 25 题", long: "26 题以上" }
    : { all: "Any length", short: "Up to 16", medium: "17 to 25", long: "26 or more" };

  return (
    <div className="press-catalog-explorer catalog-explorer">
      <header className="press-catalog-heading catalog-explorer-heading">
        <div>
          <h2>{lang === "zh" ? `全部 ${QUIZ_CATALOG.length} 项测评` : `All ${QUIZ_CATALOG.length} assessments`}</h2>
          <p>{lang === "zh" ? "按主题浏览，或者直接搜索正在关心的词。" : "Browse by subject or search for what is on your mind."}</p>
        </div>
        <label className="press-catalog-search atlas-search catalog-search" htmlFor="assessment-search">
          <span className="sr-only">{lang === "zh" ? "搜索测评" : "Search assessments"}</span>
          <Search aria-hidden="true" />
          <input id="assessment-search" name="assessment-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={lang === "zh" ? "搜索性格、情绪、关系……" : "Search personality, emotion, relationships…"} />
          {query && <button type="button" onClick={() => setQuery("")} className="atlas-icon-button" aria-label={lang === "zh" ? "清除搜索" : "Clear search"}><X aria-hidden="true" /></button>}
        </label>
      </header>

      <div className="press-catalog-filter-bar catalog-filter-bar">
        <div className="catalog-topic-filter">
          <SlidersHorizontal aria-hidden="true" />
          <div role="group" aria-label={lang === "zh" ? "按主题筛选" : "Filter by subject"}>
            <button type="button" onClick={() => setCategory("all")} aria-pressed={category === "all"} className={cn("atlas-filter", category === "all" && "atlas-filter-active")}>{lang === "zh" ? "全部" : "All"}</button>
            {CORE_TEST_GROUPS.map((item) => <button key={item.id} type="button" onClick={() => setCategory(item.id)} aria-pressed={category === item.id} className={cn("atlas-filter", category === item.id && "atlas-filter-active")}>{lang === "zh" ? item.zh : item.en}</button>)}
          </div>
        </div>
        <div className="catalog-length-filter">
          <label htmlFor="assessment-length">{lang === "zh" ? "题量" : "Length"}</label>
          <select id="assessment-length" value={length} onChange={(event) => setLength(event.target.value as LengthFilter)}>
            {(Object.keys(lengthLabels) as LengthFilter[]).map((value) => <option key={value} value={value}>{lengthLabels[value]}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={reset} className="atlas-text-button"><X aria-hidden="true" />{lang === "zh" ? "清除" : "Clear"}</button>}
        </div>
      </div>

      <div className="catalog-result-status" role="status" aria-live="polite">
        {lang === "zh" ? `显示 ${results.length} 项测评` : `Showing ${results.length} assessments`}
      </div>

      {results.length ? (
        <div className="press-catalog-grid atlas-catalog-grid">
          {results.map((test, index) => <TestCard key={test.id} test={test} index={index} lang={lang} variant="catalog" />)}
        </div>
      ) : (
        <div className="atlas-empty-state catalog-empty-state">
          <p className="font-semibold">{lang === "zh" ? "暂时没有符合条件的测评" : "No assessment matched those filters"}</p>
          <button type="button" onClick={reset} className="atlas-text-button mt-3">{lang === "zh" ? "清除筛选" : "Clear filters"}</button>
        </div>
      )}
    </div>
  );
}
