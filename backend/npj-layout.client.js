/* npj-layout.client.js — read & publish the site layout config.
 *
 * Layout (section nav, taglines, utility links, brand, member allowlist) is
 * curated by the verified admin and committed to GitHub as plaintext JSON, using
 * the SAME live publish workflow as everything else:
 *
 *   POST https://n8n.intelechia.com/webhook/site/publish-npj
 *   Authorization: Bearer <Matrix access token for @collective_boundary730383:hyphae.social>
 *   Body: { filename, mode:'overwrite', contentRaw, message }
 *
 * The workflow re-verifies that token with whoami on hyphae.social and only
 * commits if user_id === the admin mxid — so authorization is enforced
 * server-side, not just in the UI. It writes to clovenbradshaw-ctrl/npj (main);
 * the committed file is then world-readable at the raw URL below.
 */

const PUBLISH_ENDPOINT = "https://n8n.intelechia.com/webhook/site/publish-npj";
const RAW_BASE = "https://raw.githubusercontent.com/clovenbradshaw-ctrl/npj/main";
const LAYOUT_FILE = "site/layout.json";

/* matrixToken = the signed-in admin's access token (window.MatrixAuth.token()).
 * The webhook authorizes on it; no separate publish secret exists. */
export async function publishLayout({ endpoint = PUBLISH_ENDPOINT, matrixToken, layout, author = "@admin", message }) {
  if (!matrixToken) throw new Error("publishLayout: a Matrix access token is required (sign in as admin)");
  const contentRaw = JSON.stringify({ schema: "npj-layout/1", updated: new Date().toISOString(), author, layout }, null, 2) + "\n";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + matrixToken },
    body: JSON.stringify({ filename: LAYOUT_FILE, mode: "overwrite", contentRaw, message: message || "update site layout" })
  });
  if (res.status === 401) throw new Error("unauthorized — that Matrix token isn't the site admin");
  if (!res.ok) throw new Error("layout publish failed (" + res.status + ")");
  try { return await res.json(); } catch (e) { return { ok: true }; }
}

/* Fetch the committed layout for a read-only overlay at boot, so every visitor
 * sees the admin's curation. Returns null if nothing is committed yet. */
export async function loadCommittedLayout(rawBase = RAW_BASE) {
  try {
    const res = await fetch(rawBase.replace(/\/+$/, "") + "/" + LAYOUT_FILE, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.layout ? j.layout : j;
  } catch (e) { return null; }
}

export default { publishLayout, loadCommittedLayout, PUBLISH_ENDPOINT, RAW_BASE, LAYOUT_FILE };

if (typeof window !== "undefined") {
  window.NpjLayout = { publishLayout, loadCommittedLayout, PUBLISH_ENDPOINT, RAW_BASE, LAYOUT_FILE };
}
