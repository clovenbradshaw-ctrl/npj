/* ============================================================
   Citey.jsx — the npj-mountable agent. The SPRITE + the cue API.

   The ONE drafting assistant: a bent-wire logic-operator mascot (⊥ ⊤ ⊢ ⊨ ¬) in
   the margin whose face IS the editor's mechanical grounding state. Clicking him
   opens an action popover that suggests tags (citey-assist.js — mechanical, no
   model) and offers to ground the focused claim: pin a source line, or own it
   (⊢ analysis / ⊨ account / ⊩ voice). He also reflects the publish gate — how
   many claims would still ship unverified.

   THE BOUNDS (CITEY_INTEGRATION.md §5): Citey's STATE is mechanical (CiteyBrain
   reads the live DOM grounding — a span is pinned, owned, or undeclared, full
   stop). His VOICE is leashed (CiteyVoice, templated here — npj ships no model).
   The sprite decides nothing: it renders a verdict and offers chips; the AUTHOR
   pins / owns / publishes.

   npj loads this via in-browser Babel. Requires (loaded first): citey-assist.js,
   citey-states.js, CiteyBrain.js, CiteyVoice.js. Mount: <CiteyAgent route={route} />
   ============================================================ */

const EYE_BASE = './assets/citey-eyes/';
const CITEY_MONO = "var(--mono, 'JetBrains Mono', ui-monospace, monospace)";

/* ---------- cue store: a singleton so the imperative API works pre-mount ---------- */
const CiteyStore = (function () {
  let seq = 0;
  const cues = new Map();              // token -> { state, anchor, msg, sticky }
  let tier = 'smart';
  let gate = { bound: 0, pinned: 0, owned: 0, undeclared: 0 };
  const subs = new Set();
  const PRIO = { negation: 6, nequiv: 6, falsum: 5, suspicious: 4, turnstile: 3, flagged: 5, entails: 1, verum: 1, asserted: 1, testimony: 1, voice: 1 };

  function notify() { subs.forEach(fn => { try { fn(snapshot()); } catch (e) {} }); }
  function subscribe(fn) { subs.add(fn); fn(snapshot()); return () => subs.delete(fn); }

  // The cue Citey currently shows = highest-priority live cue (sticky beats transient).
  function top() {
    let best = null;
    for (const c of cues.values()) {
      if (!best) { best = c; continue; }
      const a = (c.sticky ? 10 : 0) + (PRIO[c.state] || 0);
      const b = (best.sticky ? 10 : 0) + (PRIO[best.state] || 0);
      if (a > b) best = c;
    }
    return best;
  }
  function snapshot() { return { tier, current: top(), gate }; }

  function cue(state, opts = {}) {
    const token = 'c' + (++seq);
    cues.set(token, { token, state, anchor: opts.anchor || null, msg: opts.msg || null, sticky: !!opts.sticky });
    notify();
    if (!opts.sticky) setTimeout(() => clear(token), opts.ttl || 2600);   // transient auto-expires
    return token;
  }
  function resolve(token, state, opts = {}) {           // e.g. resolve(t, 'verum') — the flip
    const c = cues.get(token);
    if (!c) return cue(state, opts);
    c.state = state; if (opts.msg !== undefined) c.msg = opts.msg;
    if (opts.anchor !== undefined) c.anchor = opts.anchor;
    c.sticky = opts.sticky != null ? opts.sticky : c.sticky;
    notify();
    if (!c.sticky) setTimeout(() => clear(token), opts.ttl || 2600);
    return token;
  }
  function clear(token) { if (cues.delete(token)) notify(); }
  function clearAll() { cues.clear(); notify(); }
  function setTier(t) { tier = t; notify(); }
  function getTier() { return tier; }
  function setGate(g) { gate = g || gate; notify(); }
  function getGate() { return gate; }

  return { subscribe, cue, resolve, clear, clearAll, setTier, getTier, setGate, getGate, snapshot };
})();

// The last claim span the author touched (hover/focus/click) — the target the
// popover's pin / own actions operate on. Tracked here so the imperative API and
// the sprite share it.
let lastClaim = null;

