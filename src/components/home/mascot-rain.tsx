"use client";

import { useEffect, useState } from "react";

/**
 * The mascot rain (see DESIGN.md → Signature components): mascot stickers and
 * two tiny hand-drawn shapes drift down through the hero's morning sky, each
 * on its own lane, swaying and wobbling gently. The rain is decorative only —
 * aria-hidden, pointer-transparent, rendered behind the lede text (earlier in
 * DOM order under the same z-index) and faded by the paper scrim near the
 * bottom, so it reads as depth rather than noise.
 *
 * Randomness lives in an effect and lands in state, never in render — the
 * server output stays deterministic and hydration never mismatches. Under
 * `prefers-reduced-motion: reduce` no sprite is ever created.
 */
const SPRITES = [
  "/stickers/mascot-hamster.webp",
  "/stickers/mascot-cloud.webp",
  "/stickers/mascot-bear.webp",
  "/stickers/mascot-sprout.webp",
  "/stickers/mascot-cat.webp",
  "/stickers/deco-heart.svg",
  "/stickers/deco-star.svg",
];

interface Sprite {
  id: number;
  src: string;
  x: number; // lane position, % of hero width
  size: number; // px
  fall: number; // fall duration, s
  delay: number; // negative delay so the rain starts mid-flight
  sway: number; // sway half-cycle, s
  wobble: number; // tilt half-cycle, s
  tilt: number; // tilt amplitude, deg
}

function makeSprites(count: number): Sprite[] {
  return Array.from({ length: count }, (_, id) => {
    const deco = Math.random() < 0.45; // hearts/stars sprinkle between mascots
    const src = SPRITES[deco ? 5 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 5)];
    const size = deco ? 18 + Math.round(Math.random() * 12) : 44 + Math.round(Math.random() * 32);
    const fall = 10 + Math.random() * 8;
    return {
      id,
      src,
      x: Math.round(Math.random() * 96),
      size,
      fall: Number(fall.toFixed(2)),
      delay: Number((-Math.random() * fall).toFixed(2)),
      sway: Number((2.6 + Math.random() * 1.8).toFixed(2)),
      wobble: Number((3 + Math.random() * 3).toFixed(2)),
      tilt: 8 + Math.round(Math.random() * 8),
    };
  });
}

export function MascotRain() {
  const [sprites, setSprites] = useState<Sprite[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Wrapped in a frame callback: the random layout is generated after the
    // first paint, off the synchronous effect path.
    const raf = window.requestAnimationFrame(() => setSprites(makeSprites(12)));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  if (sprites.length === 0) return null;

  return (
    <div className="press-mascot-rain" aria-hidden="true">
      {sprites.map((s) => (
        <span
          key={s.id}
          className="press-mascot-lane"
          style={{ "--x": `${s.x}%` } as React.CSSProperties}
        >
          <span
            className="press-mascot-sprite"
            style={{ "--fall": `${s.fall}s`, "--delay": `${s.delay}s` } as React.CSSProperties}
          >
            <span
              className="press-mascot-sway"
              style={{ "--sway": `${s.sway}s` } as React.CSSProperties}
            >
              {/* Tiny decorative sprites — the unoptimized pipeline makes
                 next/image a plain <img> with no benefit here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="press-mascot-wobble"
                style={{ "--size": `${s.size}px`, "--wobble": `${s.wobble}s`, "--tilt": `${s.tilt}deg` } as React.CSSProperties}
                src={s.src}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
