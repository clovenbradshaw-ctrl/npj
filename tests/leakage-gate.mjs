/* leakage-gate.mjs — the editing-only guarantee, enforced (Invariant I1, §8).
 *
 * The structure layer (slots, prompts, the applied type, parentSlotId, the
 * event log) is build-ignored and must NEVER reach a reader. This gate fails CI
 * if any of that crosses the line into the public record:
 *
 *   1. No published article event (articles/**.jsonl) may carry structural keys
 *      in its operand — a publish ships only { heading, body } prose.
 *   2. The reader (app/ArticleRead.jsx) must stay structure-blind — it may not
 *      reference NpjStructure or a .structure/ artifact.
 *   3. .structure/ must be git-ignored.
 *
 * Pure node, no deps. Exits non-zero (with what leaked) on any violation.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN_OPERAND_KEYS = ["slots", "sections", "structure", "appliedTypeId", "parentSlotId", "typeSlotKey", "structureLog"];
const violations = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1 — scan every published EO event for structural leakage in its operand.
const jsonl = walk(join(ROOT, "articles")).filter((p) => p.endsWith(".jsonl"));
let eventsScanned = 0;
for (const file of jsonl) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    eventsScanned++;
    const operand = ev && ev.operand;
    if (operand && typeof operand === "object") {
      for (const k of FORBIDDEN_OPERAND_KEYS) {
        if (Object.prototype.hasOwnProperty.call(operand, k)) {
          violations.push(`${file}: published operand carries structural key "${k}"`);
        }
      }
    }
  }
}

// 2 — the reader must not know structure exists.
const reader = join(ROOT, "app", "ArticleRead.jsx");
if (existsSync(reader)) {
  const src = readFileSync(reader, "utf8");
  if (/NpjStructure|\.structure\//.test(src)) violations.push("app/ArticleRead.jsx references the structure layer — the reader must stay structure-blind");
}

// 3 — .structure/ is build-ignored.
const gi = join(ROOT, ".gitignore");
if (!existsSync(gi) || !/(^|\n)\.structure\/?(\n|$)/.test(readFileSync(gi, "utf8"))) {
  violations.push(".gitignore does not ignore .structure/");
}

if (violations.length) {
  console.error("✗ structure leakage gate FAILED:");
  for (const v of violations) console.error("  · " + v);
  process.exit(1);
}
console.log(`✓ structure leakage gate passed (${eventsScanned} published events scanned, ${jsonl.length} files)`);
