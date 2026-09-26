"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

// useLayoutEffect warns when pre-rendered on the server; the effect is a
// no-op there anyway.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Route arrival vocabulary (see DESIGN.md → Motion). The destination decides
 * which gesture the incoming page performs:
 *   letter · /result/*        the answer unfolds from both edges
 *   turn   · /test/*          flip the page open to a new reading
 *   focus  · /quiz/*          the viewport closes in, answering begins
 *   curl   · /journal/{id}    a journal piece peels open from its corner
 *   rise   · everything else  the quiet default lift
 *
 * Timing: the class is applied directly in the pathname effect, which React
 * runs after the navigation commit and before paint — the animation starts
 * with the first frame of the incoming page. Direct application is safe
 * here because this app has no suspending routes (no loading.tsx; every
 * page fetches its data inside itself after mount), so the pathname change
 * and the page swap commit together. If a suspending route is ever added,
 * gate the class on the incoming page's mount instead.
 *
 * StrictMode immunity: React double-invokes the mount effect in dev with the
 * SAME pathname, so a "first mount" ref would see its second run as a
 * navigation and animate hard loads. The module-level lastPathname survives
 * both invocations, so only a real pathname change ever fires.
 */
function enterKindFor(pathname: string): string {
  if (pathname.startsWith("/result/")) return "letter";
  if (pathname.startsWith("/test/")) return "turn";
  if (pathname.startsWith("/quiz/")) return "focus";
  // A journal piece (`/journal/{id}`) opens by its corner; the library
  // (`/journal`), the editor (`/journal/new`, `/journal/{id}/edit`), and
  // every other surface take the default rise.
  if (/^\/journal\/(?!new\/?$)[^/]+\/?$/.test(pathname)) return "curl";
  return "rise";
}

const KINDS = ["letter", "turn", "focus", "curl", "rise"];

// Module state: survives StrictMode's double invocation of the mount effect.
let lastPathname: string | null = null;
let removalTimer: number | null = null;

function apply(kind: string) {
  const root = document.documentElement;
  for (const k of KINDS) root.classList.remove(`route-entering--${k}`);
  root.classList.add(`route-entering--${kind}`);
  if (removalTimer !== null) window.clearTimeout(removalTimer);
  removalTimer = window.setTimeout(() => {
    for (const k of KINDS) root.classList.remove(`route-entering--${k}`);
    removalTimer = null;
  }, 560);
}

export function RouteEnterEffect() {
  const pathname = usePathname();

  useClientLayoutEffect(() => {
    if (lastPathname === null) {
      // First run of a page load — including the StrictMode re-run, which
      // sees the same pathname: hard loads never animate.
      lastPathname = pathname;
      return;
    }
    if (pathname === lastPathname) return;
    lastPathname = pathname;
    apply(enterKindFor(pathname));
  }, [pathname]);

  return null;
}
