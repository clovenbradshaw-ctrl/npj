/* ============================================================
   CiteyVoice.js — the VOICE layer. On a leash. Downstream of every decision.

   Turns a (verdict + its passages) packet into one or two sentences in Citey's
   speech bubble. It reuses eoreader3's OWN grounded prompt (EOLLM.phrase), so
   the bounds are byte-identical to Cleon's:
     • answers ONLY from the supplied passages
     • the exact refusal "The passages don't say." survives unedited
     • writes NO citation markers (bound mechanically afterward)
     • temperature 0.12 grounded, capped max_tokens

   The model NEVER decides a state, pins a quote, binds a source, or acts. It
   receives a packet and returns prose. See CITEY_INTEGRATION.md §4 and §5.

   Load AFTER vendor/eoreader3/llm.js. Publishes window.CiteyVoice.

   Availability ladder (first present wins):
     1. Ollama at localhost:11434  (native, no WebGPU — CiteyOllama.js)
     2. EOLLM / WebLLM             (in-browser, needs WebGPU)
     3. templated()                (no model at all — Citey still fully works)
   ============================================================ */
(function (root) {
  'use strict';

  // Model per tier — phrasing only at both. Small for reflex, larger for the
  // graph walk. Swap these mlcKeys for whatever WebLLM builds you ship.
  const MODEL = {
    smart:   'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    smarter: 'Qwen2.5-7B-Instruct-q4f16_1-MLC'
  };
  const BUDGET = { smart: 2000, smarter: 6000 };

  // Templated fallback — Citey is fully expressive with NO model loaded. These
  // are the same canned lines the standalone sprite uses, keyed by state.
  const TEMPLATED = {
    falsum:    'this one\u2019s floating. pin the line that backs it, or own it.',
    suspicious:'that claim has no source. it could be anything.',
    turnstile: 'does a source actually support this? tracing it back\u2026',
    verum:     'grounded. a pinned line backs it \u2014 \u22A5 flips to \u22A4.',
    entails:   'stronger: a primary, archived record settles it.',
    negation:  'two sources point opposite ways. someone is wrong.',
    nequiv:    'two definitions of this term don\u2019t match.',
    asserted:  'owned as your analysis \u2014 it follows from the grounded premises.',
    testimony: 'owned as your account \u2014 you\u2019re the witness on the record.',
    voice:     'owned as your position \u2014 rendered to readers as argument, not fact.',
    context:   'continuing coverage \u2014 the article proves it, set against prior reporting.',
    flagged:   'this would publish unverified \u2014 pin a source, or mark it yours.'
  };
  function templated(verdict) { return TEMPLATED[verdict.status] || TEMPLATED.falsum; }

  // Decide which backend to use, once. Override with setBackend('ollama'|'webllm'|'templated').
  let forced = null;
  function setBackend(name) { forced = name; }
  async function backend() {
    if (forced) return forced;
    if (root.CiteyOllama && await root.CiteyOllama.available()) return 'ollama';
    if (root.EOLLM && root.EOLLM.hasWebGPU && root.EOLLM.hasWebGPU()) return 'webllm';
    return 'templated';
  }

  // Speak. `packet` is CiteyBrain.packetFor(...) output. `onToken` streams into
  // the bubble. `history` is Citey's short, capped chat (NOT the document).
  // Returns the final string (also runs through the mechanical post-check).
  async function speak(packet, { onToken, history } = {}) {
    const tier = packet.tier || 'smart';
    const contextText = (packet.passages || [])
      .map(p => `[${p.tag}] ${p.text}`).join('\n');

    const which = await backend();

    // No model, or no passages to phrase from → templated. Honest and instant.
    if (which === 'templated' || !contextText) {
      const t = templated(packet.verdict);
      if (onToken) onToken(t);
      return t;
    }

    const args = {
      question: packet.question,
      contextText,                 // ONLY engine-retrieved passages
      history: (history || []).slice(-6),  // short, capped — never the whole doc
      grounded: true,              // forces the strict "only the passages" prompt
      depth: tier === 'smarter' ? 3 : 1,
      budget: BUDGET[tier],
      onToken
    };

    let said;
    if (which === 'ollama') {
      said = await root.CiteyOllama.phrase(args);
    } else {
      // WebLLM via eoreader3's own phrase() — inherits every bound + the audit hook.
      said = await root.EOLLM.phrase(Object.assign({ mlcKey: MODEL[tier], mode: 'chat', task: null }, args));
    }

    // Mechanical post-check: strip any stray [sN] the model emitted (citations are
    // bound by the engine, never written here). Keep the refusal verbatim.
    return postCheck(said, packet);
  }

  // The model is never the thing that decides whether its own phrasing is allowed.
  function postCheck(text, packet) {
    let t = String(text || '').trim();
    t = t.replace(/\[s\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();   // engine owns citations
    if (!t) return templated(packet.verdict);
    return t;
  }

  root.CiteyVoice = { speak, templated, setBackend, MODEL, BUDGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CiteyVoice;
})(typeof window !== 'undefined' ? window : this);
