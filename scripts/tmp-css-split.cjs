/** One-shot: split refactor.css into domain modules at its natural section
 * boundaries. Proves losslessness IN MEMORY (slices rejoined with the same
 * separators must equal the original), then writes module files with a
 * trailing newline. Import order = section order = identical cascade. */
const fs = require("node:fs");

const SRC = "src/app/refactor.css";
const OUT = "src/app/styles";
const original = fs.readFileSync(SRC, "utf8");
const lines = original.split("\n");

const sections = [
  { name: "base", start: 1 },
  { name: "shell", start: 74 },
  { name: "assessments", start: 215 },
  { name: "quiz", start: 798 },
  { name: "result", start: 1014 },
  { name: "journal", start: 1509 },
  { name: "home", start: 1965 },
  { name: "motion", start: 2057 },
];

const bounds = sections.map((s, i) => ({
  name: s.name,
  from: s.start - 1,
  to: i + 1 < sections.length ? sections[i + 1].start - 1 : lines.length,
}));

// Lossless proof: slices rejoined with "\n" must reproduce the original byte for byte.
const rebuiltInMemory = bounds.map((b) => lines.slice(b.from, b.to).join("\n")).join("\n");
if (rebuiltInMemory !== original) {
  console.error("LOSSY: section slices do not cover the original — aborting.");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
for (const b of bounds) {
  const chunk = lines.slice(b.from, b.to);
  const stripped = chunk.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  let balance = 0;
  for (const ch of stripped) {
    if (ch === "{") balance += 1;
    else if (ch === "}") balance -= 1;
  }
  if (balance !== 0) {
    console.error(`UNBALANCED module '${b.name}' (braces ${balance}) — aborting.`);
    process.exit(1);
  }
  fs.writeFileSync(`${OUT}/${b.name}.css`, chunk.join("\n") + "\n", "utf8");
  console.log(`${OUT}/${b.name}.css: ${chunk.length} lines, balanced`);
}
console.log("LOSSLESS: slices rejoined are byte-identical to refactor.css.");
