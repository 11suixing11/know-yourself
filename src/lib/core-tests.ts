import { TEST_REGISTRY, type TestRegistryEntry } from "./test-registry";
import { HOME_FACETS, type HomeFacet } from "./home-facets";
import type { QuizTopicId } from "@/core/quiz/types";

export type CoreTestGroupId = QuizTopicId;

/**
 * The facet data lives in `home-facets.ts` as a registry-free module so the
 * homepage can render facets without pulling the 193-entry registry into its
 * client bundle. Everything here derives from it.
 */
export type CoreTestGroup = HomeFacet;

/**
 * The small, intentional front door to the curated public catalog.
 * Keep this list curated; adding a test to the library must not automatically
 * add it to the homepage.
 */
export const CORE_TEST_GROUPS: CoreTestGroup[] = HOME_FACETS;

export const CORE_TEST_IDS = CORE_TEST_GROUPS.flatMap((group) => group.ids);

export const FEATURED_CORE_TEST_IDS = [
  "big-five",
  "emotion-regulation",
  "attachment-style",
  "lifestyle-alignment",
  "self-compassion",
  "work-style",
] as const;

export const CORE_TEST_SET = new Set(CORE_TEST_IDS);
const coreGroupByTestId = new Map(CORE_TEST_GROUPS.flatMap((group) => group.ids.map((id) => [id, group] as const)));

export const SENSITIVE_TEST_IDS = new Set([
  "anxiety",
  "depression",
  "ocd",
  "phobia",
  "death-anxiety",
  "existential-anxiety",
  "grief-processing",
  "body-image",
  "social-anxiety",
]);

export function getCoreTests(ids: string[] = CORE_TEST_IDS): TestRegistryEntry[] {
  return ids
    .map((id) => TEST_REGISTRY.find((test) => test.id === id))
    .filter((test): test is TestRegistryEntry => Boolean(test));
}

export function getCoreGroupTests(group: CoreTestGroup): TestRegistryEntry[] {
  return getCoreTests(group.ids);
}

export function getCoreTestGroup(testId: string): CoreTestGroup | undefined {
  return coreGroupByTestId.get(testId);
}

export function getNextCoreTests(currentTestId: string, limit = 3) {
  const currentGroup = getCoreTestGroup(currentTestId);
  const preferred = currentGroup?.ids.filter((id) => id !== currentTestId) ?? [];
  const fallback = CORE_TEST_IDS.filter((id) => id !== currentTestId && !preferred.includes(id));
  return getCoreTests([...preferred, ...fallback]).slice(0, limit);
}
