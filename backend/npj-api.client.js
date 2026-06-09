/*
 * npj-api.client.js
 * Front-end client for People's Journalism.
 *
 * Identity is email-code (passwordless): signup creates an account, requestCode
 * emails a one-time code, verifyCode checks it and returns a session token.
 * The token is then sent as `Authorization: Bearer <token>` on every data call.
 *
 * Auth endpoint:  POST {baseUrl}/webhook/npj-auth   (signup/request_code/verify_code)
 * Data endpoint:  POST {baseUrl}/webhook/npj-api    (read/propose/resolve/delete)
 *
 * Usage:
 *   import { configureNpj, auth, npj, NpjError } from "./npj-api.client.js";
 *   configureNpj({ baseUrl: "https://YOUR-N8N" });
 *   await auth.signup(email, displayName);   // creates the account
 *   await auth.requestCode(email);           // emails a code
 *   const me = await auth.verifyCode(email, code);  // -> { email, role }; token stored
 *   const rows = await npj.read({ article: "ndp-first-budget" });
 *   await npj.propose({ article, base_sha, quote, proposed, rationale });
 *   if (auth.isEditor()) await npj.resolve(event_id, "accept");
 *   auth.logout();
 */

const CFG = { baseUrl: "" };
const SESSION = { token: null, email: null, role: null };
const listeners = new Set();

export function configureNpj(opts = {}) {
  if (opts.baseUrl != null) CFG.baseUrl = opts.baseUrl.replace(/\/+$/, "");
}

export class NpjError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "NpjError";
    this.status = status;
    this.body = body;
  }
}

/** Subscribe to login/logout changes. Returns an unsubscribe fn. */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emitAuth() {
  const snap = { email: SESSION.email, role: SESSION.role, signedIn: !!SESSION.token };
  listeners.forEach((fn) => { try { fn(snap); } catch {} });
}

async function post(path, payload, withAuth) {
  if (!CFG.baseUrl) throw new NpjError("npj client not configured: baseUrl", 0);
  const headers = { "Content-Type": "application/json" };
  if (withAuth && SESSION.token) headers["Authorization"] = "Bearer " + SESSION.token;

  let res;
  try {
    res = await fetch(CFG.baseUrl + path, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new NpjError("network error: " + e.message, 0);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }

  if (res.status === 401) {
    if (withAuth) { SESSION.token = SESSION.email = SESSION.role = null; emitAuth(); }
    throw new NpjError("unauthorized", 401, body);
  }
  if (res.status === 403) throw new NpjError("forbidden - editor access required", 403, body);
  if (!res.ok) throw new NpjError("request failed (" + res.status + ")", res.status, body);
  return body;
}

const norm = (e) => (e || "").toLowerCase().trim();

export const auth = {
  /** Create an account. Login is still via emailed code afterward. */
  signup: (email, display_name = "") =>
    post("/webhook/npj-auth", { op: "signup", email: norm(email), display_name }),

  /** Email a one-time code. Always resolves the same way (no account enumeration). */
  requestCode: (email) =>
    post("/webhook/npj-auth", { op: "request_code", email: norm(email) }),

  /** Verify the code; on success the session token is stored for subsequent calls. */
  async verifyCode(email, code) {
    const r = await post("/webhook/npj-auth", { op: "verify_code", email: norm(email), code: String(code).trim() });
    SESSION.token = r.token;
    SESSION.email = r.email;
    SESSION.role = r.role;
    emitAuth();
    return { email: SESSION.email, role: SESSION.role };
  },

  logout() { SESSION.token = SESSION.email = SESSION.role = null; emitAuth(); },
  isSignedIn: () => !!SESSION.token,
  isEditor: () => SESSION.role === "editor",
  me: () => ({ email: SESSION.email, role: SESSION.role }),

  /** Rehydrate a session (e.g. from sessionStorage you manage yourself). */
  setSession(token, email, role) { SESSION.token = token; SESSION.email = email; SESSION.role = role; emitAuth(); },
};

export const npj = {
  read: (q = {}) => post("/webhook/npj-api", { op: "read", ...q }, true),
  propose: (s) => post("/webhook/npj-api", { op: "propose", ...s }, true),
  resolve: (event_id, outcome) => post("/webhook/npj-api", { op: "resolve", event_id, outcome }, true),
  remove: (event_id) => post("/webhook/npj-api", { op: "delete", event_id }, true),
};

export default { configureNpj, auth, npj, NpjError, onAuthChange };
