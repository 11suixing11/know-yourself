import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 900;
const OUTPUT_ROOT = path.join(process.cwd(), "public", "quiz-media");

/* Hearth-exposures over the morning-light skin. A lamplit room is one warm
 * object, so the four scene families are four exposures of the product's warm
 * topic hues rather than four different colours: clay 45 for the self scenes,
 * ember 25 for feeling, honey-earth 70 for relating, sage 140 for living. The
 * palettes stay mid and deep -- the meter needle's light honey (the one "you
 * are here" gold in the interface) never appears in an illustration, so a
 * bright golden pixel still reports a value and nothing else. */
const palettes = {
  forest: { paper: "#F8EFE2", sky: "#F1DECA", light: "#FEF9F0", soft: "#D9B896", ground: "#A97C50", ink: "#3A2A1B", accent: "#B0663A" },
  water: { paper: "#F8EEE9", sky: "#F1DACC", light: "#FEF8F3", soft: "#DCB49E", ground: "#B07157", ink: "#3B211A", accent: "#A85540" },
  bridge: { paper: "#F8F1DD", sky: "#F0E3C0", light: "#FDFAEC", soft: "#DCC48C", ground: "#B18F49", ink: "#3B2F14", accent: "#A87E2E" },
  table: { paper: "#EFF3E9", sky: "#DEE8D2", light: "#FBFDF5", soft: "#BDCBA9", ground: "#7F9869", ink: "#22301E", accent: "#5E7C4B" },
};


