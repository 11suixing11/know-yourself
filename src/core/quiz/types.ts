export type Language = "zh" | "en";
export type Lang = Language;
export type QuizKind = "type" | "dimensions" | "score";

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface QuizVisual {
  src: string;
  width: number;
  height: number;
  alt: LocalizedText;
  focus?: {
    x: number;
    y: number;
  };
}

export interface QuizMedia {
  cover: QuizVisual;
  byResult?: Record<string, QuizVisual>;
  byScoreBand?: Record<string, QuizVisual>;
}

export type QuizTrustLevel = "research-adapted" | "self-exploration" | "playful-inspiration";
export type QuizTopicId = "self" | "emotion" | "relationship" | "life";

export interface QuizTrustProfile {
  type: QuizTrustLevel;
  label: LocalizedText;
  source: LocalizedText;
  limitations: LocalizedText;
}

export interface QuizTopic {
  id: QuizTopicId;
  label: LocalizedText;
}

export interface LegacyQuestion {
  id: number;
  zh: string;
  en: string;
  dimension?: string;
  options: {
    zh: string[];
    en: string[];
  };
  scores: number[];
  [key: string]: unknown;
}

export interface QuizOption {
  id: string;
  label: LocalizedText;
  score: number;
}

export interface QuizQuestion {
  id: number;
  prompt: LocalizedText;
  dimension?: string;
  options: QuizOption[];
}

export interface QuizResult {
  type?: string;
  dominant?: string;
  dominantType?: string;
  resultType?: string;
  primary?: string;
  secondary?: string;
  score?: number;
  overallScore?: number;
  percentage?: number;
  scores?: Record<string, number>;
  percentages?: Record<string, number>;
  dimensions?: ResultDimension[];
  [key: string]: unknown;
}

export interface NarrativeResult {
  hero?: string;
  archetype?: string;
  subtitle?: string;
  description?: string;
  quote?: string;
  mood?: string;
  strengths?: string[];
  weaknesses?: string[];
  scenes?: string[];
  inRelationship?: string;
  underPressure?: string;
  atWork?: string;
  hiddenStrength?: string;
  contradiction?: string;
  portrait?: Record<string, string>;
  bible?: Record<string, string>;
}

export interface TypeData {
  name?: string;
  title?: string;
  description?: string;
  inRelationship?: string;
  underPressure?: string;
  atWork?: string;
  hiddenStrength?: string;
  strengths?: string[];
  weaknesses?: string[];
}

export interface DimensionData {
  name: string;
  zh: string;
  description?: string;
  descriptionEn?: string;
  observation?: LocalizedText;
}

export interface ScoreBand {
  id: string;
  min: number;
  max: number;
  title: LocalizedText;
  description: LocalizedText;
  icon?: string;
  color?: string;
  suggestions?: {
    zh: string[];
    en: string[];
  };
}

export interface ResultDimension {
  name: string;
  zh: string;
  en?: string;
  score: number;
  left?: string;
  right?: string;
  leftScore?: number;
  rightScore?: number;
}

export interface ArchetypeData {
  world?: string;
  color?: string;
  mood?: string;
  title_zh?: string;
  title_en?: string;
  desc_zh?: string;
  desc_en?: string;
  high_zh?: string;
  high_en?: string;
  low_zh?: string;
  low_en?: string;
  quote_zh?: string;
  quote_en?: string;
  traits_zh?: string;
  traits_en?: string;
  scenes_zh?: string;
  scenes_en?: string;
  contradiction_zh?: string;
  contradiction_en?: string;
  growth_cost_zh?: string;
  growth_cost_en?: string;
  core_desire_zh?: string;
  core_desire_en?: string;
  core_fear_zh?: string;
  core_fear_en?: string;
  love_style_zh?: string;
  love_style_en?: string;
  breakdown_style_zh?: string;
  breakdown_style_en?: string;
  defense_mechanism_zh?: string;
  defense_mechanism_en?: string;
  growth_path_zh?: string;
  growth_path_en?: string;
  best_relationship_zh?: string;
  best_relationship_en?: string;
  music_mood_zh?: string;
  music_mood_en?: string;
}

export interface LegacyQuizContent {
  type?: string;
  icon?: string;
  color?: string;
  pattern?: QuizKind;
  category?: string;
  file?: string;
  time?: string;
  zh?: { name: string; description: string };
  en?: { name: string; description: string };
  questions: LegacyQuestion[];
  calculate: (answers: number[], questions: LegacyQuestion[]) => QuizResult;
  uiText?: {
    zh?: Record<string, string>;
    en?: Record<string, string>;
  };
  resultTypes?: unknown;
  narrative?: Record<string, { zh: NarrativeResult; en: NarrativeResult }>;
  types?: Record<string, { zh: TypeData; en: TypeData }>;
  dimensions?: Record<string, DimensionData>;
  archetypes?: Record<string, ArchetypeData>;
  [key: string]: unknown;
}

export interface QuizCatalogEntry {
  id: string;
  category: string;
  kind: QuizKind;
  questions: number;
  duration: string;
  icon: string;
  isNew: boolean;
  availability: "flagship" | "standard" | "review" | "archive";
  title: LocalizedText;
  description: LocalizedText;
  load: () => Promise<{ default: unknown }>;
}

export interface PublicQuizCatalogEntry extends QuizCatalogEntry {
  trust: QuizTrustProfile;
  topic: QuizTopic;
}

/**
 * The public catalog entry without its loader. A `load` function cannot cross
 * the server/client boundary, and importing the catalog client-side would drag
 * the full internal registry into the bundle. Server Components hand this
 * form to client pages instead.
 */
export type PublicQuizCard = Omit<PublicQuizCatalogEntry, "load">;

export interface QuizDefinition {
  id: string;
  kind: QuizKind;
  origin: "standard" | "legacy";
  category: string;
  accent: string;
  duration: string;
  title: LocalizedText;
  description: LocalizedText;
  media?: QuizMedia;
  questions: QuizQuestion[];
  resultContent: {
    uiText: { zh: Record<string, string>; en: Record<string, string> };
    resultTypes?: unknown;
    scoreBands?: ScoreBand[];
    scoreRange?: { min: number; max: number };
    narrative?: Record<string, { zh: NarrativeResult; en: NarrativeResult }>;
    types?: Record<string, { zh: TypeData; en: TypeData }>;
    dimensions?: Record<string, DimensionData>;
    archetypes?: Record<string, ArchetypeData>;
  };
  scoring: {
    kind: QuizKind;
    calculate: QuizCalculator;
  };
}

export type QuizCalculator = (answers: number[]) => QuizResult;

/**
 * The serializable half of a quiz. `scoring.calculate` is a function, so a
 * whole `QuizDefinition` can never cross the Server/Client boundary. The paper
 * can: a Server Component prerenders it and the client renders questions on
 * first paint, with no loading state.
 */
export type QuizPaper = Omit<QuizDefinition, "scoring">;

/**
 * The narrower slice the answering flow needs. Result copy (`resultContent`)
 * is by far the largest part of a paper and is useless until the quiz is done,
 * so it is deliberately absent here.
 */
export interface QuizQuestionSet {
  id: string;
  kind: QuizKind;
  accent: string;
  duration: string;
  title: LocalizedText;
  questions: QuizQuestion[];
}

export interface ScoringAdapter {
  kind: QuizKind;
  calculate: (definition: QuizDefinition, answers: number[]) => QuizResult;
}

export interface QuizValidationIssue {
  path: string;
  message: string;
}

export interface QuizValidationResult {
  valid: boolean;
  issues: QuizValidationIssue[];
}
