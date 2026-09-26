/* Palette contrast audit for the live cascade: tokens.css :root/.dark then
 * src/app/refactor.css :root/.dark (later files win, matching the CSS import
 * order in src/app/layout.tsx). Every foreground/background pair the interface
 * relies on must clear the design-system floor (5.4:1). The script resolves
 * var() chains across the merged cascade, converts oklch to sRGB, and reports
 * WCAG ratios plus hex values (hex doubles as the source for themeColor and
 * manifest colours). Run: node scripts/check-palette-contrast.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const FLOOR = 5.4;
const SOURCES = [
  path.join(process.cwd(), "tokens.css"),
  path.join(process.cwd(), "src/app/refactor.css"),
];

function parseBlocks(css, file) {
  const blocks = {};
  for (const name of [":root", ".dark"]) {
    const at = css.indexOf(`${name} {`);
    if (at === -1) continue;
    let depth = 0;
    let i = at + name.length;
    while (css[i] !== "{") i += 1;
    const bodyStart = i + 1;
    i += 1;
    for (; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") {
        if (depth === 0) break;
        depth -= 1;
      }
    }
    const map = {};
    for (const m of css.slice(bodyStart, i).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
      map[m[1]] = m[2].trim();
    }
    blocks[name] = { ...(blocks[name] ?? {}), ...map };
  }
  if (!blocks[":root"]) throw new Error(`:root not found in ${file}`);
  return blocks;
}

const cascade = { root: {}, dark: {} };
for (const file of SOURCES) {
  const blocks = parseBlocks(readFileSync(file, "utf8"), file);
  Object.assign(cascade.root, blocks[":root"]);
  Object.assign(cascade.dark, blocks[".dark"] ?? {});
}

function resolve(map, name, depth = 0) {
  if (depth > 6) throw new Error(`var() chain too deep at ${name}`);
  const raw = map[name];
  if (raw === undefined) throw new Error(`token --${name} not found`);
  const ref = raw.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolve(map, ref[1], depth + 1);
  return raw;
}

function parseOklch(value) {
  const m = value.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/);
  if (!m) throw new Error(`not oklch: ${value}`);
  return [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
}

function oklchToSrgb([l, c, hDeg]) {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [l2, m2, s2] = [l_ ** 3, m_ ** 3, s_ ** 3];
  let r = 4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2;
  let g = -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2;
  let bb = -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2;
  const enc = (x) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [enc(r), enc(g), enc(bb)];
}

function luminance(encoded) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = encoded.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function toHex([r, g, b]) {
  const hex = (x) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const PAIRS = {
  light: [
    ["color-ink", "color-paper"],
    ["color-ink", "color-paper-strong"],
    ["color-accent-ink", "color-accent"],
    ["color-accent", "color-paper"],
    ["color-accent", "color-paper-strong"],
    ["color-muted-text", "color-paper"],
    ["color-muted-text", "color-paper-strong"],
    ["color-danger", "color-paper"],
    ["color-signal-ink", "color-signal"],
    ["color-sheet-ink", "color-sheet-surface"],
    ["color-teal", "color-paper"],
    ["surface-contrast-ink", "surface-contrast"],
    ["color-topic-self", "color-paper-strong"],
    ["color-topic-emotion", "color-paper-strong"],
    ["color-topic-relationship", "color-paper-strong"],
    ["color-topic-life", "color-paper-strong"],
  ],
  dark: [
    ["color-ink", "color-paper"],
    ["color-ink", "color-paper-strong"],
    ["color-accent-ink", "color-accent"],
    ["color-accent", "color-paper"],
    ["color-muted-text", "color-paper"],
    ["color-danger", "color-paper"],
    ["color-teal", "color-paper"],
    ["color-sheet-ink", "color-sheet-surface"],
    ["surface-contrast-ink", "surface-contrast"],
    ["color-topic-self", "color-paper-strong"],
    ["color-topic-emotion", "color-paper-strong"],
    ["color-topic-relationship", "color-paper-strong"],
    ["color-topic-life", "color-paper-strong"],
  ],
};

let failures = 0;
const anchors = {};
for (const [mode, pairs] of Object.entries(PAIRS)) {
  const map = mode === "light" ? cascade.root : { ...cascade.root, ...cascade.dark };
  console.log(`\n${mode}`);
  for (const [fg, bg] of pairs) {
    const fgRgb = oklchToSrgb(parseOklch(resolve(map, fg)));
    const bgRgb = oklchToSrgb(parseOklch(resolve(map, bg)));
    const r = ratio(fgRgb, bgRgb);
    const ok = r >= FLOOR;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "pass" : "FAIL"}  ${r.toFixed(2).padStart(5)}  ${fg} on ${bg}  (${toHex(fgRgb)} / ${toHex(bgRgb)})`);
    if (mode === "light") anchors[`${fg}/${bg}`] = [toHex(fgRgb), toHex(bgRgb)];
  }
}

console.log(`\nthemeColor light (paper) = ${anchors["color-ink/color-paper"][1]}`);
const darkPaper = resolve({ ...cascade.root, ...cascade.dark }, "color-paper");
console.log(`themeColor dark (paper in .dark) = ${toHex(oklchToSrgb(parseOklch(darkPaper)))}`);
console.log(`\n${failures === 0 ? `all pairs >= ${FLOOR}:1` : `${failures} pair(s) below ${FLOOR}:1`}`);
process.exit(failures === 0 ? 0 : 1);
