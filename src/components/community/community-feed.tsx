"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ClipboardList, Heart, History, ImagePlus, Images, MessageCircle, MessageSquarePlus, Reply, ShieldAlert, Trash2, X } from "lucide-react";
import { useAccountIdentity } from "@/components/account/account-provider";
import {
  addCommunityComment,
  deleteCommunityComment,
  deleteCommunityPost,
  getCommunityFeed,
  reportCommunityContent,
  setCommunityReaction,
  type CommunityComment,
  type CommunityFeedItem,
  type CommunityFeedJournalItem,
  type CommunityPost,
} from "@/lib/community";
import type { Lang } from "@/core/quiz";

function initials(name: string) { return Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "ME"; }

/**
 * Worn badges render as quiet chips beside the author name, linking to the
 * assessment they came from. An author wearing none renders nothing.
 */
function AuthorBadges({ badges, language }: { badges: CommunityPost["author"]["badges"]; language: Lang }) {
  if (!badges.length) return null;
  return <span className="community-author-badges">
    {badges.slice(0, 3).map((badge) => (
      <Link key={`${badge.testId}-${badge.resultTitle}`} href={`/test/${badge.testId}/`} className="community-badge-chip" title={`${language === "zh" ? badge.testName : badge.testNameEn} · ${language === "zh" ? badge.resultTitle : badge.resultTitleEn}`}>
        {language === "zh" ? badge.resultTitle : badge.resultTitleEn}
      </Link>
    ))}
  </span>;
}

const REPORT_REASONS = [
  ["illegal", "违法内容", "Illegal content"],
  ["minor_sexual", "涉及未成年人性内容", "Sexual content involving minors"],
  ["nonconsensual_intimate", "非自愿私密影像", "Non-consensual intimate content"],
  ["privacy", "隐私泄露", "Privacy exposure"],
  ["explicit_harm", "明确伤害内容", "Explicit harm"],
  ["spam", "垃圾广告", "Spam"],
  ["abuse", "攻击或骚扰", "Abuse or harassment"],
  ["sexual", "不适当性内容", "Inappropriate sexual content"],
  ["copyright", "版权问题", "Copyright"],
  ["other", "其他", "Other"],
] as const;

function timeLabel(timestamp: number, language: Lang) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric" }).format(timestamp);
}

function excerpt(value: string, limit = 180) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return `${characters.slice(0, limit).join("")}${characters.length > limit ? "…" : ""}`;
}

function ReportDialog({ language, onSubmit, idSuffix = "content" }: { language: Lang; onSubmit: (reason: string) => Promise<void>; idSuffix?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <button type="button" onClick={() => setOpen(true)}><ShieldAlert aria-hidden="true" />{language === "zh" ? "举报" : "Report"}</button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="w-full max-w-md rounded-lg bg-paper p-5 shadow-2xl dark:bg-night" role="dialog" aria-modal="true" aria-labelledby={`community-report-title-${idSuffix}`} aria-describedby={`community-report-description-${idSuffix}`}>
        <div className="flex items-center justify-between gap-4"><h2 id={`community-report-title-${idSuffix}`} className="text-lg font-semibold">{language === "zh" ? "举报内容" : "Report content"}</h2><button type="button" className="community-icon-action" onClick={() => setOpen(false)} disabled={busy} aria-label={language === "zh" ? "关闭" : "Close"} title={language === "zh" ? "关闭" : "Close"}><X aria-hidden="true" /></button></div>
        <p id={`community-report-description-${idSuffix}`} className="sr-only">{language === "zh" ? "选择最符合这项内容的举报原因。" : "Choose the reason that best describes this content."}</p>
        <label className="mt-5 block text-sm font-semibold"><span>{language === "zh" ? "原因" : "Reason"}</span><select value={reason} onChange={(event) => setReason(event.target.value)} className="atlas-account-input mt-2">{REPORT_REASONS.map(([value, zh, en]) => <option key={value} value={value}>{language === "zh" ? zh : en}</option>)}</select></label>
        {error && <p className="mt-3 text-sm text-[color:var(--danger)]" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" className="atlas-text-button" onClick={() => setOpen(false)} disabled={busy}>{language === "zh" ? "取消" : "Cancel"}</button><button type="button" className="atlas-danger-action disabled:opacity-45" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await onSubmit(reason); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : (language === "zh" ? "举报失败" : "Report failed")); } finally { setBusy(false); } }}><ShieldAlert aria-hidden="true" />{busy ? (language === "zh" ? "提交中…" : "Submitting…") : (language === "zh" ? "提交举报" : "Submit report")}</button></div>
      </section>
    </div>}
  </>;
}

function CommentForm({ postId, parentId, language, onSaved }: { postId: string; parentId?: string; language: Lang; onSaved: () => void }) {
  const { user } = useAccountIdentity();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user) return <Link href="/account/" className="atlas-text-link mt-4 justify-start">{language === "zh" ? "登录后留言" : "Sign in to respond"}</Link>;
  return <form className="community-comment-form" onSubmit={async (event) => {
    event.preventDefault(); if (!body.trim() || busy) return; setBusy(true); setError("");
    try { await addCommunityComment(user.id, postId, body, parentId); setBody(""); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (language === "zh" ? "暂时无法留言" : "Unable to respond")); }
    finally { setBusy(false); }
  }}>
    <label className="sr-only" htmlFor={`comment-${postId}-${parentId ?? "root"}`}>{language === "zh" ? "留下你的理解或支持" : "Leave understanding or support"}</label>
    <textarea id={`comment-${postId}-${parentId ?? "root"}`} value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} rows={parentId ? 2 : 3} placeholder={language === "zh" ? "留下你的理解或支持…" : "Leave understanding or support…"} />
    <div><span className="community-field-status">{error || `${Array.from(body).length}/500`}</span><button className="atlas-secondary-action" disabled={busy || !body.trim()}>{busy ? (language === "zh" ? "发送中…" : "Sending…") : (language === "zh" ? "发送" : "Send")}</button></div>
  </form>;
}

