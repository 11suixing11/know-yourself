import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const testsDir = path.join(root, "src", "lib", "tests");
const registrySource = await readFile(path.join(root, "src", "lib", "test-registry.ts"), "utf8");
// CORE_TEST_GROUPS derives from home-facets.ts, so the drift contract reads
// the facet module where the curated ids actually live.
const coreSource = await readFile(path.join(root, "src", "lib", "home-facets.ts"), "utf8");
const files = await readdir(testsDir);

const entries = Array.from(registrySource.matchAll(/\{\s*id:\s*"([a-z0-9-]+)"\s*,\s*loader:\s*\(\)\s*=>\s*import\("\.\/tests\/([a-z0-9-]+)"\)/g), (match) => {
  assert.equal(match[1], match[2], `Registry loader mismatch: ${match[1]} -> ${match[2]}`);
  return match[1];
});
const ids = new Set(entries);
assert.equal(entries.length, 193, `Expected 193 registry entries, found ${entries.length}`);
assert.equal(ids.size, entries.length, "Registry contains duplicate IDs");

const testFiles = new Set(files.filter((file) => /^[a-z0-9-]+\.ts$/.test(file) && !["index.ts", "calculators.ts"].includes(file)).map((file) => file.slice(0, -3)));
assert.deepEqual([...ids].filter((id) => !testFiles.has(id)), [], "Registry entries missing source files");
assert.deepEqual([...testFiles].filter((id) => !ids.has(id)), [], "Source files missing registry entries");

const curatedGroups = Array.from(coreSource.matchAll(/ids:\s*\[([^\]]+)\]/g));
assert.equal(curatedGroups.length, 4, "CORE_TEST_GROUPS must keep four curated directions");
const curated = curatedGroups.flatMap((group) => Array.from(group[1].matchAll(/"([a-z0-9-]+)"/g), (match) => match[1]));
assert.equal(curated.length, 16, "CORE_TEST_GROUPS must contain 16 curated entries");
assert.equal(new Set(curated).size, 16, "CORE_TEST_GROUPS contains duplicate IDs");
for (const id of curated) {
  assert(ids.has(id), `Curated test missing from registry: ${id}`);
  const line = registrySource.split("\n").find((candidate) => candidate.includes(`id: "${id}"`));
  assert.ok(line, `Curated test has no registry line: ${id}`);
  assert.match(line, /availability:\s*"flagship"/, `Curated test must be marked flagship: ${id}`);
}

const flagshipLines = registrySource.split("\n").filter((line) => /availability:\s*"flagship"/.test(line));
assert.equal(flagshipLines.length, curated.length, "Registry flagship entries must match the 16 curated entries");

console.log(`✓ Registry consistency: ${ids.size} internal tests, ${curated.length} public flagship routes, every entry has a loader and source file`);
