#!/usr/bin/env node
/**
 * generate-hero-wash.mjs — bake the homepage watercolor hero washes.
 *
 * The hero background is not a photograph: it is a set of warm washes blooming
 * on transparent "paper". Blooms are soft radial gradients whose pigment pools
 * slightly at the rim (the mid-stop bump), roughened by an SVG turbulence
 * displacement so the edges read as wet paint instead of a vector ellipse.
 * No grain is baked here — the site-wide paper-grain overlay
 * (scripts/generate-paper-grain.mjs, body::after) already sits above the
 * hero, so baked noise would only cost bytes. Baking happens offline
 * (sharp + librsvg) so the runtime pays for none of the filters.
 *
 * Two variants are baked from the same composition:
 *   hero-wash-light.webp — clay/honey/earth stains for the cream paper
 *   hero-wash-dark.webp  — apricot/honey lamplight for the cocoa night
 *
 * Usage: node scripts/generate-hero-wash.mjs   (or: npm run hero:wash)
 */
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const W = 1920;
const H = 1080;
const OUT_DIR = "public/bg";

/** One bloom. profile "wash" = watercolor (pigment pools at the rim);
 * profile "lamp" = light (hot near-white centre, fast monotonic falloff,
 * no rim bump — a rim bump is exactly what turns a lamp back into haze). */
function bloomGradient(id, color, alpha, profile = "wash") {
  if (profile === "lamp") {
    const quarter = (alpha * 0.45).toFixed(3);
    const tail = (alpha * 0.12).toFixed(3);
    return [
      `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">`,
      `  <stop offset="0%" stop-color="${color}" stop-opacity="${alpha.toFixed(3)}"/>`,
      `  <stop offset="30%" stop-color="${color}" stop-opacity="${quarter}"/>`,
      `  <stop offset="60%" stop-color="${color}" stop-opacity="${tail}"/>`,
      `  <stop offset="100%" stop-color="${color}" stop-opacity="0"/>`,
      `</radialGradient>`,
    ].join("\n");
  }
  // Watercolor pigment settles at the rim of a wash: opacity dips mid-way
  // and climbs again before the edge dissolves.
  const mid = Math.max(alpha * 0.5, 0.03).toFixed(3);
  const rim = Math.max(alpha * 0.72, 0.045).toFixed(3);
  return [
    `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">`,
    `  <stop offset="0%" stop-color="${color}" stop-opacity="${alpha.toFixed(3)}"/>`,
    `  <stop offset="58%" stop-color="${color}" stop-opacity="${mid}"/>`,
    `  <stop offset="80%" stop-color="${color}" stop-opacity="${rim}"/>`,
    `  <stop offset="100%" stop-color="${color}" stop-opacity="0"/>`,
    `</radialGradient>`,
  ].join("\n");
}

function bloom(ref, cx, cy, rx, ry, rotate = 0) {
  const transform = rotate ? ` transform="rotate(${rotate} ${cx * W} ${cy * H})"` : "";
  return `<ellipse cx="${(cx * W).toFixed(1)}" cy="${(cy * H).toFixed(1)}" rx="${(rx * W).toFixed(1)}" ry="${(ry * H).toFixed(1)}" fill="url(#${ref})"${transform}/>`;
}

/**
 * The composition. The lede's text lives on the left and upper-left, so the
 * blooms gather to the right and the bottom; the far upper-left keeps a
 * whisper of sage so the band does not read as split in two.
 */
const LIGHT = [
  { ref: "w0", color: "#f2c499", alpha: 0.13, cx: 0.74, cy: 0.30, rx: 0.30, ry: 0.34, rotate: -12 }, // light apricot haze, upper right
  { ref: "w1", color: "#bcd9ea", alpha: 0.16, cx: 0.88, cy: 0.66, rx: 0.22, ry: 0.20, rotate: 8 },   // sky blue wash, lower right
  { ref: "w2", color: "#c3e3c9", alpha: 0.14, cx: 0.16, cy: 0.84, rx: 0.28, ry: 0.24, rotate: 0 },   // mint wash, bottom left
  { ref: "w3", color: "#ccd8ef", alpha: 0.11, cx: 0.10, cy: 0.22, rx: 0.15, ry: 0.13, rotate: 14 },  // pale blue whisper, far left
  { ref: "w4", color: "#f3ddab", alpha: 0.12, cx: 0.56, cy: 0.92, rx: 0.13, ry: 0.10, rotate: -6 },  // pale honey touch, bottom center
];

