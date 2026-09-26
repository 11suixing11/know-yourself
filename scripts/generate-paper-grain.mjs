#!/usr/bin/env node
/**
 * generate-paper-grain.mjs — bake the site-wide paper grain tile.
 *
 * The whole site sits on a faint tooth: a 256px tileable grain placed OVER
 * every surface (body::after, fixed, pointer-events none) at a whisper of
 * opacity. Two prior attempts to texture the site failed because the texture
 * lived UNDER the page surfaces (body::before, background-image on body,
 * blend modes on solid page blocks); this tile is composited above them, so
 * nothing can hide it and no blend mode can crush it.
 *
 * The tile is opaque mid-grey noise; the CSS layer owns the opacity. The
 * noise is desaturated to pure luminance and its alpha flattened so strength
 * stays predictable at 3–5% opacity.
 *
 * Usage: node scripts/generate-paper-grain.mjs   (or: npm run paper:grain)
 */
import sharp from "sharp";

const SIZE = 256;
const OUT = "public/bg/paper-grain.png";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="42" stitchTiles="stitch"/>
  <feColorMatrix type="saturate" values="0" result="grey"/>
  <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1"/>
</filter>
</defs>
<rect width="${SIZE}" height="${SIZE}" filter="url(#grain)"/>
</svg>`;

const info = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT);
console.log(`${OUT}: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB`);