/* ---------- the high-level flow: focus a claim -> brain -> voice -> bubble ---------- */
// Mechanical verdict first (the real decision), then the leashed voice phrases it.
async function evaluateSpan(span) {
  const Brain = window.CiteyBrain, Voice = window.CiteyVoice;
  const el = span && (span.nodeType === 1 ? span : span.el);
  if (el) lastClaim = el;
  if (!Brain || !Brain.ready()) { CiteyStore.cue('falsum', { anchor: el, msg: 'still reading the draft…' }); return; }

  const tier = CiteyStore.getTier();
  const verdict = Brain.citeyStateForSpan({ el, text: el ? el.textContent : (span && span.text) }, { tier });   // MECHANICAL
  const sticky = verdict.state === 'falsum' || verdict.state === 'negation' || verdict.state === 'nequiv';
  const tok = CiteyStore.cue(verdict.state, { anchor: el, sticky, msg: '' });

  const packet = Brain.packetFor({ el }, verdict);
  let msg = '';
  if (Voice && Voice.speak) {
    await Voice.speak(packet, { onToken: d => { msg += d; CiteyStore.resolve(tok, verdict.state, { anchor: el, msg, sticky }); } });
  }
  CiteyStore.resolve(tok, verdict.state, { anchor: el, msg: msg || verdict.receipt || '', sticky });
  return verdict;
}

// Recompute the publish gate off the live DOM and update Citey's baseline mood.
function refreshGate() {
  const Brain = window.CiteyBrain;
  if (!Brain) return;
  try { CiteyStore.setGate(Brain.publishGate().counts); } catch (e) {}
}

// What Citey shows when no specific claim is focused: the publish-readiness mood.
function baselineCue(gate) {
  const n = (gate && gate.undeclared) || 0;
  if (n > 0) return { state: 'suspicious', baseline: true,
    msg: n + ' claim' + (n === 1 ? '' : 's') + ' would publish unverified — pin a source, or own ' + (n === 1 ? 'it' : 'them') + '.' };
  const grounded = gate ? (gate.pinned || 0) + (gate.owned || 0) : 0;
  if (grounded > 0) return { state: 'verum', baseline: true, msg: null };
  return { state: 'voice', baseline: true, msg: null };   // neutral idle — nothing to ground yet
}

/* ---------- the React sprite + action popover ---------- */
class CiteyAgent extends React.Component {
  constructor(props) {
    super(props);
    this.state = { tier: 'smart', current: null, gate: CiteyStore.getGate(), anchorY: null, menu: false, mode: 'actions', tags: [], col: null, focusState: null };
    this._gateTimer = null;
  }

  componentDidMount() {
    this.unsub = CiteyStore.subscribe(s => {
      const cur = s.current || baselineCue(s.gate);
      const anchorY = cur && cur.anchor ? this._anchorY(cur.anchor) : null;
      this.setState({ tier: s.tier, current: cur, gate: s.gate, anchorY });
    });
    this._onEvent = (e) => { const d = e.detail || {}; CiteyStore.cue(d.status || 'falsum', { anchor: this._resolveAnchor(d.anchor), msg: d.msg, sticky: d.sticky }); };
    document.addEventListener('citey:cue', this._onEvent);
    this._onSuggest = () => this._suggest();
    document.addEventListener('citey:suggest', this._onSuggest);
    this._wireScanner();
    refreshGate();
  }
  componentWillUnmount() {
    if (this.unsub) this.unsub();
    document.removeEventListener('citey:cue', this._onEvent);
    document.removeEventListener('citey:suggest', this._onSuggest);
    if (this._mo) this._mo.disconnect();
    if (this._gateTimer) clearTimeout(this._gateTimer);
  }

  _resolveAnchor(a) {
    if (!a) return null;
    if (a.nodeType === 1) return a;
    if (typeof a === 'string') return document.querySelector(a) || document.querySelector('[data-cid="' + a + '"]');
    return null;
  }
  _anchorY(el) {
    try { const r = el.getBoundingClientRect(); return Math.min(window.innerHeight - 220, Math.max(40, r.top + r.height / 2 - 88)); }
    catch (e) { return null; }
  }