const DARK = [
  // Night lamps: near-white hot cores with tight, fast-fading halos over a
  // dark room. All lamp entries use the "lamp" gradient profile (hot centre,
  // monotonic falloff — no rim bump, which is what turned earlier attempts
  // back into haze). Displacement is gentler in the dark bake (scale 60) so
  // the small cores are not smeared apart.
  { ref: "c0", color: "#f7e6c8", alpha: 0.92, cx: 0.74, cy: 0.28, rx: 0.05, ry: 0.055, rotate: 0, profile: "lamp" },
  { ref: "h0", color: "#d9b183", alpha: 0.2, cx: 0.755, cy: 0.30, rx: 0.16, ry: 0.17, rotate: -12, profile: "lamp" },
  { ref: "c1", color: "#eef4fa", alpha: 0.92, cx: 0.87, cy: 0.62, rx: 0.045, ry: 0.045, rotate: 0, profile: "lamp" },
  { ref: "h1", color: "#a7c2dd", alpha: 0.18, cx: 0.875, cy: 0.64, rx: 0.13, ry: 0.12, rotate: 8, profile: "lamp" },
  { ref: "c2", color: "#e9f4e5", alpha: 0.85, cx: 0.17, cy: 0.78, rx: 0.045, ry: 0.04, rotate: 0, profile: "lamp" },
  { ref: "h2", color: "#b5d2af", alpha: 0.15, cx: 0.18, cy: 0.80, rx: 0.13, ry: 0.10, rotate: 0, profile: "lamp" },
  { ref: "c3", color: "#efecf8", alpha: 0.8, cx: 0.11, cy: 0.19, rx: 0.04, ry: 0.035, rotate: 14, profile: "lamp" },
  { ref: "h3", color: "#bcb4d8", alpha: 0.14, cx: 0.12, cy: 0.21, rx: 0.11, ry: 0.09, rotate: 14, profile: "lamp" },
  { ref: "c4", color: "#f5e4b8", alpha: 0.8, cx: 0.55, cy: 0.88, rx: 0.045, ry: 0.035, rotate: -6, profile: "lamp" },
  { ref: "h4", color: "#d9bd85", alpha: 0.15, cx: 0.56, cy: 0.90, rx: 0.11, ry: 0.08, rotate: -6, profile: "lamp" },
];

function buildSvg(variant, displacementScale = 120) {
  const gradients = variant.map((v) => bloomGradient(v.ref, v.color, v.alpha, v.profile)).join("\n");
  const blooms = variant.map((v) => bloom(v.ref, v.cx, v.cy, v.rx, v.ry, v.rotate)).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
${gradients}
<filter id="wash-edge" x="-25%" y="-25%" width="150%" height="150%">
  <feTurbulence type="fractalNoise" baseFrequency="0.011 0.015" numOctaves="3" seed="7" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="${displacementScale}" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#wash-edge)">${blooms}</g>
</svg>`;
}

async function bake(variant, out, displacementScale) {
  const svg = Buffer.from(buildSvg(variant, displacementScale));
  const info = await sharp(svg).webp({ quality: 84, alphaQuality: 90 }).toFile(`${OUT_DIR}/${out}`);
  console.log(`${out}: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB`);
}

await mkdir(OUT_DIR, { recursive: true });
// Light: displacement 120 roughens the wash edges into wet paint. Dark: 0 —
// turbulence displacement SHREDS small lamp cores (a ±60px pixel scatter
// turns a 96px bright core into gray fog), and lamp glow is smooth by nature.
await bake(LIGHT, "hero-wash-light.webp", 120);
await bake(DARK, "hero-wash-dark.webp", 0);
