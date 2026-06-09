/* eo-event.client.js — optional, tiny.
 * Your n8n workflow is unchanged; it commits whatever `contentRaw` it gets.
 * This just formats content as a plaintext EO-notation line and POSTs it.
 *   op: append → EVA (⊨), new → DEF (⊢), republish → REC (⊛).
 */
const GLYPH = { DEF: "⊢", EVA: "⊨", REC: "⊛" };

export function eoLine({ content, filename, mode = "overwrite", author = "@unknown", op }) {
  const code = op || (mode === "append" ? "EVA" : "DEF");
  const base = filename.replace(/\.[^.]+$/, "");
  return JSON.stringify({
    op: code, glyph: GLYPH[code], target: base, target_path: filename,
    operand: content, author, ts: new Date().toISOString()
  }) + "\n";
}

export async function publish({ endpoint, token, filename, content, mode = "overwrite", author, op, message }) {
  const contentRaw = eoLine({ content, filename, mode, author, op });
  const res = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, filename, mode, contentRaw, message: message || `update ${filename}` })
  });
  return res.json();
}
