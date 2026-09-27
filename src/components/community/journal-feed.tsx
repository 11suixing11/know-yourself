"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Images, NotebookPen } from "lucide-react";
import { useAccountIdentity } from "@/components/account/account-provider";
import { journalImageSource, type JournalImage } from "@/lib/journal";
import type { Lang } from "@/core/quiz";

interface PublicJournalSummary {
  id: string;
  title: string;
  body: string;
  author?: { displayName?: string };
  cover?: JournalImage | null;
  imageCount: number;
  publishedAt: number;
}

function dateLabel(timestamp: number, language: Lang) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function excerpt(value: string, limit = 120) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return `${characters.slice(0, limit).join("")}${characters.length > limit ? "…" : ""}`;
}

export function JournalCommunityFeed({ language }: { language: Lang }) {
  const { user } = useAccountIdentity();
  const [entries, setEntries] = useState<PublicJournalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/journal?scope=public", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null) as { entries?: PublicJournalSummary[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || (language === "zh" ? "暂时无法加载图像札记" : "Unable to load image journals"));
      setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (language === "zh" ? "暂时无法加载图像札记" : "Unable to load image journals"));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <div className="community-state" role="status">{language === "zh" ? "正在打开公开札记…" : "Opening public journals…"}</div>;
  if (error) return <div className="community-state"><p>{error}</p><button type="button" className="atlas-secondary-action" onClick={() => void load()}>{language === "zh" ? "重新加载" : "Try again"}</button></div>;
  if (!entries.length) return <div className="community-state">
    <NotebookPen className="mx-auto size-7" aria-hidden="true" />
    <h2>{language === "zh" ? "第一篇札记还在路上" : "The first journal is still on its way"}</h2>
    <p>{language === "zh" ? "用 1–6 张图片写下一段只属于你的观察。" : "Use 1–6 images to shape an observation of your own."}</p>
    <Link href={user ? "/journal/new/" : "/account/"} className="atlas-primary-action">{language === "zh" ? (user ? "写一篇图像札记" : "登录后开始创作") : (user ? "Write an image journal" : "Sign in to create")}</Link>
  </div>;

  return <div className="grid gap-px overflow-hidden rounded-lg border border-ink/12 bg-ink/12 dark:border-white/12 dark:bg-white/12 sm:grid-cols-2">
    {entries.map((entry) => {
      const source = entry.cover ? journalImageSource(entry.cover, "medium") : undefined;
      return <article key={entry.id} className="flex min-w-0 flex-col bg-paper dark:bg-night">
        <Link href={`/journal/${encodeURIComponent(entry.id)}/`} className="group flex h-full flex-col focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/5 dark:bg-white/5">
            {source ? <Image src={source.src} alt={entry.cover?.decorative ? "" : entry.cover?.alt || entry.title} fill sizes="(max-width: 640px) 100vw, 50vw" className="object-cover transition duration-300 group-hover:scale-[1.015]" unoptimized /> : <div className="flex h-full items-center justify-center text-ink/35 dark:text-white/35"><Images className="size-9" aria-hidden="true" /></div>}
          </div>
          <div className="flex flex-1 flex-col p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-ink/50 dark:text-white/50">
              <span>{entry.author?.displayName || (language === "zh" ? "匿名作者" : "Community member")}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={new Date(entry.publishedAt).toISOString()}>{dateLabel(entry.publishedAt, language)}</time>
            </div>
            <h2 className="mt-3 text-xl font-semibold leading-snug text-ink dark:text-white">{entry.title}</h2>
            {entry.body && <p className="mt-3 line-clamp-3 text-sm leading-6 text-ink/58 dark:text-white/58">{excerpt(entry.body)}</p>}
            <div className="mt-auto flex items-center justify-between gap-4 pt-6 text-xs font-semibold text-ink/55 dark:text-white/55">
              <span className="inline-flex items-center gap-1.5"><Images className="size-4" aria-hidden="true" />{language === "zh" ? `${entry.imageCount} 张图片` : `${entry.imageCount} images`}</span>
              <span className="inline-flex items-center gap-1 text-accent">{language === "zh" ? "阅读全文" : "Read"}<ArrowRight className="size-4" aria-hidden="true" /></span>
            </div>
          </div>
        </Link>
      </article>;
    })}
  </div>;
}
