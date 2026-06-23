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
const CITEY_HIDE_KEY = 'npj_citey_hidden_v1';
const CiteyStore = (function () {
  let seq = 0;
  const cues = new Map();              // token -> { state, anchor, msg, sticky }
  let tier = 'smart';
  let gate = { bound: 0, pinned: 0, owned: 0, undeclared: 0 };
  let hidden = (function () { try { return localStorage.getItem(CITEY_HIDE_KEY) === '1'; } catch (e) { return false; } })();
  const subs = new Set();
  const PRIO = { negation: 6, nequiv: 6, falsum: 5, suspicious: 4, turnstile: 3, flagged: 5, entails: 1, verum: 1, asserted: 1, testimony: 1, voice: 1, context: 1 };

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
  function snapshot() { return { tier, current: top(), gate, hidden }; }

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
  // Real, persisted hide — the author can tuck Citey away and he stays away.
  function setHidden(h) { hidden = !!h; try { localStorage.setItem(CITEY_HIDE_KEY, hidden ? '1' : '0'); } catch (e) {} notify(); }
  function getHidden() { return hidden; }

  return { subscribe, cue, resolve, clear, clearAll, setTier, getTier, setGate, getGate, setHidden, getHidden, snapshot };
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
    this.state = { tier: 'smart', current: null, gate: CiteyStore.getGate(), anchorY: null, menu: false, mode: 'actions', tags: [], col: null, focusState: null, hidden: CiteyStore.getHidden(), walk: null, hovered: false };
    this._gateTimer = null;
  }

  componentDidMount() {
    this.unsub = CiteyStore.subscribe(s => {
      const cur = s.current || baselineCue(s.gate);
      const anchorY = cur && cur.anchor ? this._anchorY(cur.anchor) : null;
      this.setState({ tier: s.tier, current: cur, gate: s.gate, anchorY, hidden: s.hidden });
    });
    this._onEvent = (e) => { const d = e.detail || {}; CiteyStore.cue(d.status || 'falsum', { anchor: this._resolveAnchor(d.anchor), msg: d.msg, sticky: d.sticky }); };
    document.addEventListener('citey:cue', this._onEvent);
    this._onSuggest = () => this._suggest();
    document.addEventListener('citey:suggest', this._onSuggest);
    this._onWalk = () => this._startWalk();
    document.addEventListener('citey:walk', this._onWalk);
    this._wireScanner();
    refreshGate();
  }
  componentWillUnmount() {
    if (this.unsub) this.unsub();
    document.removeEventListener('citey:cue', this._onEvent);
    document.removeEventListener('citey:suggest', this._onSuggest);
    document.removeEventListener('citey:walk', this._onWalk);
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
  _pin = () => { if (lastClaim && window.__npjGround && window.__npjGround.pin) window.__npjGround.pin(lastClaim); this.setState({ menu: false }); this._walkAdvance(); };
  _own = (stance) => { if (lastClaim && window.__npjGround && window.__npjGround.own) window.__npjGround.own(lastClaim, stance); this.setState({ menu: false }); setTimeout(() => { if (lastClaim) evaluateSpan(lastClaim); refreshGate(); }, 0); this._walkAdvance(); };
  _unown = () => { if (lastClaim && window.__npjGround && window.__npjGround.unown) window.__npjGround.unown(lastClaim); this.setState({ menu: false }); setTimeout(() => { if (lastClaim) evaluateSpan(lastClaim); refreshGate(); }, 0); };
  _setTier = (t) => { CiteyStore.setTier(t); if (lastClaim) evaluateSpan(lastClaim); };
  _hide = () => CiteyStore.setHidden(true);
  _show = () => CiteyStore.setHidden(false);

  // ---- "cite everything": walk the ungrounded claims one at a time ----
  // The queue is the publish gate's own flagged list (DOM order) — the exact
  // claims that would ship unverified. Pinning / owning one advances to the next.
  _walkQueue() {
    try { return (window.CiteyBrain ? window.CiteyBrain.publishGate().flagged : []) || []; } catch (e) { return []; }
  }
  _startWalk = () => {
    const q = this._walkQueue();
    if (!q.length) { CiteyStore.cue('verum', { msg: 'every claim is grounded — nothing to walk through.' }); return; }
    if (CiteyStore.getHidden()) CiteyStore.setHidden(false);   // can't walk if Citey's tucked away
    this.setState({ menu: false, walk: { total: q.length, i: 0 } }, () => this._walkTo(0));
  };
  _walkTo = (i) => {
    const q = this._walkQueue();
    if (!q.length || i >= q.length) { this._endWalk(true); return; }
    const item = q[Math.min(i, q.length - 1)];
    const el = item && item.el;
    if (el) {
      lastClaim = el;
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      evaluateSpan(el);
    }
    this.setState({ walk: { total: q.length, i: i }, menu: true, mode: 'actions' });
  };
  _walkNext = () => { const w = this.state.walk; if (!w) return; this._walkTo(w.i + 1); };
  _endWalk = (done) => {
    this.setState({ walk: null, menu: false });
    if (done) { refreshGate(); CiteyStore.cue('verum', { msg: 'walked the whole draft — every claim is declared.' }); }
  };
  // After a pin/own resolves, advance the walk to whatever still needs work.
  _walkAdvance() {
    if (!this.state.walk) return;
    setTimeout(() => {
      const q = this._walkQueue();
      if (!q.length) { this._endWalk(true); return; }
      this._walkTo(Math.min(this.state.walk.i, q.length - 1));
    }, 60);
  }

  _focusedState() {
    if (!lastClaim || !window.CiteyBrain) return null;
    try { return window.CiteyBrain.citeyStateForSpan({ el: lastClaim }, { tier: this.state.tier }).state; } catch (e) { return null; }
  }

  // The claim-grounding action panel.
  _renderActions(chip, ctx) {
    const { needsWork, isOwned, isGrounded, gate, tier } = ctx;
    const grounded = (gate.pinned || 0) + (gate.owned || 0);
    const walk = this.state.walk;
    return React.createElement(React.Fragment, null,
      walk ? React.createElement('div', { key: 'walk', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 7px', marginBottom: '2px', background: '#2c2942', border: '1px solid #4a4570', borderRadius: '8px' } },
        React.createElement('span', { style: { flex: 1, fontFamily: CITEY_MONO, fontSize: '10.5px', color: '#CFC9F2' } }, 'cite everything · ' + Math.min(walk.i + 1, walk.total) + ' of ' + walk.total),
        React.createElement('button', { onClick: this._walkNext, style: { background: '#7C74DE', color: '#fff', border: 0, borderRadius: '6px', padding: '4px 9px', cursor: 'pointer', fontFamily: CITEY_MONO, fontSize: '10.5px', fontWeight: 700 } }, 'Next ›'),
        React.createElement('button', { onClick: () => this._endWalk(false), title: 'Stop the walkthrough', style: { background: 'none', border: 0, color: '#A8A294', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: 0 } }, '✕')
      ) : null,
      React.createElement('div', { key: 'h', style: { fontFamily: CITEY_MONO, fontSize: '10px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#A8A294', marginBottom: '2px' } },
        needsWork ? 'ground this claim' : isOwned ? 'owned by you' : isGrounded ? 'grounded ✓' : 'this draft'),
      needsWork ? React.createElement('button', { key: 'pin', onClick: this._pin, style: chip() }, '📌  Pin the line in the source') : null,
      needsWork ? React.createElement('div', { key: 'or', style: { fontFamily: CITEY_MONO, fontSize: '9.5px', color: '#8C867A', margin: '2px 0 0' } }, 'or own it instead —') : null,
      needsWork ? React.createElement('button', { key: 'a', onClick: () => this._own('analysis'), style: chip() }, '⊢  My analysis') : null,
      needsWork ? React.createElement('button', { key: 't', onClick: () => this._own('testimony'), style: chip() }, '⊨  I witnessed this') : null,
      needsWork ? React.createElement('button', { key: 'v', onClick: () => this._own('voice'), style: chip() }, '⊩  My stated position') : null,
      needsWork ? React.createElement('button', { key: 'cx', onClick: () => this._own('context'), style: chip({ borderColor: '#2E8B86' }) }, '⊪  In context — continuing coverage') : null,
      isOwned ? React.createElement('button', { key: 'un', onClick: this._unown, style: chip() }, '↩  Unmark — back to a claim') : null,
      isGrounded ? React.createElement('button', { key: 're', onClick: this._pin, style: chip() }, '✎  Re-pin the source line') : null,
      React.createElement('button', { key: 'tags', onClick: this._suggest, style: chip({ borderColor: '#4a4733' }) }, '✦  Suggest tags'),
      (gate.undeclared > 0) ? React.createElement('button', { key: 'walk', onClick: this._startWalk, style: chip({ borderColor: '#7C74DE', background: '#2c2942' }) }, '➜  Cite everything — walk me through ' + gate.undeclared) : null,
      React.createElement('button', { key: 'hide', onClick: this._hide, style: chip({ borderColor: '#3a3833', color: '#A8A294', fontSize: '10.5px' }) }, '⤫  Hide Citey'),
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
    // Citey lives ONLY in the editor — a real drafting surface. Never on the
    // public site, the sign-in page, or the document explorer.
    if (route !== 'newsroom') return null;
    // …and only for a signed-in author. A guest has no claims to ground and no
    // account to save grounding to, so Citey never appears for them.
    if (!this.props.signedIn) return null;
    const S = window.CITEY_STATES;
    if (!S) return null;
    const gateH = this.state.gate || {};
    // …and only when there is REAL WORK to do: at least one claim is bound to a
    // source (the publish gate counts them), or a walkthrough is in flight. An
    // empty draft summons nothing — Citey turns up the moment the author binds
    // their first claim, and the persisted "hide" still wins over all of this.
    const hasWork = (gateH.bound || 0) > 0 || !!this.state.walk;
    if (!hasWork) return null;

    // Hidden: collapse to a small re-show pill (the undeclared count still shows
    // so the author knows work remains).
    if (this.state.hidden) {
      return React.createElement('button', {
        onClick: this._show, title: 'Show Citey',
        style: { position: 'fixed', right: '18px', bottom: '18px', zIndex: 5400, display: 'inline-flex', alignItems: 'center', gap: '7px', background: '#1B1A1E', color: '#EDE7DA', border: '1px solid #3a3833', borderRadius: '999px', padding: '7px 12px', cursor: 'pointer', fontFamily: CITEY_MONO, fontSize: '11.5px', boxShadow: '0 8px 22px -10px rgba(20,16,8,.6)' }
      },
        React.createElement('span', { style: { fontWeight: 800, color: gateH.undeclared ? '#E08A5A' : '#5FBF93' } }, gateH.undeclared ? '⊥' : '⊤'),
        'Citey',
        gateH.undeclared ? React.createElement('span', { style: { minWidth: '17px', height: '17px', padding: '0 4px', borderRadius: '9px', background: '#D8412C', color: '#fff', fontWeight: 700, fontSize: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } }, gateH.undeclared) : null
      );
    }

    const cur = this.state.current || baselineCue(this.state.gate);
    const d = S.describe(cur.state);
    const tier = this.state.tier;
    const gate = this.state.gate || {};
    const fState = this.state.menu ? this._focusedState() : null;
    const isGrounded = fState === 'verum' || fState === 'entails';
    const isOwned = fState === 'asserted' || fState === 'testimony' || fState === 'voice' || fState === 'context';
    const needsWork = fState === 'falsum' || fState === 'suspicious' || fState === 'negation';

    // Subtler by default: a smaller sprite that sits quiet (and a touch faded)
    // until you hover it, focus a claim (a message), or open the menu — then it
    // comes fully forward. He still changes SHAPE with the grounding state; the
    // change just plays as an interstitial morph (see the keyed group below).
    const active = this.state.hovered || this.state.menu || (cur && cur.msg) || (cur && !cur.baseline);
    const SIZE = 104;
    const wrapStyle = {
      position: 'fixed', right: '20px', zIndex: 5400, width: SIZE + 'px', cursor: 'pointer',
      bottom: this.state.anchorY == null ? '20px' : 'auto',
      top: this.state.anchorY == null ? 'auto' : this.state.anchorY + 'px',
      opacity: active ? 1 : 0.78,
      filter: active ? 'none' : 'saturate(.82)',
      transition: 'top .5s cubic-bezier(.3,1,.4,1), opacity .4s ease, filter .4s ease, transform .35s cubic-bezier(.3,1.4,.5,1)',
      transform: active ? 'scale(1)' : 'scale(.9)',
      transformOrigin: 'right bottom'
    };
    const chip = (extra) => Object.assign({
      textAlign: 'left', width: '100%', border: '1px solid #3a3833', background: '#26241f', color: '#EDE7DA',
      padding: '7px 9px', cursor: 'pointer', fontFamily: CITEY_MONO, fontSize: '11.5px', lineHeight: 1.35, borderRadius: '8px'
    }, extra || {});

    return (
      React.createElement('div', { style: wrapStyle, 'data-citey-anim': true,
        onMouseEnter: () => this.setState({ hovered: true }),
        onMouseLeave: () => this.setState({ hovered: false }) },
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
        // Nested groups COMPOSE their transforms: bob (drift up/down) ∘ boil
        // (hand-drawn wobble) ∘ morph (the interstitial). The morph group is
        // KEYED on the state name, so React remounts it whenever Citey changes
        // shape — replaying citey-morph so the reshape reads as a transformation.
        React.createElement('div', { onClick: this._toggleMenu, title: 'Citey — ground every claim before you publish', style: { position: 'relative', width: SIZE + 'px', height: Math.round(SIZE * 1.2) + 'px', margin: '0 auto' } },
          React.createElement('svg', { viewBox: '0 0 150 180', width: SIZE, height: Math.round(SIZE * 1.2), style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } },
            React.createElement('g', { style: { animation: 'citey-bob 3.8s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: 'center bottom' } },
              React.createElement('g', { style: { animation: 'citey-boil 2.6s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: 'center' } },
                React.createElement('g', { key: cur.state, style: { animation: 'citey-morph .5s cubic-bezier(.4,1.5,.5,1)', transformBox: 'fill-box', transformOrigin: 'center' } },
                  React.createElement('path', { d: d.bodyPath, fill: 'none', stroke: d.color, strokeWidth: 13, strokeLinecap: 'round', strokeLinejoin: 'round', style: { transition: 'stroke .45s ease' } })
                )
              )
            )
          ),
          // centering wrapper (its translateX must NOT be clobbered by the
          // animations) → blink (scaleY) → wander (translate) → the eye pair
          React.createElement('div', { style: { position: 'absolute', top: Math.round(SIZE * 0.085) + 'px', left: '50%', transform: 'translateX(-50%)', zIndex: 3 } },
            React.createElement('div', { style: { animation: 'citey-blink 5.2s ease-in-out infinite' } },
              React.createElement('div', { style: { display: 'flex', gap: '4px', animation: 'citey-eye-wander 8s ease-in-out infinite' } },
                React.createElement('img', { key: 'el' + d.eyes[0], src: EYE_BASE + d.eyes[0] + '.png', draggable: false, style: { width: Math.round(SIZE * 0.33) + 'px', height: 'auto', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.18))' } }),
                React.createElement('img', { key: 'er' + d.eyes[1], src: EYE_BASE + d.eyes[1] + '.png', draggable: false, style: { width: Math.round(SIZE * 0.33) + 'px', height: 'auto', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.18))' } })
              )
            )
          ),
          // a small badge when claims still need grounding
          (gate.undeclared && !this.state.menu) ? React.createElement('div', {
            style: { position: 'absolute', top: '-2px', right: '8px', minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '9px', background: '#D8412C', color: '#fff', fontFamily: CITEY_MONO, fontWeight: 700, fontSize: '10.5px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(0,0,0,.3)' }
          }, gate.undeclared) : null
        ),
        // tier badge — fades in only when Citey is forward, so the idle sprite stays quiet
        React.createElement('div', { style: { textAlign: 'center', marginTop: '3px', fontFamily: CITEY_MONO, fontSize: '8.5px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#A8A294', opacity: active ? 0.9 : 0, transition: 'opacity .3s ease' } },
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
  // Real, persisted hide/show (the old hide() only cleared cues).
  hide: () => CiteyStore.setHidden(true),
  show: () => CiteyStore.setHidden(false),
  toggle: () => CiteyStore.setHidden(!CiteyStore.getHidden()),
  hidden: () => CiteyStore.getHidden(),
  // Start the "cite everything" walkthrough over the publish gate's flagged claims.
  walkthrough: () => document.dispatchEvent(new CustomEvent('citey:walk'))
};

if (typeof module !== 'undefined' && module.exports) module.exports = { CiteyAgent, CiteyStore, evaluateSpan };
window.CiteyAgent = CiteyAgent;
