/* identity.js — public bylines as an append-only EO event log.
 *
 * A Matrix ID (@collective_boundary730383:hyphae.social) is verified identity,
 * but it's a poor public byline. This is the registry that binds a verified mxid
 * to a chosen, public-facing username — and it is itself a record: one
 * append-only JSONL log committed to GitHub at site/usernames.jsonl, exactly like
 * an article log. Line 1 a person claims a name is an INS (mint an enduring
 * anchor); every rename after is one more REC line (restructure the frame)
 * appended to the SAME file. Nothing is ever rewritten, so the file is the
 * complete, auditable history of who published under which name and when.
 *
 *   {"v":"npj/username-eo/1","op":"INS","target":"username/@mx:hs","ts","actor",
 *    "operand":{"mxid":"@mx:hs","username":"Public Name"}}
 *   {"v":"npj/username-eo/1","op":"REC","target":"username/@mx:hs","ts","actor",
 *    "note":"why","operand":{"mxid":"@mx:hs","username":"New Name"}}
 *
 * Reading folds the log: the latest event per mxid is the live name; the prior
 * events stay in `history` so the audit trail (who set it, when) survives. The
 * folded names are written into window.NPJ.PEOPLE so every <Handle> byline and
 * collaborator avatar resolves to the public name instead of the bare mxid.
 *
 * Authorization is the SAME as the layout config: the n8n publish webhook
 * re-verifies the caller's Matrix token with whoami and only commits a non-article
 * file for the founding admin — so the public byline registry is admin-curated,
 * and the act of curating it is part of the permanent record.
 *
 * Exposed as window.NpjIdentity. No deps beyond fetch (+ window.MatrixAuth for
 * mxid parsing, when present). */
