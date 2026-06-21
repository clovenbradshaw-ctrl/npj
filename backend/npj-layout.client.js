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

/* A 502/503/504 (or 408/429, or a thrown fetch) with NO JSON body is the reverse
 * proxy in front of n8n reporting a momentary upstream hiccup — a restart, a cold
 * start, a timeout — not a rejection of the request. Those are worth a short
 * retry. But the workflow itself also answers failures with a JSON contract
 * (`{ ok:false, error, gh_status }`) and can return a 502 that way when GitHub
 * rejected the commit — that's a real verdict, so a body-carrying response is
 * judged on its body (below), not on its status alone. A 401 fails fast too. */
const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504]);
const RETRY_BACKOFF_MS = [600, 1500, 3000]; // one wait per retry after the first attempt
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* matrixToken = the signed-in admin's access token (window.MatrixAuth.token()).
 * The webhook authorizes on it; no separate publish secret exists.
 *
 * On a transient gateway/network failure the POST is retried with the backoff
 * above. This is safe because the layout commit is idempotent: it always
 * overwrites the SAME site/layout.json with `body` computed once up front, so a
 * retry can only ever re-write byte-identical content, never duplicate anything.
 * `onRetry({ attempt, delay, error })` fires before each wait so the UI can say
 * it's retrying instead of showing a frozen spinner. */
export async function publishLayout({ endpoint = PUBLISH_ENDPOINT, matrixToken, layout, author = "@admin", message, retries = RETRY_BACKOFF_MS.length, onRetry } = {}) {
  if (!matrixToken) throw new Error("publishLayout: a Matrix access token is required (sign in as admin)");
  const contentRaw = JSON.stringify({ schema: "npj-layout/1", updated: new Date().toISOString(), author, layout }, null, 2) + "\n";
  // Built once so every retry re-POSTs identical bytes (the idempotent overwrite).
  const body = JSON.stringify({ filename: LAYOUT_FILE, mode: "overwrite", contentRaw, message: message || "update site layout" });

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
      if (typeof onRetry === "function") { try { onRetry({ attempt, delay, error: lastErr }); } catch (_) {} }
      await sleep(delay);
    }
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + matrixToken },
        body
      });
    } catch (e) {
      // fetch threw: the request never got an HTTP answer (offline, DNS, dropped
      // connection). Transient by nature — fall through and retry.
      lastErr = Object.assign(new Error("layout publish failed (network error)"), { transient: true });
      continue;
    }
    if (res.status === 401) throw new Error("unauthorized — that Matrix token isn't the site admin");

    // Read the body once. The publish workflow answers with a JSON contract even
    // on failure — the `OK2` response node returns `{ ok, error, gh_status, … }`
    // with the *computed* HTTP status — so the BODY, not the status alone, is how
    // we tell a real verdict from a transient gateway blip. A genuine reverse-proxy
    // 502 (n8n down/restarting) carries no JSON, so this parse simply fails there.
    let data = null;
    try { data = await res.json(); } catch (e) { /* HTML/empty body → no contract */ }

    if (res.ok && !(data && data.ok === false)) return data || { ok: true };

    // A structured failure FROM THE WORKFLOW is a real verdict, not a transient
    // gateway hiccup — even when it rides a 502. The README's "github commit
    // failed" case returns `{ ok:false, error, gh_status }` with a 502 when the
    // GitHub status couldn't be read (usually an expired GitHub credential on
    // n8n — re-bind it). Retrying that just repeats the failure and buries the
    // real reason behind "couldn't reach the site". Only a 409/422 SHA race is
    // worth a re-POST (it re-fetches the blob SHA).
    if (data && (data.ok === false || data.error || data.gh_status)) {
      const ghStatus = data.gh_status || null;
      const err = Object.assign(
        new Error("layout publish was rejected" + (data.error ? " — " + data.error : "") + (ghStatus ? " (GitHub " + ghStatus + ")" : "")),
        { status: res.status, gh_status: ghStatus, error: data.error || null }
      );
      if ((ghStatus === 409 || ghStatus === 422) && attempt < retries) { lastErr = err; continue; }
      throw err;
    }

    // No JSON contract in the body → a genuine gateway/proxy failure. THESE are
    // the transient ones worth a short retry.
    if (TRANSIENT_STATUS.has(res.status)) {
      lastErr = Object.assign(new Error("the publishing service is temporarily unavailable (" + res.status + ")"), { status: res.status, transient: true });
      continue;
    }
    // A deterministic rejection with no contract (e.g. a bare 500/4xx): retrying won't help.
    throw Object.assign(new Error("layout publish failed (" + res.status + ")"), { status: res.status });
  }
  // Every attempt hit a transient failure. The caller's content is already saved
  // durably; this only means the public push didn't land — surface the last one.
  throw lastErr || new Error("layout publish failed");
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
