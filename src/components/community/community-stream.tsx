"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CommunityVoiceSection } from "@/components/community/community-voice-section";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useLanguage } from "@/hooks/use-local-storage";

/**
 * The compatibility community surface. The homepage renders the same shared
 * voice block beneath its editorial front page, so the feed has exactly one
 * implementation, one empty-state copy, and one composer wiring.
 */
export function CommunityStream() {
  const { language } = useLanguage();
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

      <CommunityVoiceSection
        language={language}
        heading={text ? "正在被写下的观察" : "Observations being written now"}
        subheading={text ? "测评、文字与图像，按同一条时间线出现。" : "Assessments, words, and images share one chronology."}
      />
    </PageContainer>
  </div>;
}