(function () {
  'use strict';

  const SCHEMA = "npj/username-eo/1";
  const OWNER_REPO = "clovenbradshaw-ctrl/npj";
  const RAW_BASE = "https://raw.githubusercontent.com/" + OWNER_REPO + "/main";
  const FILE = "site/usernames.jsonl";
  const RAW_URL = RAW_BASE + "/" + FILE;
  const CACHE_KEY = "npj_usernames_v1";
  const DEFAULT_ENDPOINT = "https://n8n.intelechia.com/webhook/site/publish-npj";

  const nowIso = () => new Date().toISOString();

  function publishEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.endpoint) return c.endpoint; } catch (e) {}
    return DEFAULT_ENDPOINT;
  }

  // Loose mxid parse — works without MatrixAuth loaded (boot order safety).
  function parseMxid(input) {
    if (window.MatrixAuth && window.MatrixAuth.parseMxid) return window.MatrixAuth.parseMxid(input);
    const m = String(input || "").trim().match(/^@?([a-z0-9._=\-/+]+):([a-z0-9.\-]+\.[a-z]{2,})$/i);
    return m ? { localpart: m[1], domain: m[2], mxid: "@" + m[1] + ":" + m[2] } : null;
  }

  // A stable, content-free avatar color derived from the mxid (djb2 → hue), so a
  // person keeps the same dot across sessions without storing a color.
  function colorFor(mxid) {
    let h = 5381;
    const s = String(mxid || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 52%, 42%)";
  }

  // Sanitize a chosen public name: trim, collapse whitespace, drop control
  // chars, cap length. Empty after cleaning is rejected by the caller.
  function cleanName(s) {
    return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  /* ---------------- event lines ---------------- */
  function eventLine(op, mxid, username, actor, extra) {
    return JSON.stringify(Object.assign({
      v: SCHEMA, op, target: "username/" + mxid, ts: nowIso(), actor: actor || null,
      operand: { mxid, username }
    }, extra || {}));
  }

  /* ---------------- fold: JSONL text → { identities, events } ----------------
     identities[mxid] = { mxid, username, ts, actor, history:[{username,ts,actor}] }
     Latest event per mxid wins; earlier events are retained in history for audit. */
  function foldLog(text) {
    const events = [];
    String(text || "").split(/\r?\n/).forEach(line => {
      const l = line.trim();
      if (!l) return;
      try { const ev = JSON.parse(l); if (ev && ev.op && ev.operand) events.push(ev); } catch (e) { /* a torn line never breaks the fold */ }
    });
    const identities = {};
    events.forEach(ev => {
      const o = ev.operand || {};
      const mxid = o.mxid || (ev.target || "").replace(/^username\//, "");
      const username = cleanName(o.username);
      if (!mxid || !username) return;
      const entry = identities[mxid] || (identities[mxid] = { mxid, username: "", ts: "", actor: "", history: [] });
      entry.history.push({ username, ts: ev.ts || "", actor: ev.actor || "" });
      entry.username = username; entry.ts = ev.ts || ""; entry.actor = ev.actor || "";
    });
    return { identities, events };
  }

  /* ---------------- write folded names into the People (byline) graph ---------------- */
  function applyToPeople(identities) {
    if (!window.NPJ) return;
    const people = window.NPJ.PEOPLE || (window.NPJ.PEOPLE = {});
    Object.keys(identities || {}).forEach(mxid => {
      const id = identities[mxid];
      const prev = people[mxid] || {};
      people[mxid] = Object.assign({ trust: "open" }, prev, {
        name: id.username,
        color: prev.color || colorFor(mxid),
        source: "registry"
      });
    });
  }

  /* ---------------- load the committed registry ---------------- */
  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; } }
  function saveCache(identities) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(identities || {})); } catch (e) {} }

  async function fetchRegistryText() {
    try {
      const res = await fetch(RAW_URL + "?cb=" + Date.now(), { cache: "no-store" });
      if (res.status === 404) return null; // nothing claimed yet — the file doesn't exist
      if (!res.ok) throw new Error("github " + res.status);
      return await res.text();
    } catch (e) { return undefined; } // undefined = network/listing down (≠ "no file")
  }

  // Populate PEOPLE from the committed registry. Paints from cache instantly,
  // then refreshes from GitHub. Returns the folded identities.
  async function loadRegistry() {
    const cached = loadCache();
    if (cached) applyToPeople(cached);
    const text = await fetchRegistryText();
    if (text === undefined) return cached || {}; // offline → keep cache
    const { identities } = foldLog(text || "");
    applyToPeople(identities);
    saveCache(identities);
    return identities;
  }

  function usernameFor(mxid) {
    const p = window.NPJ && window.NPJ.PEOPLE && window.NPJ.PEOPLE[mxid];
    return (p && p.name) || mxid;
  }

  /* ---------------- commit a name (admin, through the same webhook) ----------------
     First line ever → mode:'overwrite' seeds the file; afterwards every claim or
     rename is mode:'append' (one line, never a rewrite). op is INS the first time
     a given mxid appears, REC for a rename — matching the article log's grammar. */
  async function post(bodyObj, token, endpoint) {
    const res = await fetch(endpoint || publishEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(bodyObj)
    });
    return res;
  }

  async function setUsername({ mxid, username, actor, token, note, endpoint }) {
    if (!token) { const e = new Error("Sign in as the admin first"); e.code = "noauth"; throw e; }
    const id = parseMxid(mxid);
    if (!id) { const e = new Error("That isn't a valid Matrix ID (@name:server)"); e.code = "badmxid"; throw e; }
    const name = cleanName(username);
    if (!name) { const e = new Error("A public name is required"); e.code = "empty"; throw e; }

    const text = await fetchRegistryText(); // null = no file yet, undefined = unreachable
    if (text === undefined) { const e = new Error("Couldn't reach GitHub to read the current registry"); e.code = "network"; throw e; }
    const { identities } = foldLog(text || "");
    if (identities[id.mxid] && identities[id.mxid].username === name) {
      return { unchanged: true, identities }; // nothing to commit
    }
    const op = identities[id.mxid] ? "REC" : "INS";
    const line = eventLine(op, id.mxid, name, actor || null, note ? { note } : {});
    const mode = text == null ? "overwrite" : "append";
    const message = (op === "INS" ? "claim byline: " : "rename byline: ") + id.mxid + " → " + name;
    const res = await post({ filename: FILE, mode, contentRaw: line + "\n", message }, token, endpoint);
    if (res.status === 401 || res.status === 403) { const e = new Error("Rejected (" + res.status + ") — only the founding admin can write the byline registry"); e.code = "forbidden"; throw e; }
    if (!res.ok) { const e = new Error("Commit failed (" + res.status + ")"); e.code = "commit"; throw e; }
    let body = null; try { body = await res.json(); } catch (e) {}

    // reflect locally so bylines update without a reload
    const next = foldLog((text || "") + line + "\n").identities;
    applyToPeople(next); saveCache(next);
    return { op, line, mxid: id.mxid, username: name, identities: next, commit: body };
  }

  window.NpjIdentity = {
    SCHEMA, FILE, RAW_URL, colorFor, cleanName, parseMxid,
    foldLog, applyToPeople, loadRegistry, fetchRegistryText, usernameFor, setUsername
  };
})();
