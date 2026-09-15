import { DimensionBar } from "./dimension-bar";
import type { QuizResult, NarrativeResult, TypeData, DimensionData, ArchetypeData, Lang } from "@/core/quiz";

interface NarrativeSectionProps {
  pattern: "type" | "dimensions" | "score";
  result: QuizResult;
  narrative?: NarrativeResult;
  typeData?: TypeData;
  dimensions?: Record<string, DimensionData>;
  archetypes?: Record<string, ArchetypeData>;
  accentColor?: string;
  lang?: Lang;
  introDescription?: string;
}

function NarrativeBlock({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="press-narrative-block flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function BadgeList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="press-narrative-badges flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {items.map((value, index) => (
          <span key={`${value}-${index}`} className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function normalizeListItems(items?: string[]) {
  return items?.map((item) => item.trim()).filter(Boolean);
}

function SceneList({ title, items }: { title: string; items?: string[] }) {
  const scenes = normalizeListItems(items);
  if (!scenes?.length) return null;
  return (
    <div className="atlas-result-scenes">
      <h3>{title}</h3>
      <ul>
        {scenes.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

function TypeSignals({
  result,
  dimensions,
  accentColor,
  lang,
}: {
  result: QuizResult;
  dimensions?: Record<string, DimensionData>;
  accentColor: string;
  lang: Lang;
}) {
  if (!result.dimensions?.length) return null;
  return (
    <div className="press-narrative-signals flex flex-col gap-5 border-t border-border/60 pt-5">
      <h3 className="text-sm font-semibold text-foreground">{lang === "zh" ? "偏好轮廓" : "Preference profile"}</h3>
      {result.dimensions.map((dimension) => {
        const metadata = dimensions?.[dimension.name];
        const label = lang === "zh"
          ? metadata?.zh ?? dimension.zh
          : metadata?.name ?? dimension.en ?? dimension.name;
        if (dimension.left && dimension.right && typeof dimension.leftScore === "number" && typeof dimension.rightScore === "number") {
          const left = Math.max(0, Math.min(100, Math.round(dimension.leftScore)));
          const right = Math.max(0, Math.min(100, Math.round(dimension.rightScore)));
          return (
            <div key={dimension.name} className="flex flex-col gap-2" role="group" aria-label={`${label}: ${dimension.left} ${left}%, ${dimension.right} ${right}%`}>
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                <span>{dimension.left} {left}%</span>
                <span>{right}% {dimension.right}</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="h-full transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${left}%`, backgroundColor: accentColor }} />
                <span className="h-full flex-1 bg-foreground/16 dark:bg-white/20" />
              </div>
            </div>
          );
        }
          return <DimensionBar key={dimension.name} name={label} percentage={dimension.score} accentColor={accentColor} />;
      })}
    </div>
  );
}

export function NarrativeSection({
  pattern,
  result,
  narrative,
  typeData,
  dimensions,
  archetypes,
  accentColor = "var(--accent)",
  lang = "zh",
  introDescription,
}: NarrativeSectionProps) {
  if (pattern === "dimensions" && result.percentages) {
    const entries = Object.entries(result.percentages);
    return (
      <div className="press-narrative flex flex-col gap-5">
        {narrative?.description && narrative.description !== introDescription && <p className="text-sm leading-relaxed text-muted-foreground">{narrative.description}</p>}
        {entries.map(([key, pct]) => {
          const dim = dimensions?.[key];
          const label = dim?.[lang === "zh" ? "zh" : "name"] ?? key;
          return <DimensionBar key={key} name={label} percentage={pct} accentColor={accentColor} />;
        })}
        <SceneList title={lang === "zh" ? "你可能会在这些时刻认出自己" : "You may recognize yourself here"} items={narrative?.scenes} />
      </div>
    );
  }

  if (pattern === "score") {
    const dominant = result.dominant ?? result.primary ?? result.resultType ?? "";
    const archetype = archetypes?.[dominant];
    const desc = (lang === "zh" ? archetype?.desc_zh : archetype?.desc_en) ?? narrative?.description ?? "";
    const high = (lang === "zh" ? archetype?.high_zh : archetype?.high_en) ?? "";
    const low = (lang === "zh" ? archetype?.low_zh : archetype?.low_en) ?? "";
    const interpretation = desc;

    return (
      <div className="press-narrative flex flex-col gap-5">
        {interpretation && interpretation !== introDescription && <NarrativeBlock title={lang === "zh" ? "解读" : "Interpretation"} text={interpretation} />}
        {result.percentages && dimensions ? (
          <div className="flex flex-col gap-4 border-t border-border/60 pt-5">
            <h3 className="text-sm font-semibold text-foreground">{lang === "zh" ? "分项线索" : "Supporting signals"}</h3>
            {Object.entries(result.percentages).map(([key, percentage]) => (
              <DimensionBar key={key} name={dimensions[key]?.[lang === "zh" ? "zh" : "name"] ?? key} percentage={percentage} accentColor={accentColor} />
            ))}
          </div>
        ) : null}
        {high && <NarrativeBlock title={lang === "zh" ? "更明显的方向" : "More visible tendency"} text={high} />}
        {low && <NarrativeBlock title={lang === "zh" ? "另一侧观察" : "Another angle to notice"} text={low} />}
        {narrative?.quote && <blockquote className="atlas-quote">&ldquo;{narrative.quote}&rdquo;</blockquote>}
        <SceneList title={lang === "zh" ? "先在生活里找找" : "Start with everyday life"} items={narrative?.scenes} />
      </div>
    );
  }

  const sections: { title: string; text?: string }[] = [];
  if (narrative?.description && narrative.description !== introDescription) sections.push({ title: lang === "zh" ? "一句话理解" : "In one sentence", text: narrative.description });
  if (typeData?.description && typeData.description !== narrative?.description && typeData.description !== introDescription) sections.push({ title: lang === "zh" ? "更常见的背景" : "The broader pattern", text: typeData.description });
  if (narrative?.inRelationship || typeData?.inRelationship) sections.push({ title: lang === "zh" ? "在关系里可能出现" : "In relationships", text: narrative?.inRelationship ?? typeData?.inRelationship });
  if (narrative?.underPressure || typeData?.underPressure) sections.push({ title: lang === "zh" ? "压力上来时" : "When pressure rises", text: narrative?.underPressure ?? typeData?.underPressure });
  if (narrative?.atWork || typeData?.atWork) sections.push({ title: lang === "zh" ? "在工作或日常里" : "At work or in daily life", text: narrative?.atWork ?? typeData?.atWork });
  if (narrative?.hiddenStrength || typeData?.hiddenStrength) sections.push({ title: lang === "zh" ? "可以依靠的部分" : "What you can rely on", text: narrative?.hiddenStrength ?? typeData?.hiddenStrength });
  if (narrative?.contradiction) sections.push({ title: lang === "zh" ? "也许会来回拉扯的地方" : "Where it may pull both ways", text: narrative.contradiction });

  return (
    <div className="press-narrative flex flex-col gap-5">
      {sections.map((section) => <NarrativeBlock key={section.title} title={section.title} text={section.text} />)}
      <BadgeList title={lang === "zh" ? "你可以依靠的部分" : "Available strengths"} items={narrative?.strengths ?? typeData?.strengths} />
      <BadgeList title={lang === "zh" ? "值得轻轻留意的部分" : "Worth noticing gently"} items={narrative?.weaknesses ?? typeData?.weaknesses} />
      <TypeSignals result={result} dimensions={dimensions} accentColor={accentColor} lang={lang} />
      <SceneList title={lang === "zh" ? "先在生活里找找" : "Start with everyday life"} items={narrative?.scenes} />
      {narrative?.quote && <blockquote className="atlas-quote">&ldquo;{narrative.quote}&rdquo;</blockquote>}
    </div>
  );
}
