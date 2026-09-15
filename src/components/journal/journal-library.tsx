"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, FileImage, ImagePlus, LockKeyhole, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccountIdentity, useAccountSync } from "@/components/account-provider";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useLanguage } from "@/hooks/use-local-storage";
import { getJournalLibrary, journalImageSource, type JournalLibraryResponse, type JournalStatus, type JournalSummary } from "@/lib/journal";

type LibraryTab = "drafts" | "published";

function statusLabel(status: JournalStatus, language: "zh" | "en") {
  const labels: Record<JournalStatus, { zh: string; en: string }> = {
    draft: { zh: "草稿", en: "Draft" },
    processing: { zh: "处理中", en: "Processing" },
    published: { zh: "已公开", en: "Published" },
    hidden: { zh: "已隐藏", en: "Hidden" },
    unpublished: { zh: "已取消公开", en: "Unpublished" },
    deleted: { zh: "已删除", en: "Deleted" },
  };
  return labels[status][language];
}

function formatDate(timestamp: number, language: "zh" | "en") {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function JournalLibraryCard({ entry, language, tab }: { entry: JournalSummary; language: "zh" | "en"; tab: LibraryTab }) {
  const source = entry.cover ? journalImageSource(entry.cover, "medium") : undefined;
  const href = tab === "drafts" || entry.hasUnpublishedChanges ? `/journal/${entry.id}/edit/` : `/journal/${entry.id}/`;
  return (
    <article className="journal-library-card">
      <Link href={href} className="journal-library-cover" aria-label={`${entry.title || (language === "zh" ? "未命名札记" : "Untitled journal")} · ${statusLabel(entry.status, language)}`}>
        {source
          ? <Image src={source.src} alt="" width={source.width} height={source.height} sizes="(max-width: 680px) 100vw, 42vw" unoptimized />
          : <span><FileImage aria-hidden="true" /></span>}
        <span className={`journal-status journal-status-${entry.status}`}>{statusLabel(entry.status, language)}</span>
      </Link>
      <div className="journal-library-copy">
        <div className="journal-library-meta"><span>{formatDate(entry.updatedAt, language)}</span><span>{language === "zh" ? `${entry.imageCount} 张图片` : `${entry.imageCount} image${entry.imageCount === 1 ? "" : "s"}`}</span></div>
        <h2><Link href={href}>{entry.title || (language === "zh" ? "未命名札记" : "Untitled journal")}</Link></h2>
        {entry.excerpt && <p>{entry.excerpt}</p>}
        <div className="journal-library-card-footer">
          <span>{entry.hasUnpublishedChanges && entry.publicRevision > 0
            ? (language === "zh" ? "有尚未公开的修改" : "Unpublished changes")
            : entry.allowComments
              ? (language === "zh" ? "留言开启" : "Responses on")
              : (language === "zh" ? "留言关闭" : "Responses off")}</span>
          <Link href={href} className="atlas-icon-link" aria-label={language === "zh" ? "打开札记" : "Open journal"}><ArrowUpRight aria-hidden="true" /></Link>
        </div>
      </div>
    </article>
  );
}

export function JournalLibrary() {
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const { syncState } = useAccountSync();
  const [data, setData] = useState<JournalLibraryResponse | null>(null);
  const [tab, setTab] = useState<LibraryTab>("drafts");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try { setData(await getJournalLibrary(user.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (language === "zh" ? "个人库暂时无法加载" : "Your library is unavailable")); }
    finally { setLoading(false); }
  }, [language, user]);

  useEffect(() => {
    if (syncState === "loading") return;
    if (!user) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, syncState, user]);

  const entries = useMemo(() => {
    const all = data?.entries.filter((entry) => entry.status !== "deleted") ?? [];
    if (tab === "published") return all.filter((entry) => entry.publicRevision > 0);
    return all.filter((entry) => entry.publicRevision === 0 || entry.hasUnpublishedChanges || entry.status === "draft" || entry.status === "processing");
  }, [data?.entries, tab]);
  const draftCount = data?.entries.filter((entry) => entry.publicRevision === 0 || entry.hasUnpublishedChanges || entry.status === "draft" || entry.status === "processing").length ?? 0;
  const publishedCount = data?.entries.filter((entry) => entry.publicRevision > 0).length ?? 0;
  const canCreate = Boolean(data?.viewer.emailVerified && data.viewer.accountStatus === "normal");
  const pageLoading = syncState === "loading" || (Boolean(user) && loading);

  return (
    <div className="press-journal-page atlas-page journal-library-page">
      <AppHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={language === "zh" ? "图像札记" : "Image journal"} />
      <PageContainer className="journal-library-container">
        <header className="journal-library-header">
          <div>
            <p className="atlas-section-kicker">{language === "zh" ? "开放式反思" : "Open reflection"}</p>
            <h1>{language === "zh" ? "图像札记" : "Image journal"}</h1>
            <p>{language === "zh" ? "把几张图和此刻的文字，留在同一页。" : "Keep a few images and the words of this moment on one page."}</p>
          </div>
          {user && canCreate && <Link href="/journal/new/" className="press-primary-action atlas-primary-action"><ImagePlus aria-hidden="true" />{language === "zh" ? "新建札记" : "New journal"}</Link>}
        </header>

        {pageLoading ? <div className="journal-state" role="status"><span className="journal-state-pulse" />{language === "zh" ? "正在整理个人库…" : "Arranging your library…"}</div> : !user ? (
          <div className="journal-access-state">
            <LockKeyhole aria-hidden="true" />
            <h2>{language === "zh" ? "登录后打开个人库" : "Sign in to open your library"}</h2>
            <p>{language === "zh" ? "草稿和私密预览只对你可见。" : "Drafts and private previews are visible only to you."}</p>
            <Link href="/account/" className="press-primary-action atlas-primary-action"><LogIn aria-hidden="true" />{language === "zh" ? "登录或注册" : "Sign in or register"}</Link>
          </div>
        ) : error ? (
          <div className="journal-state journal-state-error">
            <FileImage aria-hidden="true" /><h2>{language === "zh" ? "个人库没有打开" : "Your library did not open"}</h2><p>{error}</p>
            <button type="button" className="press-secondary-action atlas-secondary-action" onClick={() => void load()}><RefreshCw aria-hidden="true" />{language === "zh" ? "重新加载" : "Try again"}</button>
          </div>
        ) : data && !data.viewer.emailVerified ? (
          <div className="journal-access-state">
            <ShieldCheck aria-hidden="true" />
            <h2>{language === "zh" ? "验证邮箱后开始创作" : "Verify your email to begin"}</h2>
            <p>{language === "zh" ? "完成账号邮箱验证后，可以上传图片、保存草稿并公开札记。" : "After email verification, you can upload images, save drafts, and publish journals."}</p>
            <Link href="/account/" className="atlas-primary-action">{language === "zh" ? "前往账号" : "Open account"}<ArrowUpRight aria-hidden="true" /></Link>
          </div>
        ) : data && data.viewer.accountStatus !== "normal" ? (
          <div className="journal-access-state">
            <LockKeyhole aria-hidden="true" />
            <h2>{language === "zh" ? "当前账号暂不能新建札记" : "This account cannot create journals right now"}</h2>
            <p>{language === "zh" ? "你仍可查看已有内容；账号状态可在账号页确认。" : "You can still read existing content. Review the account page for status details."}</p>
            <Link href="/account/" className="atlas-secondary-action">{language === "zh" ? "查看账号" : "View account"}</Link>
          </div>
        ) : data && (
          <>
            <div className="journal-library-toolbar" role="tablist" aria-label={language === "zh" ? "札记状态" : "Journal status"}>
              <button type="button" role="tab" aria-selected={tab === "drafts"} className={tab === "drafts" ? "is-active" : ""} onClick={() => setTab("drafts")}>{language === "zh" ? "草稿" : "Drafts"}<span>{draftCount}</span></button>
              <button type="button" role="tab" aria-selected={tab === "published"} className={tab === "published" ? "is-active" : ""} onClick={() => setTab("published")}>{language === "zh" ? "已发布" : "Published"}<span>{publishedCount}</span></button>
              <p>{language === "zh" ? `今日还可上传 ${data.viewer.uploadRemaining} 张，发布 ${data.viewer.publishRemaining} 篇` : `${data.viewer.uploadRemaining} uploads and ${data.viewer.publishRemaining} publications remaining today`}</p>
            </div>
            {entries.length === 0 ? (
              <div className="journal-empty-state">
                <span className="journal-empty-mark" aria-hidden="true"><FileImage /></span>
                <h2>{tab === "drafts" ? (language === "zh" ? "从一张图开始" : "Begin with one image") : (language === "zh" ? "还没有公开札记" : "No published journals yet")}</h2>
                <p>{tab === "drafts" ? (language === "zh" ? "标题、文字和图片会自动保存到你的草稿。" : "Your title, words, and images are saved as a draft.") : (language === "zh" ? "完成草稿后，你可以明确选择公开。" : "When a draft is ready, you can explicitly publish it.")}</p>
                {tab === "drafts" && <Link href="/journal/new/" className="press-primary-action atlas-primary-action"><ImagePlus aria-hidden="true" />{language === "zh" ? "新建札记" : "New journal"}</Link>}
              </div>
            ) : <div className="journal-library-grid">{entries.map((entry) => <JournalLibraryCard key={`${tab}-${entry.id}`} entry={entry} language={language} tab={tab} />)}</div>}
          </>
        )}
      </PageContainer>
    </div>
  );
}
