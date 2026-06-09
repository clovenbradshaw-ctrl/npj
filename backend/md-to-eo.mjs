#!/usr/bin/env node
/* md-to-eo.mjs — one-off migration: a legacy published .md (the old commit
 * format) → an EO event log (articles/<slug>.jsonl, schema npj/article-eo/1).
 *
 * The site no longer reads .md articles; it lists and folds the JSONL logs
 * (app/articles.js). This converts what was already published so it joins the
 * record: the whole piece becomes the log's INS genesis line, [^key] citations
 * become source-bound claim tokens (bound to the sentence they follow), and
 * the footnote definitions at the bottom become the source records.
 *
 *   node backend/md-to-eo.mjs <file.md> [--column X] [--author @mxid]
 *                             [--published YYYY-MM-DD] [--dek-first]
 *
 * --dek-first: treat the first paragraph after the H1 as the standfirst (the
 * legacy export carried the dek as a plain first paragraph). Writes the
 * .jsonl next to articles/ and prints the path.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SCHEMA = "npj/article-eo/1";
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
if (!file) { console.error("usage: node backend/md-to-eo.mjs <file.md> [--column X] [--author @mxid] [--published YYYY-MM-DD] [--dek-first]"); process.exit(1); }
const opt = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const flag = (name) => args.includes("--" + name);

const raw = readFileSync(file, "utf8");
const slug = basename(file).replace(/\.md$/i, "");
const lines = raw.split(/\r?\n/);

// ---- meta comment: <!-- column: X · tags: a, b · subtitle: S -->
let column = opt("column", ""), tags = [], metaDek = "";
const metaLine = lines.find(l => /^<!--/.test(l.trim()));
if (metaLine) {
  const inner = metaLine.replace(/^<!--/, "").replace(/-->$/, "");
  const pos = {};
  ["column", "tags", "subtitle"].forEach(k => { const i = inner.indexOf(k + ":"); if (i >= 0) pos[k] = i; });
  const keys = Object.keys(pos).sort((a, b) => pos[a] - pos[b]);
  keys.forEach((k, i) => {
    let v = inner.slice(pos[k] + k.length + 1, i + 1 < keys.length ? pos[keys[i + 1]] : undefined).trim();
    v = v.replace(/[·\s]+$/, "").trim();
    if (k === "column" && v) column = column || v;
    if (k === "tags" && v) tags = v.split(",").map(s => s.trim()).filter(Boolean);
    if (k === "subtitle" && v) metaDek = v;
  });
}

// ---- footnote definitions → source records
const sources = {};
for (const l of lines) {
  const m = l.match(/^\[\^([^\]]+)\]:\s*(\S+)/);
  if (!m) continue;
  const key = m[1], url = m[2];
  const wb = url.match(/^https?:\/\/web\.archive\.org\/web\/(\d{4})(\d{2})(\d{2})\d*\/(.+)$/);
  const original = wb ? wb[4] : url;
  let host = "";
  try { host = new URL(original).hostname.replace(/^www\./, ""); } catch (e) {}
  const lastSeg = (() => { try { return decodeURIComponent(new URL(original).pathname.split("/").filter(Boolean).pop() || ""); } catch (e) { return ""; } })();
  const title = lastSeg ? lastSeg.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : (host || key);
  sources[key] = {
    id: key, type: "reporting", title, outlet: host || "web",
    retrieved: wb ? `${wb[1]}-${wb[2]}-${wb[3]}` : "",
    archive_url: wb ? url : "", original_url: original
  };
}

// ---- inline: text with [^key] markers → tokens (claim = trailing sentence)
let idSeq = 0;
const newId = () => "cl-mig-" + (++idSeq);
function splitClaim(buf) {
  const re = /[.!?…]["')\]]?\s+(?=\S)/g;
  let idx = -1, m;
  while ((m = re.exec(buf))) idx = m.index + m[0].length;
  if (idx < 0) return { head: "", claim: buf };
  return { head: buf.slice(0, idx), claim: buf.slice(idx) };
}
function inlineTokens(text) {
  const toks = [];
  let buf = "";
  const parts = text.split(/(\[\^[^\]]+\])/);
  for (const part of parts) {
    const m = part.match(/^\[\^([^\]]+)\]$/);
    if (!m) { buf += part; continue; }
    const key = m[1];
    if (!sources[key]) { continue; } // ref without a definition → drop the marker
    const prev = toks[toks.length - 1];
    if (!buf.trim() && prev && typeof prev === "object" && prev.c) {
      if (!prev.src.includes(key)) prev.src.push(key);
      continue;
    }
    const { head, claim } = splitClaim(buf);
    if (head) toks.push(head);
    if (claim.trim()) toks.push({ c: claim, src: [key], id: newId() });
    else if (claim) toks.push(claim);
    buf = "";
  }
  if (buf) toks.push(buf);
  return toks;
}

// ---- body: the legacy export emits one line per paragraph (trailing "  ")
let headline = "", dek = metaDek;
const blocks = [];
let inCode = false, codeBuf = [];
for (const rawLine of lines) {
  const l = rawLine.replace(/\s+$/, "");
  if (/^<!--/.test(l.trim())) continue;
  if (/^\[\^[^\]]+\]:/.test(l)) continue;            // footnote defs handled above
  if (l.trim() === "```") { if (inCode) { blocks.push({ type: "code", text: codeBuf.join("\n") }); codeBuf = []; } inCode = !inCode; continue; }
  if (inCode) { codeBuf.push(l); continue; }
  const t = l.trim();
  if (!t) continue;
  if (/^# /.test(t)) { if (!headline) headline = t.slice(2).trim(); else blocks.push({ type: "h2", text: t.slice(2).trim() }); continue; }
  if (/^## /.test(t)) { blocks.push({ type: "h2", text: t.slice(3).trim() }); continue; }
  if (/^### /.test(t)) { blocks.push({ type: "h3", text: t.slice(4).trim() }); continue; }
  if (/^---+$/.test(t)) { blocks.push({ type: "hr" }); continue; }
  if (/^> /.test(t)) { blocks.push({ type: "pull", text: t.replace(/^>\s?/, ""), attribution: "" }); continue; }
  const img = t.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (img) { blocks.push({ type: "img", src: img[2], caption: img[1] }); continue; }
  const emb = t.match(/^<(https?:\/\/\S+)>$/);
  if (emb) { blocks.push({ type: "embed", url: emb[1] }); continue; }
  if (!dek && flag("dek-first") && headline && blocks.length === 0) { dek = t; continue; }
  if (!dek && /^\*[^*]+\*$/.test(t)) { dek = t.slice(1, -1); continue; } // italic standfirst
  blocks.push({ type: "p", tokens: inlineTokens(t) });
}

const operand = {
  slug, headline: headline || slug, dek, column, tags,
  authors: [opt("author", "@collective_boundary730383:hyphae.social")],
  assignees: [opt("author", "@collective_boundary730383:hyphae.social")],
  published: opt("published", new Date().toISOString().slice(0, 10)),
  body: blocks, sources
};
const line = JSON.stringify({ v: SCHEMA, op: "INS", target: "article/" + slug, ts: new Date().toISOString(), actor: operand.authors[0], operand });

const outDir = join(dirname(file), "articles");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, slug + ".jsonl");
writeFileSync(out, line + "\n");
const words = blocks.filter(b => b.type === "p").map(b => b.tokens.map(t => typeof t === "string" ? t : t.c || "").join("")).join(" ").split(/\s+/).filter(Boolean).length;
console.log("wrote " + out);
console.log("  headline: " + operand.headline);
console.log("  dek:      " + (dek || "—"));
console.log("  blocks:   " + blocks.length + " · words: " + words + " · sources: " + Object.keys(sources).length);
