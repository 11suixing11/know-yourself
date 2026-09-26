"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { TestCard } from "@/components/TestCard";
import { CommunityVoiceSection } from "@/components/community/community-voice-section";
import { MascotRain } from "@/components/home/mascot-rain";
import { HOME_FACETS } from "@/lib/home-facets";
import { useLanguage } from "@/hooks/use-local-storage";
import type { PublicQuizCard } from "@/core/quiz";

/**
 * The front page. Four facets, four different editorial rhythms — no two
 * sections share the same layout family. The baked watercolor washes carry
 * the first impression.
 */
export function HomeFrontPage({ cards }: { cards: PublicQuizCard[] }) {
  const { language } = useLanguage();
  const text = language === "zh";
  const byId = new Map(cards.map((card) => [card.id, card]));

  const f = HOME_FACETS;
  const self = byId.get(f[0].entryTestId);
  const selfRest = f[0].ids.filter((id) => id !== f[0].entryTestId).map((id) => byId.get(id)).filter((x): x is PublicQuizCard => !!x);
  const emotionAnchor = byId.get(f[1].entryTestId);
  const emotionRest = f[1].ids.filter((id) => id !== f[1].entryTestId).map((id) => byId.get(id)).filter((x): x is PublicQuizCard => !!x);
  const relationshipAnchor = byId.get(f[2].entryTestId);
  const relationshipRest = f[2].ids.filter((id) => id !== f[2].entryTestId).map((id) => byId.get(id)).filter((x): x is PublicQuizCard => !!x);
  const lifeAnchor = byId.get(f[3].entryTestId);
  const lifeRest = f[3].ids.filter((id) => id !== f[3].entryTestId).map((id) => byId.get(id)).filter((x): x is PublicQuizCard => !!x);

  return <div className="press-page atlas-page min-h-screen">
    <AppHeader />
    <PageContainer className="press-home-page home-page">

      {/* === HERO: baked watercolor washes carry the question === */}
      <header className="press-home-lede home-lede">
        {/* The washes are baked by scripts/generate-hero-wash.mjs; the dark variant is swapped purely by CSS. The unoptimized pipeline means Next cannot add LCP hints here; pass the fetch hint through so the hero stays the first thing the browser pulls. */}
        <Image src="/bg/hero-wash-light.webp" alt="" aria-hidden="true" fill priority fetchPriority="high" sizes="100vw" className="press-home-lede-wash" data-wash="light" />
        <Image src="/bg/hero-wash-dark.webp" alt="" aria-hidden="true" fill sizes="100vw" className="press-home-lede-wash" data-wash="dark" />
        <MascotRain />
        <p className="press-edition-line">{text ? "一个心理测评网站" : "A quiz site — with a community"}</p>
        <h1>{text ? "有点迷茫，还是就是无聊？🌙" : "A bit lost? Or just bored? 🌙"}</h1>
        <p>{text ? "来做个测评，看看结果；也看看大家发了什么，或者自己也发一个 ✍️" : "Take an assessment and see what it says — then read what others posted, or share something yourself ✍️"}</p>
      </header>

      {/* === FACET 1 · self: the anchor is a large editorial card, links below as a quiet row === */}
      <section className="press-home-facet home-facet" aria-labelledby="home-facet-self">
        <header className="press-home-facet-head">
          <span className="press-home-facet-index" aria-hidden="true">{f[0].emoji}</span>
          <div>
            <h2 id="home-facet-self">{text ? f[0].zh : f[0].en}</h2>
            <p>{text ? f[0].descriptionZh : f[0].descriptionEn}</p>
          </div>
        </header>
        <p className="press-home-facet-entry">{text ? f[0].entryZh : f[0].entryEn}</p>
        <div className="press-home-facet-body">
          <ul className="press-home-facet-links">
            {selfRest.map((card) => (
              <li key={card.id}>
                <Link href={`/test/${card.id}/`}>
                  <span className="press-home-facet-link-title">{card.title[language]}</span>
                  <span className="press-home-facet-link-meta">{card.questions}{text ? " 题" : " q"} · {card.duration}{text ? " 分钟" : " min"}</span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {self && <div className="press-home-facet-anchor"><TestCard test={self} lang={language} variant="card" /></div>}
        </div>
      </section>

      {/* === FACET 2 · emotion: reversed — card on the left, links on the right, plus entry question as a pull-quote === */}
      <section className="press-home-facet home-facet press-home-facet--reverse" aria-labelledby="home-facet-emotion">
        <p className="press-home-facet-entry press-home-facet-entry--quote">{text ? f[1].entryZh : f[1].entryEn}</p>
        <div className="press-home-facet-body">
          <div className="press-home-facet-anchor">
            {emotionAnchor && <TestCard test={emotionAnchor} lang={language} variant="card" />}
          </div>
          <ul className="press-home-facet-links">
            {emotionRest.map((card) => (
              <li key={card.id}>
                <Link href={`/test/${card.id}/`}>
                  <span className="press-home-facet-link-title">{card.title[language]}</span>
                  <span className="press-home-facet-link-meta">{card.questions}{text ? " 题" : " q"} · {card.duration}{text ? " 分钟" : " min"}</span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <header className="press-home-facet-head press-home-facet-head--after">
          <span className="press-home-facet-index" aria-hidden="true">{f[1].emoji}</span>
          <div>
            <h2 id="home-facet-emotion">{text ? f[1].zh : f[1].en}</h2>
            <p>{text ? f[1].descriptionZh : f[1].descriptionEn}</p>
          </div>
        </header>
      </section>

      {/* === FACET 3 · relationship: a full-width editorial strip — all four entries inline, no card === */}
      <section className="press-home-facet home-facet press-home-facet--inline" aria-labelledby="home-facet-relationship">
        <header className="press-home-facet-head">
          <span className="press-home-facet-index" aria-hidden="true">{f[2].emoji}</span>
          <div>
            <h2 id="home-facet-relationship">{text ? f[2].zh : f[2].en}</h2>
            <p>{text ? f[2].descriptionZh : f[2].descriptionEn}</p>
          </div>
        </header>
        <p className="press-home-facet-entry">{text ? f[2].entryZh : f[2].entryEn}</p>
        <div className="press-home-facet-inline-row">
          {[relationshipAnchor, ...relationshipRest].filter((x): x is PublicQuizCard => !!x).map((card) => (
            <Link key={card.id} href={`/test/${card.id}/`} className="press-home-facet-inline-pill">
              <span className="press-home-facet-link-title">{card.title[language]}</span>
              <span className="press-home-facet-link-meta">{card.questions}{text ? " 题" : " q"}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* === FACET 4 · life: compact — two-column split, no full card, just titles + meta === */}
      <section className="press-home-facet home-facet press-home-facet--compact" aria-labelledby="home-facet-life">
        <div className="press-home-facet-compact-grid">
          <div>
            <h2 id="home-facet-life"><span aria-hidden="true">{f[3].emoji} </span>{text ? f[3].zh : f[3].en}</h2>
            <p>{text ? f[3].descriptionZh : f[3].descriptionEn}</p>
            <p className="press-home-facet-entry press-home-facet-entry--compact">{text ? f[3].entryZh : f[3].entryEn}</p>
          </div>
          <ul className="press-home-facet-links">
            {[lifeAnchor, ...lifeRest].filter((x): x is PublicQuizCard => !!x).map((card) => (
              <li key={card.id}>
                <Link href={`/test/${card.id}/`}>
                  <span className="press-home-facet-link-title">{card.title[language]}</span>
                  <span className="press-home-facet-link-meta">{card.questions}{text ? " 题" : " q"} · {card.duration}{text ? " 分钟" : " min"}</span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* === CTA: one link to the full catalog === */}
      <div className="press-home-catalog-cta">
        <Link href="/assessments/">
          {text ? "全部 16 个测评都在这里 📚" : "All 16 assessments live here 📚"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <CommunityVoiceSection
        language={language}
        heading={text ? "最近的声音 🫧" : "Recent voices 🫧"}
        subheading={text ? "测评、文字与图像，按同一条时间线出现。" : "Assessments, words, and images share one chronology."}
      />
    </PageContainer>
  </div>;
}