function CommentItem({ comment, post, language, refresh }: { comment: CommunityComment; post: CommunityPost; language: Lang; refresh: () => void }) {
  const { user } = useAccountIdentity();
  const [replying, setReplying] = useState(false);
  const replies = post.comments.filter((item) => item.parentId === comment.id);
  return <div className="community-comment">
    <div className="community-comment-meta"><strong>{comment.author.displayName}</strong><AuthorBadges badges={comment.author.badges} language={language} /><span>{timeLabel(comment.createdAt, language)}</span></div>
    <p>{comment.body}</p>
    <div className="community-comment-actions">
      {user && !comment.parentId && <button type="button" onClick={() => setReplying((value) => !value)}><Reply aria-hidden="true" />{language === "zh" ? "回复" : "Reply"}</button>}
      {user && <ReportDialog idSuffix={`comment-${comment.id}`} language={language} onSubmit={async (reason) => { await reportCommunityContent(user.id, { commentId: comment.id, reason }); refresh(); }} />}
      {comment.canDelete && user && <button type="button" onClick={async () => { if (window.confirm(language === "zh" ? "删除这条留言？" : "Delete this response?")) { await deleteCommunityComment(user.id, comment.id); refresh(); } }}><Trash2 aria-hidden="true" />{language === "zh" ? "删除" : "Delete"}</button>}
    </div>
    {replying && <CommentForm postId={post.id} parentId={comment.id} language={language} onSaved={() => { setReplying(false); refresh(); }} />}
    {replies.length > 0 && <div className="community-replies">{replies.map((reply) => <CommentItem key={reply.id} comment={reply} post={post} language={language} refresh={refresh} />)}</div>}
  </div>;
}