  // React to the editor's OWN claim spans (.claim-src) on hover/focus, plus any
  // declarative [data-citey] span. No per-span JS needed at the call site.
  _wireScanner() {
    const root = document.querySelector(this.props.editorSelector || '.md-preview') || document.body;
    this._root = root;
    // Coalesce: re-evaluating the SAME claim within ~600ms is wasted work (and a
    // setState storm as the mouse moves over its child nodes). A click forces it.
    const react = (el, force) => {
      const claim = el.closest && el.closest('.claim-src, [data-citey]');
      if (!claim) return;
      const now = Date.now();
      if (!force && claim === this._evalEl && now - (this._evalAt || 0) < 600) { lastClaim = claim; return; }
      this._evalEl = claim; this._evalAt = now; lastClaim = claim;
      if (window.CiteyBrain && window.CiteyBrain.ready()) {
        const v = evaluateSpan(claim);
        if (v && v.then) v.then(r => this.setState({ focusState: r ? r.state : null }));
      } else {
        CiteyStore.cue(claim.getAttribute('data-citey') || 'falsum', { anchor: claim, msg: claim.getAttribute('data-citey-msg') || null });
      }
    };
    this._over = e => { const el = e.target.closest && e.target.closest('.claim-src, [data-citey]'); if (el) react(el, false); };
    this._click = e => { const el = e.target.closest && e.target.closest('.claim-src, [data-citey]'); if (el) react(el, true); };
    root.addEventListener('mouseover', this._over, true);
    root.addEventListener('focusin', this._over, true);
    root.addEventListener('click', this._click, true);
    // Re-cost the publish gate as the draft mutates (debounced).
    this._mo = new MutationObserver(() => { clearTimeout(this._gateTimer); this._gateTimer = setTimeout(refreshGate, 350); });
    this._mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-quote', 'data-stance', 'class'] });
  }

  _toggleMenu = () => this.setState(s => ({ menu: !s.menu, mode: 'actions' }));

  // Suggest tags — mechanical entity surfacing (citey-assist.js), no model.
  _suggest = () => {
    const A = window.CiteyAssist;
    const cols = (window.__draftTags && window.__draftTags.columns && window.__draftTags.columns()) || [];
    const r = A ? A.suggestTags(A.readDraft(), cols) : { tags: [], column: null };
    this.setState({ menu: true, mode: 'tags', tags: r.tags, col: r.column });
  };
  _addTag = (t) => { if (window.__draftTags && window.__draftTags.add) window.__draftTags.add(t); };
  _pin = () => { if (lastClaim && window.__npjGround && window.__npjGround.pin) window.__npjGround.pin(lastClaim); this.setState({ menu: false }); };
  _own = (stance) => { if (lastClaim && window.__npjGround && window.__npjGround.own) window.__npjGround.own(lastClaim, stance); this.setState({ menu: false }); setTimeout(() => { if (lastClaim) evaluateSpan(lastClaim); refreshGate(); }, 0); };
  _unown = () => { if (lastClaim && window.__npjGround && window.__npjGround.unown) window.__npjGround.unown(lastClaim); this.setState({ menu: false }); setTimeout(() => { if (lastClaim) evaluateSpan(lastClaim); refreshGate(); }, 0); };
  _setTier = (t) => { CiteyStore.setTier(t); if (lastClaim) evaluateSpan(lastClaim); };

  _focusedState() {
    if (!lastClaim || !window.CiteyBrain) return null;
    try { return window.CiteyBrain.citeyStateForSpan({ el: lastClaim }, { tier: this.state.tier }).state; } catch (e) { return null; }
  }

  // The claim-grounding action panel.
  _renderActions(chip, ctx) {
    const { needsWork, isOwned, isGrounded, gate, tier } = ctx;
    const grounded = (gate.pinned || 0) + (gate.owned || 0);
    return React.createElement(React.Fragment, null,
      React.createElement('div', { key: 'h', style: { fontFamily: CITEY_MONO, fontSize: '10px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#A8A294', marginBottom: '2px' } },
        needsWork ? 'ground this claim' : isOwned ? 'owned by you' : isGrounded ? 'grounded ✓' : 'this draft'),
      needsWork ? React.createElement('button', { key: 'pin', onClick: this._pin, style: chip() }, '📌  Pin the line in the source') : null,
      needsWork ? React.createElement('div', { key: 'or', style: { fontFamily: CITEY_MONO, fontSize: '9.5px', color: '#8C867A', margin: '2px 0 0' } }, 'or own it instead —') : null,
      needsWork ? React.createElement('button', { key: 'a', onClick: () => this._own('analysis'), style: chip() }, '⊢  My analysis') : null,
      needsWork ? React.createElement('button', { key: 't', onClick: () => this._own('testimony'), style: chip() }, '⊨  I witnessed this') : null,
      needsWork ? React.createElement('button', { key: 'v', onClick: () => this._own('voice'), style: chip() }, '⊩  My stated position') : null,
      isOwned ? React.createElement('button', { key: 'un', onClick: this._unown, style: chip() }, '↩  Unmark — back to a claim') : null,
      isGrounded ? React.createElement('button', { key: 're', onClick: this._pin, style: chip() }, '✎  Re-pin the source line') : null,
      React.createElement('button', { key: 'tags', onClick: this._suggest, style: chip({ borderColor: '#4a4733' }) }, '✦  Suggest tags'),
      React.createElement('div', { key: 'tier', style: { display: 'flex', gap: '6px', marginTop: '3px' } },
        ['smart', 'smarter'].map(t => React.createElement('button', {
          key: t, onClick: () => this._setTier(t),
          style: chip({ flex: 1, textAlign: 'center', padding: '5px', background: tier === t ? '#3a3522' : '#26241f', borderColor: tier === t ? '#7C74DE' : '#3a3833', color: tier === t ? '#fff' : '#BDB7AA' })
        }, t))),
      React.createElement('div', { key: 'gate', style: { fontFamily: CITEY_MONO, fontSize: '10px', color: (gate.undeclared ? '#E08A5A' : '#5FBF93'), marginTop: '4px', lineHeight: 1.4 } },
        gate.undeclared ? ('⚑ ' + gate.undeclared + ' claim' + (gate.undeclared === 1 ? '' : 's') + ' unverified for publish')
          : grounded ? ('✓ all ' + grounded + ' claims grounded') : 'no claims bound yet')
    );
  }

