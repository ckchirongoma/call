// Call — the acceptance criteria are the definition of done (BEHAVIOR-MATRIX A3).
//
// criteria/*.md hold one criterion per table row, "| C-0412 | area | journey |
// given/when/then | owning test file |". Every criterion is proved by at least
// one test whose name carries its id in square brackets:
//
//   test("[C-0412][C-0413] read-back correction supersedes the earlier age", …)
//
// This script is what makes that true:
//   --count    print how many criteria exist per file and in total
//   --check    exit 1 if any criterion has no tag in test/**, or any tag names
//              a criterion that does not exist (a typo would otherwise pass)
//   --matrix   exit 1 if BEHAVIOR-MATRIX.md Part B cites an id or a range that
//              does not exist in criteria/
//   --missing  list untested criteria grouped by owning test file (for the
//              orchestrator when planning the next task)
//
// No dependencies, no network. Runs on Node 22 with native type stripping.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CRITERIA_DIR = join(ROOT, "criteria");
const TEST_DIR = join(ROOT, "test");
const MATRIX = join(ROOT, "BEHAVIOR-MATRIX.md");

export interface Criterion {
  id: string;
  area: string;
  journey: string;
  text: string;
  owner: string;
  file: string;
  line: number;
}

const ROW = /^\|\s*(C-\d{4})\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/;

export function loadCriteria(dir = CRITERIA_DIR): { criteria: Criterion[]; duplicates: string[] } {
  const criteria: Criterion[] = [];
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
    const lines = readFileSync(join(dir, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = ROW.exec(line);
      if (!m) return;
      const [, id, area, journey, text, owner] = m;
      if (seen.has(id)) duplicates.push(`${id} in ${name}:${i + 1} (first in ${seen.get(id)})`);
      seen.set(id, `${name}:${i + 1}`);
      criteria.push({ id, area, journey, text, owner, file: name, line: i + 1 });
    });
  }
  return { criteria, duplicates };
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

export function loadTags(dir = TEST_DIR): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\[(C-\d{4})\]/g)) {
      const list = tags.get(m[1]) ?? [];
      list.push(relative(ROOT, file));
      tags.set(m[1], list);
    }
  }
  return tags;
}

/** Ids and ranges cited in BEHAVIOR-MATRIX Part B: "C-0001–C-0012", "C-0100". */
export function matrixCitations(path = MATRIX): { ids: Set<string>; bad: string[] } {
  const ids = new Set<string>();
  const bad: string[] = [];
  const text = readFileSync(path, "utf8");
  for (const m of text.matchAll(/C-(\d{4})(?:\s*[–-]\s*C-(\d{4}))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 200) {
      bad.push(m[0]);
      continue;
    }
    for (let n = a; n <= b; n++) ids.add(`C-${String(n).padStart(4, "0")}`);
  }
  return { ids, bad };
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const { criteria, duplicates } = loadCriteria();
  const byFile = new Map<string, number>();
  for (const c of criteria) byFile.set(c.file, (byFile.get(c.file) ?? 0) + 1);
  if (duplicates.length) {
    console.error(`Duplicate criteria ids:\n  ${duplicates.join("\n  ")}`);
    process.exit(1);
  }

  if (args.has("--count") || args.size === 0) {
    for (const [f, n] of byFile) console.log(`${String(n).padStart(5)}  ${f}`);
    console.log(`${String(criteria.length).padStart(5)}  total`);
  }

  if (args.has("--matrix")) {
    const known = new Set(criteria.map((c) => c.id));
    const { ids, bad } = matrixCitations();
    const missing = [...ids].filter((id) => !known.has(id));
    if (bad.length || missing.length) {
      if (bad.length) console.error(`Malformed ranges in BEHAVIOR-MATRIX.md: ${bad.join(", ")}`);
      if (missing.length) console.error(`BEHAVIOR-MATRIX.md cites ${missing.length} ids that do not exist in criteria/: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", …" : ""}`);
      process.exit(1);
    }
    console.log(`BEHAVIOR-MATRIX.md cites ${ids.size} criteria, all present.`);
  }

  if (args.has("--check") || args.has("--missing")) {
    const tags = loadTags();
    const known = new Set(criteria.map((c) => c.id));
    const untested = criteria.filter((c) => !tags.has(c.id));
    const unknown = [...tags.keys()].filter((id) => !known.has(id));
    if (args.has("--missing")) {
      const groups = new Map<string, Criterion[]>();
      for (const c of untested) {
        const g = groups.get(c.owner) ?? [];
        g.push(c);
        groups.set(c.owner, g);
      }
      for (const [owner, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${owner}  (${list.length})`);
        for (const c of list) console.log(`  ${c.id}  ${c.text}`);
      }
    }
    console.log(`\n${criteria.length} criteria, ${criteria.length - untested.length} tagged in tests, ${untested.length} untested, ${unknown.length} unknown tags.`);
    if (args.has("--check") && (untested.length || unknown.length)) {
      if (unknown.length) console.error(`Tags with no criterion: ${unknown.join(", ")}`);
      if (untested.length) console.error(`Untested criteria: ${untested.slice(0, 30).map((c) => c.id).join(", ")}${untested.length > 30 ? ", …" : ""} (run --missing for the list)`);
      process.exit(1);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() as string)) main();
