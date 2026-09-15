"use client";

import Link from "next/link";
import { Heart, MessageCircle, Reply, ShieldAlert, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountIdentity } from "@/components/account-provider";
import {
  createJournalComment,
  deleteJournalComment,
  reportJournalContent,
  setJournalReaction,
  type JournalComment,
  type JournalEntry,
  type JournalReportReason,
} from "@/lib/journal";

interface ReportTarget {
  entryId?: string;
  commentId?: string;
  label: string;
}

const REPORT_REASONS: Array<{ value: JournalReportReason; zh: string; en: string }> = [
  { value: "privacy", zh: "隐私或个人信息", en: "Privacy or personal information" },
  { value: "nonconsensual_intimate", zh: "未经同意的私密影像", en: "Non-consensual intimate imagery" },
  { value: "minor_sexual", zh: "涉及未成年人的性内容", en: "Sexual content involving minors" },
  { value: "explicit_harm", zh: "明确伤害或威胁", en: "Explicit harm or threats" },
  { value: "illegal", zh: "违法内容", en: "Illegal content" },
  { value: "abuse", zh: "攻击或骚扰", en: "Abuse or harassment" },
  { value: "sexual", zh: "不适当的性内容", en: "Inappropriate sexual content" },
  { value: "copyright", zh: "版权问题", en: "Copyright" },
  { value: "spam", zh: "垃圾内容", en: "Spam" },
  { value: "other", zh: "其他", en: "Other" },
];

function formatDate(timestamp: number, language: "zh" | "en") {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function CommentForm({ entryId, parentId, language, onSaved }: {
  entryId: string;
  parentId?: string;
  language: "zh" | "en";
  onSaved(): void;
}) {
  const { user } = useAccountIdentity();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user) return <Link href="/account/" className="journal-signin-response">{language === "zh" ? "登录后留言" : "Sign in to respond"}</Link>;
  return (
    <form className={`journal-comment-form ${parentId ? "is-reply" : ""}`} onSubmit={async (event) => {
      event.preventDefault();
      if (!body.trim() || busy) return;
      setBusy(true);
      setError("");
      try {
        await createJournalComment(user.id, entryId, body.trim(), parentId);
        setBody("");
        onSaved();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : (language === "zh" ? "留言未能发送" : "The response was not sent"));
      } finally {
        setBusy(false);
      }
    }}>
      <label htmlFor={`journal-comment-${parentId ?? "root"}`} className="sr-only">{language === "zh" ? "留言内容" : "Response"}</label>
      <textarea id={`journal-comment-${parentId ?? "root"}`} rows={parentId ? 2 : 4} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} placeholder={language === "zh" ? "留下你的理解或支持…" : "Leave understanding or support…"} />
      <div><span className={error ? "is-error" : ""} role={error ? "alert" : undefined}>{error || `${Array.from(body).length}/1000`}</span><button type="submit" className="press-secondary-action atlas-secondary-action" disabled={busy || !body.trim()}>{busy ? (language === "zh" ? "发送中…" : "Sending…") : (language === "zh" ? "发送" : "Send")}</button></div>
    </form>
  );
}

function CommentItem({ comment, entry, language, onRefresh, onReport }: {
  comment: JournalComment;
  entry: JournalEntry;
  language: "zh" | "en";
  onRefresh(): void;
  onReport(target: ReportTarget): void;
}) {
  const { user } = useAccountIdentity();
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const replies = entry.comments.filter((item) => item.parentId === comment.id);
  return (
    <div className="journal-comment">
      <div className="journal-comment-meta"><strong>{comment.author.displayName}</strong><span>{formatDate(comment.createdAt, language)}</span></div>
      <p>{comment.body}</p>
      <div className="journal-comment-actions">
        {user && !comment.parentId && <button type="button" onClick={() => setReplying((value) => !value)}><Reply aria-hidden="true" />{language === "zh" ? "回复" : "Reply"}</button>}
        {user && <button type="button" onClick={() => onReport({ commentId: comment.id, label: language === "zh" ? "举报留言" : "Report response" })}><ShieldAlert aria-hidden="true" />{language === "zh" ? "举报" : "Report"}</button>}
        {user && comment.canDelete && <button type="button" disabled={deleting} onClick={async () => {
          if (!window.confirm(language === "zh" ? "删除这条留言？" : "Delete this response?")) return;
          setDeleting(true);
          try { await deleteJournalComment(user.id, entry.id, comment.id); onRefresh(); }
          finally { setDeleting(false); }
        }}><Trash2 aria-hidden="true" />{deleting ? (language === "zh" ? "删除中" : "Deleting") : (language === "zh" ? "删除" : "Delete")}</button>}
      </div>
      {replying && <CommentForm entryId={entry.id} parentId={comment.id} language={language} onSaved={() => { setReplying(false); onRefresh(); }} />}
      {replies.length > 0 && <div className="journal-comment-replies">{replies.map((reply) => <CommentItem key={reply.id} comment={reply} entry={entry} language={language} onRefresh={onRefresh} onReport={onReport} />)}</div>}
    </div>
  );
}

