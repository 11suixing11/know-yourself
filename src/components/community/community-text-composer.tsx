"use client";

import Link from "next/link";
import { Check, ImagePlus, LockKeyhole, MessageSquarePlus, X } from "lucide-react";
import { useState } from "react";
import { useAccountIdentity } from "@/components/account/account-provider";
import { publishCommunityPost } from "@/lib/community";
import type { Lang } from "@/core/quiz";

export function CommunityTextComposer({ language, onClose, onPublished }: { language: Lang; onClose: () => void; onPublished: () => void }) {
  const { user } = useAccountIdentity();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [allowComments, setAllowComments] = useState(true);
  const [showAvatar, setShowAvatar] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!user) return <section className="community-composer"><button type="button" className="community-composer-close" onClick={onClose} aria-label={language === "zh" ? "关闭" : "Close"}><X aria-hidden="true" /></button><MessageSquarePlus aria-hidden="true" /><h2>{language === "zh" ? "登录后分享你的想法" : "Sign in to share your thought"}</h2><p>{language === "zh" ? "社区支持文字、测评和图像三种发布方式。登录后即可选择其中一种开始分享。" : "The community supports text, assessment, and image posts. Sign in to choose one and start sharing."}</p><Link href="/account/" className="atlas-primary-action mt-5 justify-center">{language === "zh" ? "登录或注册" : "Sign in or register"}</Link></section>;

  if (done) return <section className="community-composer community-composer-done"><Check aria-hidden="true" /><h2>{language === "zh" ? "已经分享到社区" : "Shared with the community"}</h2><p>{language === "zh" ? "你可以在统一的社区流中找到这篇文字分享。" : "You can find this text post in the unified community feed."}</p><div><button type="button" className="atlas-primary-action" onClick={onPublished}>{language === "zh" ? "查看社区" : "View community"}</button><button type="button" className="atlas-secondary-action" onClick={onClose}>{language === "zh" ? "继续浏览" : "Keep browsing"}</button></div></section>;

  const submit = async () => {
    if ((!title.trim() && !body.trim()) || !confirmed || busy) return;
    setBusy(true); setError("");
    try {
      await publishCommunityPost(user.id, { title, body, allowComments, showAvatar, contentLanguage: language });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (language === "zh" ? "暂时无法发布" : "Unable to publish"));
    } finally { setBusy(false); }
  };

  return <section className="community-composer" aria-labelledby="community-text-composer-title">
    <button type="button" className="community-composer-close" onClick={onClose} aria-label={language === "zh" ? "关闭发布面板" : "Close sharing panel"}><X aria-hidden="true" /></button>
    <h2 id="community-text-composer-title">{language === "zh" ? "分享一个想法" : "Share a thought"}</h2>
    <p>{language === "zh" ? "主题和表达形式不设限制。发布前你可以预览内容，原始测评答案和账号信息不会出现在帖子里。" : "Choose any topic or form. Review the post before publishing; raw assessment answers and account details stay private."}</p>
    <div className="community-composer-grid">
      <div>
        <label className="community-composer-label" htmlFor="community-text-title">{language === "zh" ? "标题（可选）" : "Title (optional)"}</label>
        <input id="community-text-title" className="community-composer-input" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={language === "zh" ? "给这段话一个名字…" : "Give this thought a name…"} />
        <label className="community-composer-label mt-4" htmlFor="community-text-body">{language === "zh" ? "正文（可选）" : "Body (optional)"}</label>
        <textarea id="community-text-body" rows={7} maxLength={12000} value={body} onChange={(event) => setBody(event.target.value)} placeholder={language === "zh" ? "写下此刻想留下的话…" : "Write what you want to leave here…"} />
        <span className="community-field-status">{Array.from(body).length}/12000</span>
        <fieldset><legend>{language === "zh" ? "帖子选项" : "Post options"}</legend><label htmlFor="community-text-comments"><input id="community-text-comments" aria-label={language === "zh" ? "允许留言和回复" : "Allow responses and replies"} type="checkbox" checked={allowComments} onChange={(event) => setAllowComments(event.target.checked)} />{language === "zh" ? "允许留言和回复" : "Allow responses and replies"}</label><label htmlFor="community-text-avatar"><input id="community-text-avatar" aria-label={language === "zh" ? "显示我的头像" : "Show my avatar"} type="checkbox" checked={showAvatar} onChange={(event) => setShowAvatar(event.target.checked)} />{language === "zh" ? "显示我的头像" : "Show my avatar"}</label></fieldset>
      </div>
      <aside aria-label={language === "zh" ? "公开预览" : "Public preview"}>
        <span className="community-composer-label">{language === "zh" ? "公开预览" : "Public preview"}</span>
        <div className="community-preview-author"><span>{showAvatar ? "●" : "○"}</span><strong>{user.displayName}</strong></div>
        {title && <h3>{title}</h3>}
        <p>{body || (language === "zh" ? "正文会显示在这里。" : "Your words will appear here.")}</p>
        <div className="community-private-note"><LockKeyhole aria-hidden="true" />{language === "zh" ? "公开后仍可删除；未来如提供 AI 功能，也会另外确认。" : "You can delete it later; any future AI feature will require separate consent."}</div>
      </aside>
    </div>
    <div className="community-composer-secondary-link"><ImagePlus aria-hidden="true" /><span>{language === "zh" ? "想用图片表达？" : "Prefer images?"}</span><Link href="/journal/new/?from=community">{language === "zh" ? "创建图文帖" : "Create an image post"}</Link></div>
    <label className="community-confirm" htmlFor="community-text-confirm"><input id="community-text-confirm" aria-label={language === "zh" ? "我确认以上内容可以公开展示" : "I confirm that the content above can be shown publicly"} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{language === "zh" ? "我确认以上内容可以公开展示" : "I confirm that the content above can be shown publicly"}</label>
    <div className="community-composer-actions"><span role="status">{error}</span><button type="button" className="atlas-secondary-action" onClick={onClose}>{language === "zh" ? "取消" : "Cancel"}</button><button type="button" className="atlas-primary-action" disabled={(!title.trim() && !body.trim()) || !confirmed || busy} onClick={() => void submit()}>{busy ? (language === "zh" ? "发布中…" : "Publishing…") : (language === "zh" ? "公开发布" : "Publish publicly")}</button></div>
  </section>;
}
