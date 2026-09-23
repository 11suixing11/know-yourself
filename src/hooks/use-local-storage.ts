"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lang } from "@/lib/types";
import { pingContinuationBookmark } from "@/lib/metrics";
import {
  STORAGE_EVENT,
  deleteAttempt,
  getAttempts,
  getBookmarks,
  getLanguage,
  getPreferences,
  setPreference,
  toggleBookmark,
  type QuizAttempt,
} from "@/lib/storage";

function useStorageSubscription(onChange: () => void) {
  useEffect(() => {
    window.addEventListener(STORAGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [onChange]);
}

export function useLanguage() {
  const [language, setLanguageState] = useState<Lang>("zh");
  const sync = useCallback(() => setLanguageState(getLanguage()), []);
  useEffect(() => { const timer = window.setTimeout(sync, 0); return () => window.clearTimeout(timer); }, [sync]);
  useStorageSubscription(sync);
  const setLanguage = useCallback((next: Lang) => setPreference("lang", next), []);
  const toggleLanguage = useCallback(() => setLanguage(language === "zh" ? "en" : "zh"), [language, setLanguage]);
  return { language, setLanguage, toggleLanguage };
}

export function useTheme() {
  const [theme, setThemeState] = useState<"system" | "light" | "dark">("system");
  const sync = useCallback(() => setThemeState(getPreferences().theme), []);
  useEffect(() => { const timer = window.setTimeout(sync, 0); return () => window.clearTimeout(timer); }, [sync]);
  useStorageSubscription(sync);
  const setTheme = useCallback((next: "system" | "light" | "dark") => setPreference("theme", next), []);
  return { theme, setTheme };
}

export function useAttempts() {
  const [attempts, setAttemptsState] = useState<QuizAttempt[]>([]);
  const sync = useCallback(() => setAttemptsState(getAttempts()), []);
  useEffect(() => { const timer = window.setTimeout(sync, 0); return () => window.clearTimeout(timer); }, [sync]);
  useStorageSubscription(sync);
  return {
    attempts,
    deleteAttempt: useCallback((id: string) => deleteAttempt(id), []),
  };
}

export function useBookmarks() {
  const [bookmarks, setBookmarksState] = useState<string[]>([]);
  const sync = useCallback(() => setBookmarksState(getBookmarks()), []);
  useEffect(() => { const timer = window.setTimeout(sync, 0); return () => window.clearTimeout(timer); }, [sync]);
  useStorageSubscription(sync);
  return {
    bookmarks,
    // The P1 continuation judgment is made here on the device: only saving a
    // new bookmark counts, and only when a completion from an earlier day
    // within the 28-day window is already local (METRICS.md §5).
    toggleBookmark: useCallback((id: string) => {
      const added = !getBookmarks().includes(id);
      toggleBookmark(id);
      if (added) pingContinuationBookmark(getAttempts());
    }, []),
    isBookmarked: useCallback((id: string) => bookmarks.includes(id), [bookmarks]),
  };
}