  // The tag-suggestion panel (mechanical entity surfacing — no model).
  _renderTags(chip) {
    const tags = this.state.tags || [];
    return React.createElement(React.Fragment, null,
      React.createElement('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' } },
        React.createElement('button', { onClick: () => this.setState({ mode: 'actions' }), style: { background: 'none', border: 0, color: '#A8A294', cursor: 'pointer', fontFamily: CITEY_MONO, fontSize: '14px', lineHeight: 1, padding: 0 } }, '‹'),
        React.createElement('span', { style: { fontFamily: CITEY_MONO, fontSize: '10px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#A8A294' } }, 'tag ideas')),
      this.state.col ? React.createElement('div', { key: 'col', style: { fontFamily: CITEY_MONO, fontSize: '10px', color: '#9C96DE', marginBottom: '2px' } }, 'looks like the “' + this.state.col + '” column') : null,
      tags.length
        ? React.createElement('div', { key: 'chips', style: { display: 'flex', flexWrap: 'wrap', gap: '5px' } },
            tags.map(t => React.createElement('button', { key: t.tag, onClick: () => this._addTag(t.tag),
              style: chip({ width: 'auto', padding: '4px 8px', fontSize: '11px' }) }, '+ #' + t.tag)))
        : React.createElement('div', { key: 'empty', style: { fontFamily: CITEY_MONO, fontSize: '11px', color: '#8C867A', lineHeight: 1.4 } },
            'Write a few sentences first — I pull tag ideas from the people, places and orgs you name.')
    );
  }

  render() {
    const route = this.props.route;
    if (route !== 'submit' && route !== 'newsroom') return null;   // drafting surface only
    const S = window.CITEY_STATES;
    if (!S) return null;
    const cur = this.state.current || baselineCue(this.state.gate);
    const d = S.describe(cur.state);
    const tier = this.state.tier;
    const gate = this.state.gate || {};
    const fState = this.state.menu ? this._focusedState() : null;
    const isGrounded = fState === 'verum' || fState === 'entails';
    const isOwned = fState === 'asserted' || fState === 'testimony' || fState === 'voice';
    const needsWork = fState === 'falsum' || fState === 'suspicious' || fState === 'negation';

    const wrapStyle = {
      position: 'fixed', right: '26px', zIndex: 5400, width: '150px', cursor: 'pointer',
      bottom: this.state.anchorY == null ? '24px' : 'auto',
      top: this.state.anchorY == null ? 'auto' : this.state.anchorY + 'px',
      transition: 'top .5s cubic-bezier(.3,1,.4,1)'
    };
    const chip = (extra) => Object.assign({
      textAlign: 'left', width: '100%', border: '1px solid #3a3833', background: '#26241f', color: '#EDE7DA',
      padding: '7px 9px', cursor: 'pointer', fontFamily: CITEY_MONO, fontSize: '11.5px', lineHeight: 1.35, borderRadius: '8px'
    }, extra || {});

    return (
      React.createElement('div', { style: wrapStyle },
        // ---- action popover ----
        this.state.menu ? React.createElement('div', {
          onClick: e => e.stopPropagation(),
          style: { position: 'absolute', bottom: 'calc(100% + 12px)', right: '0', width: '252px', background: '#1B1A1E', color: '#F2EEE4',
            borderRadius: '14px', padding: '12px', boxShadow: '0 20px 44px -16px rgba(20,16,8,.6)', display: 'flex', flexDirection: 'column', gap: '7px' }
        },
          this.state.mode === 'tags'
            ? this._renderTags(chip)
            : this._renderActions(chip, { needsWork, isOwned, isGrounded, gate, tier })
        ) : null,

        // ---- speech bubble (when a claim is focused and Citey has something to say) ----
        (cur && cur.msg && !this.state.menu) ? React.createElement('div', {
          style: { position: 'absolute', bottom: 'calc(100% + 14px)', right: '4px', width: '240px', background: '#1B1A1E', color: '#F2EEE4', borderRadius: '16px', padding: '14px 16px', boxShadow: '0 18px 40px -16px rgba(20,16,8,.55)' }
        },
          React.createElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
            React.createElement('div', { style: { fontFamily: CITEY_MONO, fontWeight: 800, fontSize: '28px', lineHeight: .9, color: d.color, textShadow: '0 0 18px ' + d.color + '55' } }, d.glyph),
            React.createElement('div', { style: { fontFamily: CITEY_MONO, fontSize: '12.5px', lineHeight: 1.5, color: '#E7E2D6' } }, cur.msg)
          )
        ) : null,

        // ---- body + eyes (click to open the action menu) ----
        React.createElement('div', { onClick: this._toggleMenu, title: 'Citey — ground every claim before you publish', style: { position: 'relative', width: '150px', height: '176px', margin: '0 auto' } },
          React.createElement('svg', { viewBox: '0 0 150 180', width: 150, height: 180, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } },
            React.createElement('g', { fill: 'none', stroke: d.color, strokeWidth: 13, strokeLinecap: 'round', strokeLinejoin: 'round' },
              React.createElement('path', { d: d.bodyPath })
            )
          ),
          React.createElement('div', { style: { position: 'absolute', top: '13px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '6px', zIndex: 3 } },
            React.createElement('img', { src: EYE_BASE + d.eyes[0] + '.png', draggable: false, style: { width: '50px', height: 'auto', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.18))' } }),
            React.createElement('img', { src: EYE_BASE + d.eyes[1] + '.png', draggable: false, style: { width: '50px', height: 'auto', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.18))' } })
          ),
          // a small badge when claims still need grounding
          (gate.undeclared && !this.state.menu) ? React.createElement('div', {
            style: { position: 'absolute', top: '-2px', right: '14px', minWidth: '20px', height: '20px', padding: '0 5px', borderRadius: '10px', background: '#D8412C', color: '#fff', fontFamily: CITEY_MONO, fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(0,0,0,.3)' }
          }, gate.undeclared) : null
        ),
        // tier badge
        React.createElement('div', { style: { textAlign: 'center', marginTop: '6px', fontFamily: CITEY_MONO, fontSize: '9.5px', letterSpacing: '1.3px', textTransform: 'uppercase', color: '#A8A294' } },
          tier === 'smarter' ? 'smarter · graph walk' : 'smart · reflex')
      )
    );
  }
}

/* ---------- publish the imperative API (window.__citey) ---------- */
window.__citey = {
  cue: CiteyStore.cue, resolve: CiteyStore.resolve, clear: CiteyStore.clear, clearAll: CiteyStore.clearAll,
  setTier: CiteyStore.setTier, getTier: CiteyStore.getTier,
  evaluateSpan, refreshGate,
  focused: () => lastClaim,
  // Own a claim instead of sourcing it — ⊢ analysis / ⊨ testimony / ⊩ voice.
  assert: (span, stance) => {
    const r = window.CiteyBrain ? window.CiteyBrain.assert(span, stance) : { state: 'asserted' };
    return CiteyStore.cue(r.state, { anchor: (span && span.nodeType === 1) ? span : (span && span.el) || null });
  },
  // Publish gate: flag every claim still neither sourced nor owned (⚑).
  flag: (spans) => { refreshGate(); return (spans || []).map(s => CiteyStore.cue('flagged', { anchor: (s && s.el) || s, sticky: true, msg: 'this would publish unverified — pin a source, or mark it yours.' })); },
  // Tag suggestion — mechanical (citey-assist.js); the mounted sprite renders the chips.
  suggest: () => document.dispatchEvent(new CustomEvent('citey:suggest')),
  hide: () => CiteyStore.clearAll()
};

if (typeof module !== 'undefined' && module.exports) module.exports = { CiteyAgent, CiteyStore, evaluateSpan };
window.CiteyAgent = CiteyAgent;
