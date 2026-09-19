import type { QuizTopicId } from "@/core/quiz/types";

/**
 * The four homepage facets as pure data. This module deliberately imports no
 * registry and no catalog: the homepage renders it beside `QUIZ_CATALOG`
 * without dragging the 193-entry registry into the client bundle. Any facet
 * here must keep its `ids` inside the public flagship set.
 */
export interface HomeFacet {
  id: QuizTopicId;
  emoji: string;
  stickerEmoji: string;
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
  entryTestId: string;
  entryZh: string;
  entryEn: string;
  entryHintZh: string;
  entryHintEn: string;
  ids: string[];
}

export const HOME_FACETS: HomeFacet[] = [
  {
    id: "self",
    emoji: "🪞",
    stickerEmoji: "✨",
    zh: "自我认知",
    en: "Know yourself",
    descriptionZh: "先从性格和倾向开始，看清自己更常使用的反应方式。",
    descriptionEn: "Start with personality and patterns to notice the responses you rely on most.",
    entryTestId: "mbti",
    entryZh: "最近总在问：我到底是什么样的人？",
    entryEn: "I keep wondering what kind of person I am.",
    entryHintZh: "从注意力、判断和行动方式开始看。",
    entryHintEn: "Start with how you focus, decide, and act.",
    ids: ["mbti", "big-five", "personality-archetype", "animal-personality"],
  },
  {
    id: "emotion",
    emoji: "⛅",
    stickerEmoji: "💧",
    zh: "情绪与能量",
    en: "Feel and recharge",
    descriptionZh: "看见情绪如何流动，也看见你恢复能量的方式。",
    descriptionEn: "Notice how emotions move through you and how you recover your energy.",
    entryTestId: "emotion-regulation",
    entryZh: "我明明已经很累了，却还在撑着。",
    entryEn: "I am tired, but I still keep holding it together.",
    entryHintZh: "看看你如何理解、容纳和表达情绪。",
    entryHintEn: "Notice how you reframe, hold, and express feelings.",
    ids: ["emotion-regulation", "emotional-resilience", "self-compassion", "stress-resilience"],
  },
  {
    id: "relationship",
    emoji: "🧸",
    stickerEmoji: "🫂",
    zh: "关系互动",
    en: "Relate with others",
    descriptionZh: "理解亲密、沟通和边界里的惯性反应。",
    descriptionEn: "Understand the patterns you bring to closeness, communication, and boundaries.",
    entryTestId: "attachment-style",
    entryZh: "我很在意这段关系，却不太会说自己的需要。",
    entryEn: "I care about this relationship, but struggle to say what I need.",
    entryHintZh: "从靠近、退开和寻求回应的方式开始。",
    entryHintEn: "Start with how you move toward, away, and ask for connection.",
    ids: ["attachment-style", "communication-style", "conflict-resolution", "boundaries"],
  },
  {
    id: "life",
    emoji: "🌷",
    stickerEmoji: "🌱",
    zh: "工作与生活",
    en: "Work and life",
    descriptionZh: "把价值观、工作方式和生活满意度放回真实日常。",
    descriptionEn: "Bring values, work style, and life satisfaction back to everyday choices.",
    entryTestId: "lifestyle-alignment",
    entryZh: "生活没有大问题，却总觉得哪里不太对。",
    entryEn: "Nothing is terribly wrong, but daily life still feels a little off.",
    entryHintZh: "看看重要的事，是否真的出现在你的日常里。",
    entryHintEn: "Notice whether what matters has a visible place in your days.",
    ids: ["career-values", "work-style", "life-satisfaction", "lifestyle-alignment"],
  },
];

/** Light group lookup for components that only need facet labels. */
const facetByTestId = new Map(HOME_FACETS.flatMap((facet) => facet.ids.map((id) => [id, facet] as const)));

export function getHomeFacet(testId: string): HomeFacet | undefined {
  return facetByTestId.get(testId);
}