const scenes = [
  ["animal-personality/cover", "forest", "four-paths", 11],
  ["animal-personality/lion-drive", "forest", "forward-stone", 12],
  ["animal-personality/dog-connection", "forest", "paired-lights", 13],
  ["animal-personality/cat-independence", "forest", "window-seat", 14],
  ["animal-personality/owl-observation", "forest", "moon-desk", 15],
  ["animal-personality/mixed-rhythm", "forest", "woven-paths", 16],
  ["emotion-regulation/cover", "water", "rain-vessel", 21],
  ["emotion-regulation/reappraisal", "water", "prism-light", 22],
  ["emotion-regulation/containment", "water", "held-water", 23],
  ["emotion-regulation/acceptance", "water", "wide-ripples", 24],
  ["attachment-style/cover", "bridge", "island-bridge", 31],
  ["attachment-style/secure", "bridge", "steady-bridge", 32],
  ["attachment-style/anxious", "bridge", "reaching-light", 33],
  ["attachment-style/avoidant", "bridge", "shaded-platform", 34],
  ["attachment-style/disorganized", "bridge", "bending-bridge", 35],
  ["attachment-style/mixed", "bridge", "many-bridges", 36],
  ["life-satisfaction/cover", "table", "everyday-table", 41],
  ["life-satisfaction/low-friction", "table", "crowded-table", 42],
  ["life-satisfaction/mixed-ground", "table", "balanced-table", 43],
  ["life-satisfaction/supported-growth", "table", "open-growth", 44],
  ["home/journal-cover", "table", "journal-spread", 51],
];

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function texture(seed, color) {
  const random = seeded(seed);
  return Array.from({ length: 110 }, () => {
    const x = Math.round(random() * WIDTH);
    const y = Math.round(random() * HEIGHT);
    const radius = (0.7 + random() * 2.1).toFixed(2);
    const opacity = (0.025 + random() * 0.04).toFixed(3);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="${opacity}"/>`;
  }).join("");
}

function plant(x, y, scale, palette) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M0 90 C4 48 -5 18 4 -20" fill="none" stroke="${palette.ink}" stroke-width="9" stroke-linecap="round"/>
    <ellipse cx="-24" cy="26" rx="32" ry="15" transform="rotate(-28 -24 26)" fill="${palette.soft}"/>
    <ellipse cx="31" cy="4" rx="36" ry="16" transform="rotate(25 31 4)" fill="${palette.ground}"/>
    <ellipse cx="-19" cy="-19" rx="28" ry="13" transform="rotate(-24 -19 -19)" fill="${palette.accent}" opacity=".82"/>
  </g>`;
}

function lamp(x, y, scale, palette, glow = palette.light) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <circle cx="0" cy="0" r="82" fill="${glow}" opacity=".22"/>
    <path d="M-34 12 Q0 -42 34 12 L23 39 H-23 Z" fill="${glow}"/>
    <rect x="-6" y="38" width="12" height="82" rx="6" fill="${palette.ink}"/>
    <ellipse cx="0" cy="124" rx="40" ry="10" fill="${palette.ink}" opacity=".22"/>
  </g>`;
}

function bridge(x1, y1, x2, y2, width, palette) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return `<g transform="translate(${x1} ${y1}) rotate(${angle})">
    <rect x="0" y="-${width / 2}" width="${length}" height="${width}" rx="${width / 2}" fill="${palette.light}" stroke="${palette.ink}" stroke-opacity=".18" stroke-width="3"/>
    ${Array.from({ length: Math.max(3, Math.floor(length / 58)) }, (_, index) => `<line x1="${26 + index * 56}" y1="-${width / 2 + 2}" x2="${26 + index * 56}" y2="${width / 2 - 2}" stroke="${palette.ink}" stroke-opacity=".13" stroke-width="3"/>`).join("")}
  </g>`;
}

function motif(name, palette) {
  const p = palette;
  const motifs = {
    "four-paths": `<path d="M600 545 C495 520 382 450 275 250" fill="none" stroke="${p.light}" stroke-width="70" stroke-linecap="round"/><path d="M600 545 C700 470 805 382 920 225" fill="none" stroke="${p.accent}" stroke-opacity=".76" stroke-width="62" stroke-linecap="round"/><path d="M600 545 C520 625 440 712 390 850" fill="none" stroke="${p.soft}" stroke-width="68" stroke-linecap="round"/><path d="M600 545 C690 625 790 725 850 850" fill="none" stroke="${p.ink}" stroke-opacity=".72" stroke-width="64" stroke-linecap="round"/><circle cx="600" cy="545" r="102" fill="${p.paper}" stroke="${p.ink}" stroke-opacity=".16" stroke-width="4"/>${plant(602, 520, .72, p)}`,
    "forward-stone": `<path d="M160 745 C420 690 680 575 1040 285" fill="none" stroke="${p.light}" stroke-width="145" stroke-linecap="round"/><path d="M205 745 C465 686 700 562 1035 300" fill="none" stroke="${p.accent}" stroke-opacity=".28" stroke-width="28" stroke-linecap="round"/><path d="M425 690 L530 480 L735 452 L808 650 L650 775 Z" fill="${p.ink}" opacity=".88"/><path d="M485 610 L540 506 L692 491 L746 617 L632 690 Z" fill="${p.ground}"/>` ,
    "paired-lights": `<rect x="225" y="606" width="750" height="78" rx="39" fill="${p.ink}" opacity=".82"/><rect x="285" y="677" width="28" height="104" rx="14" fill="${p.ink}" opacity=".72"/><rect x="887" y="677" width="28" height="104" rx="14" fill="${p.ink}" opacity=".72"/>${lamp(382, 520, .72, p)}${lamp(818, 520, .72, p)}<path d="M446 542 Q600 470 754 542" fill="none" stroke="${p.accent}" stroke-width="10" stroke-linecap="round" opacity=".8"/>`,
    "window-seat": `<rect x="192" y="142" width="816" height="520" rx="18" fill="${p.light}" stroke="${p.ink}" stroke-opacity=".18" stroke-width="5"/><path d="M600 145 V660" stroke="${p.ink}" stroke-opacity=".12" stroke-width="5"/><path d="M194 555 Q430 380 602 500 Q790 335 1006 470 V660 H194 Z" fill="${p.soft}" opacity=".78"/><rect x="255" y="650" width="420" height="98" rx="30" fill="${p.ink}" opacity=".86"/><rect x="290" y="605" width="205" height="77" rx="32" fill="${p.accent}"/><circle cx="860" cy="268" r="75" fill="${p.paper}" opacity=".88"/>`,
    "moon-desk": `<rect x="182" y="590" width="836" height="82" rx="24" fill="${p.ink}" opacity=".88"/><circle cx="862" cy="245" r="104" fill="${p.light}"/><circle cx="896" cy="221" r="104" fill="${p.sky}"/><path d="M390 565 L470 405 L555 565 Z" fill="${p.soft}"/><path d="M505 565 L605 320 L720 565 Z" fill="${p.ground}"/>${lamp(315, 463, .72, p)}<path d="M348 463 Q505 385 645 370" fill="none" stroke="${p.light}" stroke-width="46" stroke-linecap="round" opacity=".55"/>`,
    "woven-paths": `<path d="M125 735 C365 665 430 335 660 260 C810 210 965 280 1085 390" fill="none" stroke="${p.accent}" stroke-width="56" stroke-linecap="round" opacity=".78"/><path d="M105 330 C325 350 445 620 690 645 C845 660 930 560 1090 490" fill="none" stroke="${p.light}" stroke-width="62" stroke-linecap="round"/><path d="M305 865 C335 610 570 525 575 250" fill="none" stroke="${p.soft}" stroke-width="60" stroke-linecap="round"/><path d="M790 865 C755 665 650 475 755 110" fill="none" stroke="${p.ink}" stroke-opacity=".7" stroke-width="54" stroke-linecap="round"/><circle cx="595" cy="520" r="88" fill="${p.paper}"/>${plant(595, 505, .65, p)}`,
    "rain-vessel": `<path d="M180 170 C240 260 245 360 180 445 M340 110 C400 230 400 330 335 420 M1020 160 C960 250 950 350 1015 440" fill="none" stroke="${p.ink}" stroke-opacity=".26" stroke-width="13" stroke-linecap="round"/><path d="M402 360 Q600 285 798 360 L750 695 Q600 790 450 695 Z" fill="${p.light}" fill-opacity=".54" stroke="${p.ink}" stroke-opacity=".28" stroke-width="6"/><path d="M448 575 Q600 530 752 575 L750 695 Q600 790 450 695 Z" fill="${p.ground}" opacity=".76"/><ellipse cx="600" cy="718" rx="365" ry="88" fill="${p.soft}" opacity=".42"/><ellipse cx="600" cy="718" rx="250" ry="58" fill="none" stroke="${p.light}" stroke-width="8" opacity=".78"/>`,
    "prism-light": `<path d="M110 425 L515 425" stroke="${p.light}" stroke-width="95" stroke-linecap="round"/><path d="M515 425 L750 250 L750 600 Z" fill="${p.paper}" fill-opacity=".72" stroke="${p.ink}" stroke-opacity=".22" stroke-width="6"/><path d="M750 310 L1100 185" stroke="${p.accent}" stroke-width="62" stroke-linecap="round" opacity=".78"/><path d="M750 425 L1110 410" stroke="${p.soft}" stroke-width="58" stroke-linecap="round" opacity=".85"/><path d="M750 545 L1080 660" stroke="${p.ground}" stroke-width="56" stroke-linecap="round" opacity=".72"/>`,
    "held-water": `<path d="M270 210 C410 330 400 470 520 548" fill="none" stroke="${p.soft}" stroke-width="82" stroke-linecap="round"/><path d="M420 300 H785 L742 710 Q600 790 458 710 Z" fill="${p.ink}" opacity=".9"/><path d="M470 520 Q600 470 730 520 L710 685 Q600 746 490 685 Z" fill="${p.ground}"/><path d="M735 613 Q835 590 955 655" fill="none" stroke="${p.light}" stroke-width="32" stroke-linecap="round"/><circle cx="988" cy="666" r="16" fill="${p.light}"/>`,
    "wide-ripples": `<ellipse cx="600" cy="620" rx="470" ry="205" fill="${p.ground}" opacity=".48"/><ellipse cx="600" cy="620" rx="355" ry="142" fill="none" stroke="${p.light}" stroke-width="9" opacity=".82"/><ellipse cx="600" cy="620" rx="225" ry="84" fill="none" stroke="${p.light}" stroke-width="8" opacity=".72"/><ellipse cx="600" cy="620" rx="92" ry="33" fill="none" stroke="${p.light}" stroke-width="7" opacity=".62"/><path d="M435 135 C475 240 475 330 435 405 M600 80 C650 215 650 330 600 455 M770 140 C810 245 810 340 770 420" fill="none" stroke="${p.ink}" stroke-opacity=".3" stroke-width="12" stroke-linecap="round"/>`,
    "island-bridge": `<ellipse cx="315" cy="645" rx="250" ry="135" fill="${p.ground}"/><ellipse cx="895" cy="595" rx="245" ry="128" fill="${p.soft}"/>${bridge(430, 585, 760, 560, 70, p)}${plant(290, 545, .7, p)}${plant(920, 505, .63, p)}`,
    "steady-bridge": `<rect x="95" y="590" width="330" height="190" rx="88" fill="${p.ground}"/><rect x="775" y="590" width="330" height="190" rx="88" fill="${p.soft}"/>${bridge(390, 610, 810, 610, 88, p)}${lamp(260, 510, .55, p)}${lamp(940, 510, .55, p)}`,
    "reaching-light": `<ellipse cx="300" cy="680" rx="245" ry="120" fill="${p.ground}"/><ellipse cx="940" cy="510" rx="175" ry="92" fill="${p.soft}" opacity=".72"/>${lamp(315, 545, .72, p)}${lamp(935, 405, .36, p)}<path d="M385 540 Q635 420 850 425" fill="none" stroke="${p.light}" stroke-width="26" stroke-linecap="round" opacity=".76"/><path d="M405 650 Q650 505 835 505" fill="none" stroke="${p.ink}" stroke-opacity=".22" stroke-width="7" stroke-dasharray="18 24"/>`,
    "shaded-platform": `<rect x="130" y="565" width="420" height="205" rx="92" fill="${p.ink}" opacity=".88"/><ellipse cx="955" cy="570" rx="220" ry="110" fill="${p.soft}"/>${bridge(535, 630, 755, 585, 52, p)}<circle cx="265" cy="275" r="190" fill="${p.ground}" opacity=".82"/>${plant(900, 490, .72, p)}${lamp(965, 470, .42, p)}`,
    "bending-bridge": `<ellipse cx="215" cy="690" rx="180" ry="95" fill="${p.ground}"/><ellipse cx="995" cy="475" rx="170" ry="88" fill="${p.soft}"/><path d="M330 665 C475 650 440 490 595 505 C735 520 700 360 850 405" fill="none" stroke="${p.light}" stroke-width="72" stroke-linecap="round" stroke-linejoin="round"/><path d="M330 665 C475 650 440 490 595 505 C735 520 700 360 850 405" fill="none" stroke="${p.ink}" stroke-opacity=".14" stroke-width="5" stroke-dasharray="32 28"/>`,
    "many-bridges": `<ellipse cx="240" cy="660" rx="175" ry="90" fill="${p.ground}"/><ellipse cx="590" cy="480" rx="155" ry="82" fill="${p.soft}"/><ellipse cx="955" cy="650" rx="180" ry="92" fill="${p.accent}" opacity=".65"/>${bridge(350, 625, 480, 530, 42, p)}${bridge(705, 520, 840, 615, 52, p)}${bridge(395, 682, 805, 682, 35, p)}${plant(225, 585, .5, p)}${plant(585, 405, .45, p)}${plant(960, 575, .52, p)}`,
    "everyday-table": `<rect x="90" y="520" width="1020" height="300" rx="35" fill="${p.light}"/><rect x="150" y="610" width="330" height="135" rx="12" fill="${p.paper}" stroke="${p.ink}" stroke-opacity=".13" stroke-width="4"/><path d="M315 610 V745" stroke="${p.ink}" stroke-opacity=".1" stroke-width="3"/><path d="M750 620 Q835 580 920 620 L890 735 H780 Z" fill="${p.accent}" opacity=".78"/>${plant(680, 560, .85, p)}<circle cx="965" cy="345" r="135" fill="${p.light}" opacity=".72"/>`,
    "crowded-table": `<rect x="90" y="525" width="1020" height="300" rx="35" fill="${p.light}"/><rect x="145" y="610" width="300" height="145" rx="18" fill="${p.paper}"/><circle cx="415" cy="650" r="88" fill="${p.accent}" opacity=".8"/><rect x="470" y="585" width="235" height="180" rx="35" fill="${p.ink}" opacity=".82"/><path d="M690 625 Q780 565 870 625 L835 770 H725 Z" fill="${p.ground}"/>${plant(820, 575, .7, p)}<rect x="925" y="610" width="125" height="118" rx="20" fill="${p.soft}"/><path d="M965 120 V460" stroke="${p.light}" stroke-width="95" stroke-linecap="round" opacity=".74"/>`,
    "balanced-table": `<rect x="90" y="525" width="1020" height="300" rx="35" fill="${p.light}"/><path d="M600 525 V825" stroke="${p.ink}" stroke-opacity=".12" stroke-width="4"/><rect x="175" y="610" width="275" height="132" rx="15" fill="${p.paper}"/><circle cx="515" cy="678" r="62" fill="${p.accent}" opacity=".76"/>${plant(790, 575, .78, p)}<path d="M885 625 Q950 590 1015 625 L988 735 H912 Z" fill="${p.ground}"/><path d="M600 155 V490" stroke="${p.light}" stroke-width="120" stroke-linecap="round" opacity=".64"/>`,
    "open-growth": `<rect x="90" y="525" width="1020" height="300" rx="35" fill="${p.light}"/><rect x="160" y="625" width="285" height="126" rx="15" fill="${p.paper}" stroke="${p.ink}" stroke-opacity=".1" stroke-width="4"/>${plant(725, 550, 1.18, p)}<path d="M845 625 Q930 580 1015 625 L980 752 H880 Z" fill="${p.ground}"/><circle cx="815" cy="270" r="180" fill="${p.light}" opacity=".8"/><path d="M500 705 H600" stroke="${p.accent}" stroke-width="20" stroke-linecap="round" opacity=".72"/>`,
    "journal-spread": `<path d="M165 245 Q395 175 600 300 V765 Q390 680 165 735 Z" fill="${p.light}" stroke="${p.ink}" stroke-opacity=".13" stroke-width="5"/><path d="M1035 245 Q805 175 600 300 V765 Q810 680 1035 735 Z" fill="${p.paper}" stroke="${p.ink}" stroke-opacity=".13" stroke-width="5"/><path d="M600 302 V765" stroke="${p.ink}" stroke-opacity=".14" stroke-width="5"/><rect x="235" y="300" width="260" height="205" rx="18" fill="${p.soft}" transform="rotate(-4 365 402)"/><path d="M250 467 Q330 355 405 415 Q455 365 500 442 V505 H250 Z" fill="${p.ground}" opacity=".86"/><circle cx="420" cy="347" r="38" fill="${p.light}"/><rect x="710" y="365" width="235" height="185" rx="18" fill="${p.accent}" opacity=".78" transform="rotate(5 827 457)"/><path d="M720 505 Q770 425 825 465 Q880 385 945 475 V548 H720 Z" fill="${p.ink}" opacity=".72"/>${plant(570, 315, .48, p)}<circle cx="832" cy="625" r="34" fill="${p.soft}"/><circle cx="892" cy="655" r="20" fill="${p.accent}"/>`,
  };
  return motifs[name];
}

function renderSvg(palette, motifName, seed) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette.paper}"/>
        <stop offset=".58" stop-color="${palette.sky}"/>
        <stop offset="1" stop-color="${palette.soft}"/>
      </linearGradient>
      <radialGradient id="sun" cx="78%" cy="12%" r="62%">
        <stop offset="0" stop-color="${palette.light}" stop-opacity=".92"/>
        <stop offset="1" stop-color="${palette.light}" stop-opacity="0"/>
      </radialGradient>
      <filter id="depth" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="${palette.ink}" flood-opacity=".14"/>
      </filter>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#background)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sun)"/>
    <path d="M0 610 Q220 510 410 600 T800 560 T1200 555 V900 H0 Z" fill="${palette.ground}" opacity=".18"/>
    <g filter="url(#depth)">${motif(motifName, palette)}</g>
    <g>${texture(seed, palette.ink)}</g>
    <rect x="18" y="18" width="1164" height="864" rx="34" fill="none" stroke="${palette.ink}" stroke-opacity=".08" stroke-width="3"/>
  </svg>`;
}

for (const [name, paletteName, motifName, seed] of scenes) {
  const output = path.join(OUTPUT_ROOT, `${name}.webp`);
  await mkdir(path.dirname(output), { recursive: true });
  const svg = renderSvg(palettes[paletteName], motifName, seed);
  await sharp(Buffer.from(svg))
    .resize(WIDTH, HEIGHT)
    .webp({ quality: 88, effort: 6, smartSubsample: true })
    .toFile(output);
  console.log(path.relative(process.cwd(), output));
}