function CommunityPostCard({ post, language, user, refresh }: { post: CommunityPost; language: Lang; user: ReturnType<typeof useAccountIdentity>["user"]; refresh: () => void }) {
  const roots = post.comments.filter((comment) => !comment.parentId);
  const assessment = post.kind === "assessment" && post.testId;
  return <article className="community-post">
    <header className="community-post-header">
      <span className="community-avatar" aria-hidden="true">{post.author.avatar ? <Image src={post.author.avatar} alt="" width={80} height={80} unoptimized /> : initials(post.author.displayName)}</span>
      <div><strong>{post.author.displayName}</strong><span>{timeLabel(post.createdAt, language)}</span><AuthorBadges badges={post.author.badges} language={language} /></div>
      <span className="community-post-kind">{assessment ? (language === "zh" ? "测评" : "Assessment") : (language === "zh" ? "文字" : "Text")}</span>
      {post.isAuthor && user && <button type="button" className="community-icon-action" title={language === "zh" ? "删除分享" : "Delete post"} onClick={async () => { if (window.confirm(language === "zh" ? "删除这篇公开分享及其留言？" : "Delete this public post and its responses?")) { await deleteCommunityPost(user.id, post.id); refresh(); } }}><Trash2 aria-hidden="true" /></button>}
    </header>
    {assessment ? <div className="community-assessment"><Link href={`/test/${post.testId}/`}>{language === "zh" ? post.testName : post.testNameEn}</Link>{post.resultTitle && <><span aria-hidden="true">·</span><strong>{language === "zh" ? post.resultTitle : post.resultTitleEn}</strong></>}</div> : post.title && <h2 className="community-text-title">{post.title}</h2>}
    {post.dimensions.length > 0 && <dl className="community-dimensions">{post.dimensions.map((item) => <div key={`${item.label}-${item.value}`}><dt>{language === "zh" ? item.label : item.labelEn}</dt><dd>{item.value}</dd></div>)}</dl>}
    {post.reflection && <p className="community-reflection">{post.reflection}</p>}
    <div className="community-post-actions">
      <button type="button" disabled={!user} className={post.reacted ? "is-active" : ""} title={!user ? (language === "zh" ? "登录后可以共鸣" : "Sign in to resonate") : undefined} onClick={async () => { if (!user) return; await setCommunityReaction(user.id, post.id, !post.reacted); refresh(); }}><Heart aria-hidden="true" fill={post.reacted ? "currentColor" : "none"} />{language === "zh" ? "共鸣" : "Resonate"}<span>{post.reactionCount}</span></button>
      <span><MessageCircle aria-hidden="true" />{language === "zh" ? `${post.commentCount} 条留言` : `${post.commentCount} responses`}</span>
      {user && !post.isAuthor && <ReportDialog idSuffix={`post-${post.id}`} language={language} onSubmit={async (reason) => { await reportCommunityContent(user.id, { postId: post.id, reason }); refresh(); }} />}
    </div>
    {post.allowComments && <section className="community-comments" aria-label={language === "zh" ? "留言" : "Responses"}>
      {roots.map((comment) => <CommentItem key={comment.id} comment={comment} post={post} language={language} refresh={refresh} />)}
      <CommentForm postId={post.id} language={language} onSaved={refresh} />
    </section>}
  </article>;
}

function JournalPostCard({ item, language }: { item: CommunityFeedJournalItem; language: Lang }) {
  const cover = item.images[0];
  const title = item.title || (language === "zh" ? "图像分享" : "Image post");
  const [coverError, setCoverError] = useState(false);
  return <article className="community-post community-post--image">
    <header className="community-post-header">
      <span className="community-avatar" aria-hidden="true">{initials(item.author.displayName)}</span>
      <div><strong>{item.author.displayName}</strong><span>{timeLabel(item.publishedAt, language)}</span><AuthorBadges badges={item.author.badges} language={language} /></div>
      <span className="community-post-kind">{language === "zh" ? "图像" : "Image"}</span>
    </header>
    <Link
      href={item.href}
      className="community-image-link"
      aria-label={`${title} · ${language === "zh" ? "打开图文帖" : "Open image post"}`}
    >
      {cover && !coverError
        ? <Image src={cover.src} alt={cover.decorative ? "" : cover.alt || title} width={cover.width} height={cover.height} sizes="(max-width: 760px) 100vw, 760px" unoptimized onError={() => setCoverError(true)} />
        : <div className="community-image-placeholder" role="img" aria-label={language === "zh" ? "图片暂时无法显示" : "Image temporarily unavailable"}><Images aria-hidden="true" /><span>{language === "zh" ? "图片暂时无法显示" : "Image temporarily unavailable"}</span></div>}
    </Link>
    <div className="community-image-copy">
      <h2><Link href={item.href}>{title}</Link></h2>
      {item.body && <p>{excerpt(item.body)}</p>}
      <div className="community-post-actions">
        <span><Images aria-hidden="true" />{language === "zh" ? `${item.imageCount} 张图片` : `${item.imageCount} image${item.imageCount === 1 ? "" : "s"}`}</span>
        <span><Heart aria-hidden="true" />{language === "zh" ? `${item.reactionCount} 次共鸣` : `${item.reactionCount} resonances`}</span>
        <span><MessageCircle aria-hidden="true" />{language === "zh" ? `${item.commentCount} 条留言` : `${item.commentCount} responses`}</span>
        <Link href={item.href} className="community-image-open">{language === "zh" ? "打开图文帖" : "Open image post"}<ArrowRight aria-hidden="true" /></Link>
      </div>
    </div>
  </article>;
}

