"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ImagePlus, MessageSquarePlus } from "lucide-react";
import { CommunityFeed } from "@/components/community/community-feed";
import { CommunityTextComposer } from "@/components/community/community-text-composer";
import { useAccountIdentity } from "@/components/account-provider";
import type { Lang } from "@/core/quiz";

/**
 * The one shared community block: the creation desk plus the live feed. The
 * homepage and the compatibility `/community/` route render exactly this one
 * implementation, so the feed keeps a single copy and a single empty-state.
 * Each surface passes its own heading pair.
 */
export function CommunityVoiceSection({ language, heading, subheading }: { language: Lang; heading: string; subheading: string }) {
  const { user } = useAccountIdentity();
  const [composerOpen, setComposerOpen] = useState(false);
  const [feedVersion, setFeedVersion] = useState(0);
  const text = language === "zh";
  return <>
    <div className="press-create-desk community-create-actions" aria-label={text ? "创建社区内容" : "Create community content"}>
      <div className="press-create-copy">
        <strong>{text ? "从你最自然的表达开始" : "Begin with the form that feels natural"}</strong>
        <span>{text ? "公开内容会进入下方共同刊物。" : "Public work joins the shared publication below."}</span>
      </div>
      <button type="button" className="press-primary-action atlas-primary-action" onClick={() => setComposerOpen(true)}><MessageSquarePlus aria-hidden="true" />{text ? "写下一段话" : "Write a note"}</button>
      <Link href="/journal/new/?from=community" className="press-secondary-action atlas-secondary-action"><ImagePlus aria-hidden="true" />{text ? "制作图像帖" : "Make an image post"}</Link>
      <div className="community-create-meta">
        <span className="community-create-note">{text ? "图像上传需要验证邮箱" : "Email verification is required for image uploads"}</span>
        {user
          ? <Link href="/journal/" className="atlas-text-link">{text ? "我的图文帖" : "My image posts"}<ArrowRight aria-hidden="true" /></Link>
          : <Link href="/account/" className="atlas-text-link">{text ? "登录后参与" : "Sign in to participate"}<ArrowRight aria-hidden="true" /></Link>}
      </div>
    </div>

    {composerOpen && <CommunityTextComposer language={language} onClose={() => setComposerOpen(false)} onPublished={() => { setComposerOpen(false); setFeedVersion((value) => value + 1); }} />}
    <section className="press-feed-section" aria-labelledby="press-feed-title">
      <div className="press-feed-heading">
        <h2 id="press-feed-title">{heading}</h2>
        <p>{subheading}</p>
      </div>
      <CommunityFeed key={feedVersion} language={language} onCreateText={() => setComposerOpen(true)} />
    </section>
  </>;
}
