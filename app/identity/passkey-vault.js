/* passkey-vault.js — unlock your account with Face ID / a fingerprint.
 *
 * A guest account is a real account, and its only credential is the password the
 * owner sets. Remembering it is fine — but on a device that can, we let them lock
 * that password behind a platform passkey instead, so getting back in is one touch.
 *
 * The mechanism is the WebAuthn PRF extension (CTAP2 hmac-secret): a plain passkey
 * can only *sign*, and its signatures aren't stable, so they can't key a cipher.
 * PRF is the exception — it derives a stable, high-entropy secret from the
 * authenticator, gated behind the user's biometric/PIN, deterministic for a given
 * (credential, salt). We use it to derive an AES-GCM key and encrypt {mxid,
 * password} into localStorage. No backend, nothing leaves the device, and the
 * ciphertext is inert without the passkey that made it.
 *
 *   supported() → is there a platform authenticator we can even try?
 *   enroll({mxid,password}) → make a passkey, derive a key, store the vault
 *   unlock(mxid?) → prompt the passkey, decrypt, hand back {mxid,password}
 *
 * PRF is device/ecosystem-bound by design: a vault made here only opens on this
 * device (or wherever the platform syncs the passkey). That's the security win and
 * the limit — there is no recovery here, only convenience. The password is still
 * the real key, which is why we never make it the *only* way in.
 */
(function () {
  const LS_KEY = "npj_passkey_vault_v1";                 // { [mxid]: vaultRecord }
  const RP_NAME = "People's Journalism";
  const SALT = new TextEncoder().encode("npj.passkey.vault.v1"); // fixed PRF + HKDF salt
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // base64url <-> ArrayBuffer (WebAuthn deals in ArrayBuffers; localStorage in text)
  function abToB64u(buf) {
    const b = new Uint8Array(buf); let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64uToAb(str) {
    const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function readStore() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function writeStore(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} }
  function rpId() { return location.hostname; }

  // We can't know a device supports PRF without trying, but we can cheaply rule out
  // contexts with no usable authenticator at all (no WebAuthn, insecure origin, or
  // no platform authenticator) — so the UI only offers passkeys where they can work.
  async function supported() {
    if (!window.PublicKeyCredential || !(navigator.credentials && navigator.credentials.create)) return false;
    if (!window.isSecureContext && location.hostname !== "localhost") return false;
    try {
      if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      }
    } catch (e) {}
    return true;
  }

  function has(mxid) { const s = readStore(); return mxid ? !!s[mxid] : Object.keys(s).length > 0; }
  function list() { return Object.values(readStore()).map(v => ({ mxid: v.mxid, label: v.label || v.mxid, ts: v.ts })); }
  function forget(mxid) { const s = readStore(); delete s[mxid]; writeStore(s); }

  // PRF output → AES-GCM key, with a domain-separating HKDF step so the raw
  // authenticator secret is never used directly as the cipher key.
  async function deriveKey(prfOutput) {
    const base = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("npj-vault-aesgcm") },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }

  // Ask the authenticator to evaluate the PRF for our salt (one biometric prompt).
  async function evalPrf(credentialId) {
    const pub = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: rpId(), userVerification: "required", timeout: 60000,
      extensions: { prf: { eval: { first: SALT } } }
    };
    if (credentialId) pub.allowCredentials = [{ id: b64uToAb(credentialId), type: "public-key" }];
    const assertion = await navigator.credentials.get({ publicKey: pub });
    const ext = assertion.getClientExtensionResults();
    const prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
    if (!prf) { const e = new Error("This device's passkey can't encrypt sign-in (no PRF support)."); e.code = "noprf"; throw e; }
    return { prf, credentialId: abToB64u(assertion.rawId) };
  }

  async function enroll({ mxid, password, label } = {}) {
    if (!mxid || !password) { const e = new Error("Need an account to protect."); e.code = "badinput"; throw e; }
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId(), name: RP_NAME },
        user: { id: enc.encode(mxid), name: mxid, displayName: label || mxid },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 60000,
        extensions: { prf: { eval: { first: SALT } } }
      }
    });
    const credentialId = abToB64u(cred.rawId);
    const cx = cred.getClientExtensionResults();
    if (cx && cx.prf && cx.prf.enabled === false) { const e = new Error("Your device's passkey doesn't support encrypting sign-in."); e.code = "noprf"; throw e; }
    // Some platforms hand back the PRF output right here; most need a second get().
    let prf = cx && cx.prf && cx.prf.results && cx.prf.results.first;
    if (!prf) prf = (await evalPrf(credentialId)).prf;

    const key = await deriveKey(prf);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify({ mxid, password })));
    const store = readStore();
    store[mxid] = { v: 1, mxid, label: label || mxid, credentialId, iv: abToB64u(iv), ct: abToB64u(ct), ts: new Date().toISOString() };
    writeStore(store);
    return { mxid, credentialId };
  }

  async function unlock(mxid) {
    const store = readStore();
    const rec = mxid ? store[mxid] : Object.values(store)[0];
    if (!rec) { const e = new Error("No passkey is set up on this device."); e.code = "novault"; throw e; }
    const { prf } = await evalPrf(rec.credentialId);
    const key = await deriveKey(prf);
    let ptBuf;
    try { ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64uToAb(rec.iv) }, key, b64uToAb(rec.ct)); }
    catch (e) { const err = new Error("That passkey didn't match this account's vault."); err.code = "baddecrypt"; throw err; }
    const data = JSON.parse(dec.decode(ptBuf));
    return { mxid: data.mxid, password: data.password };
  }

  window.PasskeyVault = { supported, has, list, forget, enroll, unlock };
})();