function ReportDialog({ target, language, onClose, onSubmitted }: {
  target: ReportTarget;
  language: "zh" | "en";
  onClose(): void;
  onSubmitted(hidden: boolean, duplicate: boolean): void;
}) {
  const { user } = useAccountIdentity();
  const [reason, setReason] = useState<JournalReportReason>("privacy");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    (selectRef.current ?? focusable[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="journal-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="press-journal-dialog journal-report-dialog" role="dialog" aria-modal="true" aria-labelledby="journal-report-title" aria-describedby="journal-report-description">
        <header><div><p>{language === "zh" ? "内容举报" : "Content report"}</p><h2 id="journal-report-title">{target.label}</h2></div><button type="button" onClick={onClose} aria-label={language === "zh" ? "关闭举报" : "Close report"}><X aria-hidden="true" /></button></header>
        <p id="journal-report-description" className="sr-only">{language === "zh" ? "选择举报原因，并可补充说明。" : "Choose a report reason and optionally add details."}</p>
        {!user ? <div className="journal-report-signin"><p>{language === "zh" ? "登录后可以提交举报。" : "Sign in to submit a report."}</p><Link href="/account/" className="press-primary-action atlas-primary-action">{language === "zh" ? "前往登录" : "Sign in"}</Link></div> : <form onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const response = await reportJournalContent(user.id, { entryId: target.entryId, commentId: target.commentId, reason, details: details.trim() });
            onSubmitted(response.hidden, response.duplicate);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : (language === "zh" ? "举报未能提交" : "The report was not submitted"));
          } finally {
            setBusy(false);
          }
        }}>
          <label htmlFor="journal-report-reason">{language === "zh" ? "原因" : "Reason"}</label>
          <select ref={selectRef} id="journal-report-reason" value={reason} onChange={(event) => setReason(event.target.value as JournalReportReason)}>{REPORT_REASONS.map((item) => <option key={item.value} value={item.value}>{language === "zh" ? item.zh : item.en}</option>)}</select>
          <label htmlFor="journal-report-details">{language === "zh" ? "补充说明（可选）" : "Details (optional)"}</label>
          <textarea id="journal-report-details" value={details} maxLength={2000} rows={5} onChange={(event) => setDetails(event.target.value)} />
          <div className="journal-report-footer"><span className={error ? "is-error" : ""} role={error ? "alert" : undefined}>{error || `${Array.from(details).length}/2000`}</span><button type="submit" className="press-primary-action atlas-primary-action" disabled={busy}>{busy ? (language === "zh" ? "提交中…" : "Submitting…") : (language === "zh" ? "提交举报" : "Submit report")}</button></div>
        </form>}
      </section>
    </div>
  );
}

export function JournalInteractions({ entry, language, onRefresh }: { entry: JournalEntry; language: "zh" | "en"; onRefresh(): void }) {
  const { user } = useAccountIdentity();
  const [reactionBusy, setReactionBusy] = useState(false);
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [notice, setNotice] = useState("");
  const roots = entry.comments.filter((comment) => !comment.parentId);
  const closeReport = useCallback(() => setTarget(null), []);

  const toggleReaction = async () => {
    if (!user || reactionBusy) return;
    setReactionBusy(true);
    try { await setJournalReaction(user.id, entry.id, !entry.reacted); onRefresh(); }
    finally { setReactionBusy(false); }
  };

  return (
    <section className="press-journal-interactions journal-interactions" aria-labelledby="journal-responses-heading">
      <div className="journal-interaction-toolbar">
        {user
          ? <button type="button" className={entry.reacted ? "is-active" : ""} disabled={reactionBusy} onClick={() => void toggleReaction()}><Heart fill={entry.reacted ? "currentColor" : "none"} aria-hidden="true" />{language === "zh" ? "共鸣" : "Resonate"}<span>{entry.reactionCount}</span></button>
          : <Link href="/account/"><Heart aria-hidden="true" />{language === "zh" ? "登录后共鸣" : "Sign in to resonate"}<span>{entry.reactionCount}</span></Link>}
        <span><MessageCircle aria-hidden="true" />{language === "zh" ? `${entry.commentCount} 条留言` : `${entry.commentCount} responses`}</span>
        {!entry.isOwner && <button type="button" onClick={() => setTarget({ entryId: entry.id, label: language === "zh" ? "举报这篇札记" : "Report this journal" })}><ShieldAlert aria-hidden="true" />{language === "zh" ? "举报" : "Report"}</button>}
      </div>

      <p className="journal-interaction-notice" aria-live="polite">{notice}</p>
      <div className="journal-comments-header"><h2 id="journal-responses-heading">{language === "zh" ? "留言" : "Responses"}</h2><span>{entry.commentCount}</span></div>
      {roots.length > 0 && <div className="journal-comment-list">{roots.map((comment) => <CommentItem key={comment.id} comment={comment} entry={entry} language={language} onRefresh={onRefresh} onReport={setTarget} />)}</div>}
      {entry.allowComments ? <CommentForm entryId={entry.id} language={language} onSaved={onRefresh} /> : <p className="journal-comments-closed">{language === "zh" ? "作者已关闭留言。" : "The author has closed responses."}</p>}

      {target && <ReportDialog target={target} language={language} onClose={closeReport} onSubmitted={(hidden, duplicate) => {
        setTarget(null);
        setNotice(duplicate ? (language === "zh" ? "你已举报过这项内容。" : "You already reported this content.") : hidden ? (language === "zh" ? "举报已提交，内容已暂时隐藏。" : "Report submitted. The content is temporarily hidden.") : (language === "zh" ? "举报已提交。" : "Report submitted."));
        if (hidden) onRefresh();
      }} />}
    </section>
  );
}
