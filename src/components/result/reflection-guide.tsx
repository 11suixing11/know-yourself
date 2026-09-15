"use client";

import Link from "next/link";
import { ArrowRight, CircleHelp, Footprints, Waves } from "lucide-react";

import { getNextCoreTests } from "@/lib/core-tests";
import type { PublicQuizCatalogEntry } from "@/core/quiz";
import type { DimensionData, Lang, QuizResult } from "@/lib/types";

interface ReflectionGuideProps {
  testId: string;
  entry: Pick<PublicQuizCatalogEntry, "topic">;
  pattern: "type" | "dimensions" | "score";
  result: QuizResult;
  dimensions?: Record<string, DimensionData>;
  accentColor: string;
  lang: Lang;
}

const categoryCopy: Record<string, {
  questionZh: string;
  questionEn: string;
  actionZh: string;
  actionEn: string;
}> = {
  self: {
    questionZh: "最近一次你觉得“这很像我”的时刻，发生了什么？",
    questionEn: "When did you most recently think, “this is very me,” and what was happening?",
    actionZh: "接下来一周，留意一次你顺着惯性行动的瞬间，再试一次不同的小选择。",
    actionEn: "This week, notice one moment when you act on autopilot, then try one small alternative.",
  },
  emotion: {
    questionZh: "当这种感受出现时，你通常最先注意到身体、想法，还是行为？",
    questionEn: "When this feeling appears, what do you notice first: your body, thoughts, or behavior?",
    actionZh: "给下一次明显情绪起一个更准确的名字，并记录它出现前的一件小事。",
    actionEn: "Give your next strong emotion a precise name and note one small thing that happened before it.",
  },
  relationship: {
    questionZh: "在重要关系里，你最希望对方理解、却最少直接说出口的是什么？",
    questionEn: "In an important relationship, what do you most want understood but least often say directly?",
    actionZh: "把一个含蓄期待改写成一句具体、可回应的表达。",
    actionEn: "Turn one unspoken expectation into a specific request the other person can respond to.",
  },
  life: {
    questionZh: "如果只调整一个日常习惯，什么最可能让生活更像你想要的样子？",
    questionEn: "If you changed one daily habit, which would make life feel more like the one you want?",
    actionZh: "把那个改变缩小成今天就能完成的一步。",
    actionEn: "Shrink that change into one step you can complete today.",
  },
};

const fallbackCopy = categoryCopy.self;

function getPatternText(
  pattern: ReflectionGuideProps["pattern"],
  result: QuizResult,
  dimensions: Record<string, DimensionData> | undefined,
  lang: Lang,
) {
  if (pattern === "dimensions" && result.percentages) {
    const top = Object.entries(result.percentages).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const labels = top.map(([key]) => {
      const dimension = dimensions?.[key];
      return lang === "zh" ? dimension?.zh ?? key : dimension?.name ?? key;
    });
    if (labels.length) {
      return lang === "zh"
        ? `你的结果有不止一个鲜明方向：${labels.join("、")}此刻更突出，其他维度让它更完整。`
        : `Your result has more than one strong direction. ${labels.join(" and ")} stand out now, while the other dimensions add context.`;
    }
  }
  if (pattern === "score") {
    return lang === "zh"
      ? "这个分数是你当下状态的一次快照。比起追求高低，更值得关注的是哪些题让你停顿，以及最近发生了什么。"
      : "This score is a snapshot of your current state. More than high or low, notice which questions made you pause and what has been happening lately.";
  }
  return lang === "zh"
    ? "你可以把这个类型当作当前最有共鸣的一面。情境、经验和关系会带出其他侧面，但这不影响你认领这份结果。"
    : "You can claim this type as a side of yourself that feels especially true right now. Context, experience, and relationships may bring out other sides too.";
}

export function ReflectionGuide({
  testId,
  entry,
  pattern,
  result,
  dimensions,
  accentColor,
  lang,
}: ReflectionGuideProps) {
  const copy = categoryCopy[entry.topic.id] ?? fallbackCopy;
  const recommendations = getNextCoreTests(testId, 3);
  const blocks = [
    {
      icon: Footprints,
      title: lang === "zh" ? "今天可以试试" : "One small thing to try",
      text: lang === "zh" ? copy.actionZh : copy.actionEn,
      nextStep: true,
    },
    {
      icon: CircleHelp,
      title: lang === "zh" ? "留给自己的问题" : "A question to keep",
      text: lang === "zh" ? copy.questionZh : copy.questionEn,
    },
    {
      icon: Waves,
      title: lang === "zh" ? "让它成为你的视角" : "Make it your lens",
      text: getPatternText(pattern, result, dimensions, lang),
    },
  ];

  return (
    <section className="press-reflection mt-8 w-full overflow-hidden rounded-2xl border border-border/60 bg-[var(--paper-strong)]">
      <div className="px-5 py-6 sm:px-7">
        <h2 className="text-xl font-semibold text-foreground">
          {lang === "zh" ? "把结果带回真实生活" : "Bring the result into real life"}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {lang === "zh"
            ? "从这份结果里挑一个让你有共鸣的部分，带回接下来的几天，看看它如何帮你理解自己。"
            : "Choose one question or action from this result and try it gently over the next few days."}
        </p>
      </div>

      <div className="border-t border-border/60">
        {blocks.map(({ icon: Icon, title, text, nextStep }) => (
          <div key={title} className={`atlas-reflection-block grid gap-3 border-b border-border/50 px-5 py-5 last:border-b-0 sm:grid-cols-[2.25rem_1fr] sm:px-7${nextStep ? " atlas-reflection-next-step" : ""}`}>
            <div
              className="flex size-9 items-center justify-center"
              style={{
                borderRadius: "var(--radius-media)",
                // `color-mix`, not a hex plus an alpha suffix: the accent is a
                // token reference now, and "var(--topic-self)14" is not a colour.
                backgroundColor: `color-mix(in oklab, ${accentColor} 12%, transparent)`,
                color: accentColor,
              }}
            >
              <Icon className="size-4" strokeWidth={1.8} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </div>
        ))}
      </div>

      {recommendations.length > 0 && (
        <div className="press-reflection-more border-t border-border/60 bg-[var(--sheet-surface)] px-5 py-5 dark:bg-white/[0.035] sm:px-7">
          <p className="text-xs font-medium text-muted-foreground">
            {lang === "zh" ? "想从另一个角度继续" : "Continue from another angle"}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {recommendations.map((test) => (
              <Link
                key={test.id}
                href={`/test/${test.id}/`}
                className="group flex min-h-20 items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-white/[0.06]"
              >
                <span>{lang === "zh" ? test.zh.name : test.en.name}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
