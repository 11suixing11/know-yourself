"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ImagePlus, MessageSquarePlus } from "lucide-react";
import { CommunityFeed } from "@/components/community/community-feed";
import { CommunityTextComposer } from "@/components/community/community-text-composer";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useAccountIdentity } from "@/components/account-provider";
import { useLanguage } from "@/hooks/use-local-storage";

/**
 * The unified community stream. It backs both the homepage and the
 * compatibility `/community/` route so the feed has exactly one
 * implementation, one empty-state copy, and one composer wiring.
 */
export function CommunityStream() {
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const [composerOpen, setComposerOpen] = useState(false);
  const [feedVersion, setFeedVersion] = useState(0);
  const text = language === "zh";
  return <div className="press-page atlas-page min-h-screen">
    <AppHeader section={text ? "社区" : "Community"} />
    <PageContainer className="press-community-page community-page">
      <header className="press-community-intro community-intro">
        <div className="press-community-statement">
          <p className="press-edition-line">{text ? "一份共同书写的自我观察刊物" : "A shared publication of personal observations"}</p>
          <h1>{text ? "此刻的你，正在注意什么？" : "What are you noticing about yourself?"}</h1>
          <p>{text ? "不必先得出结论。写下一句话、分享一次测评，或者用几张图片留下正在发生的感受。" : "You do not need a conclusion first. Leave a sentence, share an assessment, or hold the moment in a few images."}</p>
        </div>
        <aside className="press-community-note">
          <span>{text ? "公开之前" : "Before publishing"}</span>
          <p>{text ? "你会先看清哪些内容将被公开。私人记录、草稿和未分享的测评结果仍然只属于你。" : "You will see exactly what becomes public. Private notes, drafts, and unshared results remain yours."}</p>
          <Link href="/privacy/" className="press-inline-link atlas-text-link">{text ? "了解隐私边界" : "Read the privacy boundary"}<ArrowRight aria-hidden="true" /></Link>
        </aside>
      </header>

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
          <h2 id="press-feed-title">{text ? "正在被写下的观察" : "Observations being written now"}</h2>
          <p>{text ? "测评、文字与图像，按同一条时间线出现。" : "Assessments, words, and images share one chronology."}</p>
        </div>
        <CommunityFeed key={feedVersion} language={language} onCreateText={() => setComposerOpen(true)} />
      </section>
    </PageContainer>
  </div>;
}
