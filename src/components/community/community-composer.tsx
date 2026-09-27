"use client";

import Link from "next/link";
import { Check, LockKeyhole, X } from "lucide-react";
import { useState } from "react";
import { useAccountIdentity } from "@/components/account/account-provider";
import { CommunityApiError, publishCommunityPost } from "@/lib/community";
import { submitCloudQuiz } from "@/lib/account";
import { replaceAttempt } from "@/lib/storage";
import type { Lang } from "@/core/quiz";

export function CommunityComposer({ attemptId, testId, answers, testName, resultTitle, summary, language, syncNow, onAttemptSynced, onClose }: {
  attemptId: string;
  testId: string;
  answers?: number[];
  testName: string;
  resultTitle: string;
  summary: Array<{ label: string; value: string }>;
  language: Lang;
  syncNow: () => Promise<void>;
  onAttemptSynced: (attemptId: string) => void;
  onClose: () => void;
}) {
  const { user, profile } = useAccountIdentity();
  const [reflection, setReflection] = useState("");
  const [showResultType, setShowResultType] = useState(true);
  const [showDimensions, setShowDimensions] = useState(false);
  const [showAvatar, setShowAvatar] = useState(true);
  const [allowComments, setAllowComments] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!user) return <section className="community-composer"><button className="community-composer-close" onClick={onClose} aria-label={language === "zh" ? "关闭" : "Close"}><X /></button><h2>{language === "zh" ? "登录后分享这次发现" : "Sign in to share this discovery"}</h2><p>{language === "zh" ? "社区只收录用户主动发布的内容。登录后，你可以预览并决定公开哪些结果信息。" : "The community only contains content people choose to publish. After signing in, you can preview and choose what becomes public."}</p><Link href="/account/" className="atlas-primary-action mt-5 justify-center">{language === "zh" ? "登录或注册" : "Sign in or register"}</Link></section>;
  if (done) return <section className="community-composer community-composer-done"><Check /><h2>{language === "zh" ? "已经分享到社区" : "Your reflection is now shared"}</h2><p>{language === "zh" ? "你可以在统一的社区流中查看，也可以随时删除自己的分享。" : "View it in the unified community feed, where you can also delete it at any time."}</p><div><Link href="/community/" className="atlas-primary-action">{language === "zh" ? "查看社区" : "View community"}</Link><button className="atlas-secondary-action" onClick={onClose}>{language === "zh" ? "留在这里" : "Stay here"}</button></div></section>;

  const submit = async () => {
    if (!reflection.trim() && !attemptId || !confirmed || busy) return;
    setBusy(true); setError("");
    try {
      await syncNow();
      let publishAttemptId = attemptId;
      try {
        await publishCommunityPost(user.id, { attemptId: publishAttemptId, reflection, showResultType, showDimensions, showAvatar, allowComments });
      } catch (cause) {
        if (!(cause instanceof CommunityApiError) || cause.code !== "ATTEMPT_NOT_FOUND" || !answers?.length) throw cause;
        const synced = await submitCloudQuiz(user.id, testId, answers);
        const localAttempt = replaceAttempt(attemptId, { ...synced.attempt, answers });
        publishAttemptId = localAttempt?.id ?? synced.attempt.id;
        onAttemptSynced(publishAttemptId);
        await publishCommunityPost(user.id, { attemptId: publishAttemptId, reflection, showResultType, showDimensions, showAvatar, allowComments });
      }
      setDone(true);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : (language === "zh" ? "暂时无法发布" : "Unable to publish")); }
    finally { setBusy(false); }
  };

  return <section className="community-composer" aria-labelledby="community-composer-title">
    <button className="community-composer-close" onClick={onClose} aria-label={language === "zh" ? "关闭发布面板" : "Close sharing panel"}><X /></button>
    <h2 id="community-composer-title">{language === "zh" ? "分享这次发现" : "Share this discovery"}</h2>
    <p>{language === "zh" ? "先看清公开内容，再决定是否发布。原始答案、邮箱和账号编号不会公开。" : "Review what will be public before posting. Raw answers, email, and account identifiers stay private."}</p>
    <div className="community-composer-grid">
      <div>
        <label className="community-composer-label" htmlFor="community-reflection">{language === "zh" ? "想说些什么？（可选）" : "Add a thought (optional)"}</label>
        <textarea id="community-reflection" rows={6} maxLength={500} value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder={language === "zh" ? "可以只分享结果，也可以写下一点感受…" : "Share the result alone, or add a feeling or discovery…"} />
        <span className="community-field-status">{Array.from(reflection).length}/500</span>
        <fieldset><legend>{language === "zh" ? "公开选项" : "Public options"}</legend>
          <label><input aria-label={language === "zh" ? "显示结果类型" : "Show result type"} type="checkbox" checked={showResultType} onChange={(event) => setShowResultType(event.target.checked)} />{language === "zh" ? "显示结果类型" : "Show result type"}</label>
          <label><input aria-label={language === "zh" ? "显示维度或分数摘要" : "Show dimension or score summary"} type="checkbox" checked={showDimensions} onChange={(event) => setShowDimensions(event.target.checked)} />{language === "zh" ? "显示维度或分数摘要" : "Show dimension or score summary"}</label>
          <label><input aria-label={language === "zh" ? "显示我的头像" : "Show my avatar"} type="checkbox" checked={showAvatar} onChange={(event) => setShowAvatar(event.target.checked)} />{language === "zh" ? "显示我的头像" : "Show my avatar"}</label>
          <label><input aria-label={language === "zh" ? "允许留言和回复" : "Allow responses and replies"} type="checkbox" checked={allowComments} onChange={(event) => setAllowComments(event.target.checked)} />{language === "zh" ? "允许留言和回复" : "Allow responses and replies"}</label>
        </fieldset>
      </div>
      <aside aria-label={language === "zh" ? "公开预览" : "Public preview"}>
        <span className="community-composer-label">{language === "zh" ? "公开预览" : "Public preview"}</span>
        <div className="community-preview-author"><span>{showAvatar && profile?.avatar ? "●" : "○"}</span><strong>{user.displayName}</strong></div>
        <small>{testName}{showResultType ? ` · ${resultTitle}` : ""}</small>
        {showDimensions && <dl>{summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
        <p>{reflection || (language === "zh" ? "你的感想会显示在这里。" : "Your reflection will appear here.")}</p>
        <div className="community-private-note"><LockKeyhole />{language === "zh" ? "不会公开原始答案、邮箱和精确完成时间" : "Raw answers, email, and exact completion time stay private"}</div>
      </aside>
    </div>
    <label className="community-confirm"><input aria-label={language === "zh" ? "我确认以上内容可以公开展示" : "I confirm that the content above can be shown publicly"} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{language === "zh" ? "我确认以上内容可以公开展示" : "I confirm that the content above can be shown publicly"}</label>
    <div className="community-composer-actions"><span role="status">{error}</span><button className="atlas-secondary-action" onClick={onClose}>{language === "zh" ? "取消" : "Cancel"}</button><button className="atlas-primary-action" disabled={!attemptId || !confirmed || busy} onClick={submit}>{busy ? (language === "zh" ? "发布中…" : "Publishing…") : (language === "zh" ? "公开发布" : "Publish publicly")}</button></div>
  </section>;
}