export function CommunityFeed({ language, onCreateText }: { language: Lang; onCreateText?: () => void }) {
  const { user } = useAccountIdentity();
  const [posts, setPosts] = useState<CommunityFeedItem[]>([]);
  const [sort, setSort] = useState<"latest" | "resonant">("latest");
  const [filter, setFilter] = useState<"all" | "assessment" | "text" | "image">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setPosts((await getCommunityFeed(sort, filter)).posts); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (language === "zh" ? "暂时无法加载" : "Unable to load")); }
    finally { setLoading(false); }
  }, [filter, language, sort]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, user?.id]);

  const filters = [
    ["all", language === "zh" ? "全部" : "All"],
    ["assessment", language === "zh" ? "测评" : "Assessments"],
    ["text", language === "zh" ? "文字" : "Text"],
    ["image", language === "zh" ? "图像" : "Images"],
  ] as const;

  const emptyCopy = filter === "assessment"
    ? (language === "zh" ? "完成一次测评后，可以从记录里选择公开分享。" : "Complete an assessment, then choose a result to share from your history.")
    : filter === "text"
      ? (language === "zh" ? "这里还没有文字分享，你可以先写下此刻的想法。" : "There are no text posts yet. Leave a thought of your own.")
      : filter === "image"
        ? (language === "zh" ? "这里还没有图像分享，你可以用一张或几张图片开始。" : "There are no image posts yet. Start with one or a few images.")
        : (language === "zh" ? "你可以只写文字、分享一次测评，或用图片发一篇图文帖。" : "Write only words, share an assessment, or make an image post.");
  const emptyAction = filter === "text" && onCreateText
    ? <button type="button" className="atlas-primary-action" onClick={onCreateText}><MessageSquarePlus aria-hidden="true" />{language === "zh" ? "写一段文字" : "Write a text post"}</button>
    : filter === "image"
      ? <Link href="/journal/new/?from=community" className="atlas-primary-action"><ImagePlus aria-hidden="true" />{language === "zh" ? "发一篇图文帖" : "Create an image post"}</Link>
      : filter === "assessment"
        ? <Link href="/history/" className="atlas-primary-action"><History aria-hidden="true" />{language === "zh" ? "从测评记录开始" : "Start from history"}</Link>
        : <Link href="/assessments/" className="atlas-primary-action"><ClipboardList aria-hidden="true" />{language === "zh" ? "选择一种表达方式" : "Choose how to express yourself"}</Link>;

  /* One root element: this component renders inside .press-feed-section's
   * two-column grid, and a fragment would let the toolbar and the empty state
   * auto-place as separate grid items — the empty card used to land under the
   * heading in the left column. */
  return <div className="community-feed-stack">
    <div className="community-toolbar" aria-label={language === "zh" ? "社区筛选与排序" : "Community filters and sort"}>
      <div role="tablist" aria-label={language === "zh" ? "内容类型" : "Content type"}>{filters.map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <div><button type="button" className={sort === "latest" ? "is-active" : ""} onClick={() => setSort("latest")}>{language === "zh" ? "最新" : "Latest"}</button><button type="button" className={sort === "resonant" ? "is-active" : ""} onClick={() => setSort("resonant")}>{language === "zh" ? "最多共鸣" : "Most resonant"}</button></div>
    </div>
    {loading && <div className="community-state" role="status">{language === "zh" ? "正在听见大家的分享…" : "Listening for shared reflections…"}</div>}
    {error && <div className="community-state"><p>{error}</p><button type="button" className="atlas-secondary-action" onClick={() => void load()}>{language === "zh" ? "重新加载" : "Try again"}</button></div>}
    {!loading && !error && posts.length === 0 && <div className="community-state"><h2>{language === "zh" ? "这里还很安静" : "It is quiet here for now"}</h2><p>{emptyCopy}</p>{emptyAction}</div>}
    <div className="community-feed">{posts.map((item) => item.source === "journal"
      ? <JournalPostCard key={`${item.source}-${item.id}`} item={item} language={language} />
      : <CommunityPostCard key={`${item.source}-${item.id}`} post={item} language={language} user={user} refresh={() => void load()} />)}</div>
  </div>;
}
