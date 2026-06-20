/* structure.js — the editing-only post-structure layer (spec v0.2).
 *
 * A post's structure is one ordered top-level list of Items. An Item is either
 * a Slot (a labeled container from an applied post type) holding zero or more
 * child Sections, or an orphan Section sitting at the top level. A Section is a
 * heading + a body bound to prose (by heading slug — npj is block/Markdown, and
 * a section owns its heading down to the next sibling-or-higher heading).
 *
 * This module is the spine of the whole feature and carries NO UI:
 *   · the append-only event log + its fold to a PostStructure   (Invariant I4)
 *   · every structural operation, as a pure event producer
 *   · apply / remove a post type, lossless                       (Invariant I2)
 *   · flatten(): the build-time projection to a flat list of      (Invariant I1)
 *     { heading, body } — slots, prompts, type, log, fromHeader,
 *     parentSlotId and collapsed are ALL dropped here, so nothing
 *     structural can ever reach a reader.
 *   · the built-in post types + capturing a structure-only type   (§4)
 *
 * Prose is never stored here — a Section only REFERENCES prose, so deleting the
 * whole layer leaves a valid article (Invariant I3).
 *
 * UMD: exposes window.NpjStructure in the browser AND module.exports in node
 * (the test suite folds/flattens this directly — no DOM needed).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjStructure = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var SCHEMA = "npj/structure/1";

  /* ---------------- built-in post types ----------------
   * The author sees the TYPE (e.g. "Investigation"), never the narrative shape
   * it maps to. Each slot ships in-place ghost text (`prompt`) that shows while
   * the slot is empty and never renders. User-saved types carry empty prompts. */
  var BUILTIN_TYPES = [
    {
      id: "news-report", name: "News report", builtin: true,
      description: "Inverted pyramid — the news first, then the facts, then the context.",
      slots: [
        { key: "the-news",  label: "The news, up top", prompt: "Lead with what happened — the single newest, most important fact, in a sentence or two." },
        { key: "key-facts", label: "The key facts",    prompt: "Who, what, when, where, how much — the load-bearing facts, most important first." },
        { key: "context",   label: "Context",          prompt: "Why it matters, what came before, what's next — the background a reader needs to place the news." }
      ]
    },
    {
      id: "investigation", name: "Investigation", builtin: true,
      description: "Hourglass — open small on a person, pull up to the stakes, lay out the evidence, land it.",
      slots: [
        { key: "open",     label: "Open on a person or moment", prompt: "Open on a specific person or moment — someone the reader follows in." },
        { key: "why",      label: "Why it matters",             prompt: "Pull up to the stakes: what this reveals, who it touches, why now." },
        { key: "evidence", label: "The evidence",               prompt: "Lay out what you found, step by step. Add a section per thread.", repeatable: true },
        { key: "home",     label: "Bring it home",              prompt: "Land it — return to the person, the cost, what happens next." }
      ]
    },
    {
      id: "explainer", name: "Explainer", builtin: true,
      description: "Nut-graf — a way in, the question it answers, how it works, what to watch.",
      slots: [
        { key: "way-in",   label: "A way in",                prompt: "A concrete scene, example or question that opens the topic." },
        { key: "question", label: "The question this answers", prompt: "State plainly the question this piece answers — the nut graf." },
        { key: "how",      label: "How it works",            prompt: "Walk through the mechanism, the rules, the moving parts." },
        { key: "watch",    label: "What to watch",           prompt: "What's unresolved, what changes next, what to keep an eye on." }
      ]
    },
    {
      id: "personal-essay", name: "Personal essay", builtin: true,
      description: "Narrative arc — set the scene, the turn, where it landed, back to now.",
      slots: [
        { key: "scene",  label: "Set the scene",   prompt: "Ground the reader in a time, a place, and you in it." },
        { key: "turn",   label: "The turn",        prompt: "The moment something shifts — the choice, the break, the realization." },
        { key: "landed", label: "Where it landed", prompt: "The consequence — what it cost, what it changed." },
        { key: "now",    label: "Back to now",     prompt: "Step back to the present and what it means, looking back." }
      ]
    }
  ];

  /* ---------------- ids ---------------- */
  var _seq = 0;
  function makeId(prefix) {
    _seq = (_seq + 1) % 0x100000;
    return (prefix || "x") + "-" + Date.now().toString(36) + "-" + _seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /* ---------------- state shape ---------------- */
  function emptyState(articleId) {
    return { articleId: articleId || null, appliedTypeId: null, slots: [], sections: [], version: 0 };
  }

  function sectionById(s, id) { for (var i = 0; i < s.sections.length; i++) if (s.sections[i].id === id) return s.sections[i]; return null; }
  function slotById(s, id) { for (var i = 0; i < s.slots.length; i++) if (s.slots[i].id === id) return s.slots[i]; return null; }

  // every top-level Item (slots + orphan sections) in one shared order space.
  function topRefs(s) {
    var refs = [];
    s.slots.forEach(function (sl) { refs.push({ kind: "slot", id: sl.id, order: sl.order, ref: sl }); });
    s.sections.forEach(function (sec) { if (sec.parentSlotId == null) refs.push({ kind: "section", id: sec.id, order: sec.order, ref: sec }); });
    refs.sort(function (a, b) { return (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return refs;
  }
  function childRefs(s, slotId) {
    var refs = s.sections.filter(function (sec) { return sec.parentSlotId === slotId; });
    refs.sort(function (a, b) { return (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return refs;
  }

  // renumber every order space to dense 0..n, preserving current relative order.
  function normalize(s) {
    topRefs(s).forEach(function (r, i) { r.ref.order = i; });
    s.slots.forEach(function (sl) { childRefs(s, sl.id).forEach(function (sec, i) { sec.order = i; }); });
  }

  function clampIdx(i, len) { i = i == null ? len : i; if (i < 0) i = 0; if (i > len) i = len; return i; }

  // place a top-level item (slot or section id) at index, then renumber.
  function placeTop(s, id, index) {
    var list = topRefs(s).filter(function (r) { return r.id !== id; }).map(function (r) { return r.id; });
    list.splice(clampIdx(index, list.length), 0, id);
    var orderOf = {}; list.forEach(function (x, i) { orderOf[x] = i; });
    s.slots.forEach(function (sl) { if (orderOf[sl.id] != null) sl.order = orderOf[sl.id]; });
    s.sections.forEach(function (sec) { if (sec.parentSlotId == null && orderOf[sec.id] != null) sec.order = orderOf[sec.id]; });
  }
  // place a section among a slot's children at index, then renumber that slot.
  function placeChild(s, slotId, sectionId, index) {
    var list = childRefs(s, slotId).filter(function (sec) { return sec.id !== sectionId; }).map(function (sec) { return sec.id; });
    list.splice(clampIdx(index, list.length), 0, sectionId);
    list.forEach(function (cid, i) { var sec = sectionById(s, cid); if (sec) sec.order = i; });
  }

  /* ---------------- the fold (Invariant I4) ----------------
   * PostStructure is the fold of the append-only event log. `base` lets a tail
   * be folded onto a snapshot (§9) instead of re-folding from zero. */
  function fold(events, base) {
    var s = base ? clone(base) : emptyState();
    (events || []).forEach(function (ev) { applyEvent(s, ev); s.version++; });
    return s;
  }

  function applyEvent(s, ev) {
    if (!ev || !ev.t) return;
    switch (ev.t) {
      case "type.apply": {
        s.appliedTypeId = ev.typeId != null ? ev.typeId : s.appliedTypeId;
        break;
      }
      case "type.remove": {
        // dissolve slot wrappers; promote children to the top level in their
        // current VISUAL (flatten) order — lossless, reversible (Invariant I2).
        var linear = [];
        topRefs(s).forEach(function (r) {
          if (r.kind === "slot") childRefs(s, r.id).forEach(function (c) { linear.push(c.id); });
          else linear.push(r.id);
        });
        s.slots = [];
        linear.forEach(function (id, i) { var sec = sectionById(s, id); if (sec) { sec.parentSlotId = null; sec.order = i; } });
        s.appliedTypeId = null;
        break;
      }
      case "slot.create": {
        var sl = ev.slot || {};
        if (sl.id && slotById(s, sl.id)) break; // idempotent
        s.slots.push({
          id: sl.id || makeId("slot"), typeSlotKey: sl.typeSlotKey || "", label: sl.label || "",
          prompt: sl.prompt || "", repeatable: !!sl.repeatable,
          order: sl.order != null ? sl.order : topRefs(s).length
        });
        break;
      }
      case "slot.reorder": {
        if (slotById(s, ev.id)) placeTop(s, ev.id, ev.toOrder);
        break;
      }
      case "section.fromHeader": {
        var existing = sectionById(s, ev.id);
        if (existing) { // a heading the author edited — keep identity, update binding
          existing.body = { kind: "headingSpan", headingSlug: ev.headingSlug };
          if (ev.heading != null) existing.heading = ev.heading;
          existing.fromHeader = true;
          break;
        }
        addSection(s, {
          id: ev.id, heading: ev.heading != null ? ev.heading : null,
          body: { kind: "headingSpan", headingSlug: ev.headingSlug },
          parentSlotId: ev.parentSlotId != null ? ev.parentSlotId : null, fromHeader: true
        }, ev.at);
        break;
      }
      case "section.create": {
        if (sectionById(s, ev.id)) break;
        addSection(s, {
          id: ev.id, heading: ev.heading != null ? ev.heading : null,
          body: ev.body || { kind: "stubOnly" },
          parentSlotId: ev.parentSlotId != null ? ev.parentSlotId : null, fromHeader: false
        }, ev.at);
        break;
      }
      case "section.move": {
        moveSectionTo(s, ev.id, ev.toParentSlotId != null ? ev.toParentSlotId : null, ev.toOrder);
        break;
      }
      case "section.move_bulk": {
        var ids = (ev.ids || []).filter(function (id) { return sectionById(s, id); });
        // preserve their current relative order, drop them in at toOrder.
        var ordered = ids.slice().sort(function (a, b) { return flatIndex(s, a) - flatIndex(s, b); });
        var at = ev.toOrder;
        ordered.forEach(function (id) { moveSectionTo(s, id, ev.toParentSlotId != null ? ev.toParentSlotId : null, at); at = (at == null ? null : at + 1); });
        break;
      }
      case "section.set_heading": {
        var sh = sectionById(s, ev.id); if (sh) sh.heading = ev.heading != null ? ev.heading : null;
        break;
      }
      case "section.set_body": { // stubOnly → headingSpan/blockRange once prose is written (§7)
        var sb = sectionById(s, ev.id); if (sb && ev.body) sb.body = ev.body;
        break;
      }
      case "section.set_collapsed": {
        var sc = sectionById(s, ev.id); if (sc) sc.collapsed = !!ev.collapsed;
        break;
      }
      case "section.delete": {
        // drop the structural annotation only; prose policy is the editor's (§7).
        s.sections = s.sections.filter(function (sec) { return sec.id !== ev.id; });
        break;
      }
      case "type.save": break; // captures a type into the external store; no state change
      default: break;
    }
    if (ev.t !== "type.apply" && ev.t !== "type.save") normalize(s);
  }

  function addSection(s, sec, at) {
    // push first, then operate on the STORED node — a section born under a slot
    // that doesn't exist must safely fall to the top level, never dangle.
    var stored = { id: sec.id, heading: sec.heading, body: sec.body, parentSlotId: sec.parentSlotId, order: 0, fromHeader: !!sec.fromHeader, collapsed: false };
    s.sections.push(stored);
    if (stored.parentSlotId != null && slotById(s, stored.parentSlotId)) placeChild(s, stored.parentSlotId, stored.id, at);
    else { stored.parentSlotId = null; placeTop(s, stored.id, at); }
  }

  function moveSectionTo(s, id, toParentSlotId, toOrder) {
    var sec = sectionById(s, id); if (!sec) return;
    if (toParentSlotId != null && !slotById(s, toParentSlotId)) toParentSlotId = null;
    sec.parentSlotId = toParentSlotId;
    if (toParentSlotId == null) placeTop(s, id, toOrder);
    else placeChild(s, toParentSlotId, id, toOrder);
  }

  // a section's position in the linear (flatten) walk — for stable bulk moves.
  function flatIndex(s, id) {
    var i = 0, found = -1;
    topRefs(s).forEach(function (r) {
      if (r.kind === "slot") childRefs(s, r.id).forEach(function (c) { if (c.id === id) found = i; i++; });
      else { if (r.id === id) found = i; i++; }
    });
    return found < 0 ? 1e9 : found;
  }

  /* ---------------- flatten — the build projection (Invariants I1, I8) ----------------
   * Walk the top level in order; for a Slot recurse into its children, for an
   * orphan Section emit it. The result is a flat [{ heading, body }] — and ONLY
   * { heading, body }. Slot label/prompt, parentSlotId, fromHeader, collapsed,
   * order, the applied type and the whole event log never appear here, so a
   * reader cannot tell a templated section from an organic one. Empty, unwritten
   * stubs (stubOnly + no heading) emit nothing. */
  function flatten(s) {
    var out = [];
    function emit(sec) {
      if (!sec) return;
      var isStub = sec.body && sec.body.kind === "stubOnly";
      if (isStub && (sec.heading == null || sec.heading === "")) return;
      out.push({ heading: sec.heading != null ? sec.heading : null, body: clone(sec.body) });
    }
    topRefs(s).forEach(function (r) {
      if (r.kind === "slot") childRefs(s, r.id).forEach(emit);
      else emit(r.ref);
    });
    return out;
  }

  // the ordered list of section ids as the build would emit them — the editor
  // uses this to reflow the document's section-spans so WYSIWYG === published.
  function flattenIds(s) {
    var out = [];
    topRefs(s).forEach(function (r) {
      if (r.kind === "slot") childRefs(s, r.id).forEach(function (c) { out.push(c.id); });
      else out.push(r.id);
    });
    return out;
  }

  /* ---------------- operations (pure: state → events) ----------------
   * Each returns the event(s) to append to the log. Ids are minted here so the
   * log is fully explicit and the fold stays deterministic on re-play. */
  var ops = {
    // §6 — append the type's slots after whatever is already at the top level;
    // existing organic sections stay put as orphans, to be dragged in (or not).
    applyType: function (state, type) {
      var evs = [{ t: "type.apply", typeId: type.id }];
      var order = topRefs(state).length;
      (type.slots || []).forEach(function (ts) {
        evs.push({ t: "slot.create", slot: { id: makeId("slot"), typeSlotKey: ts.key, label: ts.label, prompt: ts.prompt || "", repeatable: !!ts.repeatable, order: order++ } });
      });
      return evs;
    },
    removeType: function () { return [{ t: "type.remove" }]; },
    // add another instance of a repeatable slot (e.g. another "The evidence").
    addSlot: function (state, fromSlot) {
      return [{ t: "slot.create", slot: { id: makeId("slot"), typeSlotKey: fromSlot.typeSlotKey, label: fromSlot.label, prompt: fromSlot.prompt || "", repeatable: !!fromSlot.repeatable, order: topRefs(state).length } }];
    },
    fromHeader: function (headingSlug, opts) { opts = opts || {}; return [{ t: "section.fromHeader", id: opts.id || makeId("sec"), headingSlug: headingSlug, heading: opts.heading, parentSlotId: opts.parentSlotId != null ? opts.parentSlotId : null, at: opts.at }]; },
    createSection: function (parentSlotId, at, opts) { opts = opts || {}; return [{ t: "section.create", id: opts.id || makeId("sec"), parentSlotId: parentSlotId != null ? parentSlotId : null, at: at, heading: opts.heading, body: opts.body }]; },
    moveSection: function (id, toParentSlotId, toOrder) { return [{ t: "section.move", id: id, toParentSlotId: toParentSlotId != null ? toParentSlotId : null, toOrder: toOrder }]; },
    moveBulk: function (ids, toParentSlotId, toOrder) { return [{ t: "section.move_bulk", ids: ids, toParentSlotId: toParentSlotId != null ? toParentSlotId : null, toOrder: toOrder }]; },
    setHeading: function (id, heading) { return [{ t: "section.set_heading", id: id, heading: heading }]; },
    setBody: function (id, body) { return [{ t: "section.set_body", id: id, body: body }]; },
    setCollapsed: function (id, collapsed) { return [{ t: "section.set_collapsed", id: id, collapsed: !!collapsed }]; },
    deleteSection: function (id) { return [{ t: "section.delete", id: id }]; },
    reorderSlot: function (id, toOrder) { return [{ t: "slot.reorder", id: id, toOrder: toOrder }]; },
    saveType: function (state, typeId) { return [{ t: "type.save", typeId: typeId, from: state.articleId }]; }
  };

  /* ---------------- save your own type (structure only, §4) ----------------
   * Capture the current slot arc — ordered slots + their labels — as a clean
   * reusable skeleton. No content, no prose, no orphan sections, empty prompts. */
  function saveFrom(state, name) {
    var slots = topRefs(state).filter(function (r) { return r.kind === "slot"; }).map(function (r, i) {
      var sl = r.ref;
      return { key: sl.typeSlotKey || ("slot-" + (i + 1)), label: sl.label || ("Section " + (i + 1)), prompt: "", repeatable: !!sl.repeatable };
    });
    return { id: "usr-" + makeId("type"), name: name || "My structure", description: "", slots: slots, builtin: false };
  }

  /* ---------------- DOM bridge (browser/jsdom only; never touched in pure folds) ----------------
   * The editor's contenteditable is the source of truth for prose. These two
   * functions keep the structure log and the document in step, and are unit
   * tested against a DOM so the section-span surgery can't scramble an article:
   *   · collect  — read each section's span (its heading + the blocks beneath it,
   *                up to the next heading) from a root element, in document order;
   *   · reflow   — reorder those spans to match a flattened id order so WYSIWYG ===
   *                what publishes (lead nodes — banner, title, dek, intro — stay);
   *   · reconcile— DOM → events: every heading becomes a Section (stable identity
   *                via data-sec, so renames/reorders keep their slot), new ones are
   *                born just after the section above them inheriting its slot, and
   *                a vanished heading drops its annotation (I3). Pure of side
   *                effects except stamping data-sec on brand-new headings. */
  function isHeadingTag(tag) { return /^H[1-6]$/.test(tag || ""); }
  function domCollect(root) {
    var spans = {}, order = [], cur = null;
    Array.prototype.slice.call(root.children || []).forEach(function (node) {
      var heading = isHeadingTag(node.tagName);
      var sec = heading && node.getAttribute ? node.getAttribute("data-sec") : null;
      if (heading && sec) { cur = sec; spans[sec] = [node]; order.push(sec); }
      else if (heading) { cur = null; }          // title / unstamped heading closes a section
      else if (cur) { spans[cur].push(node); }    // a body block of the current section
    });
    return { spans: spans, order: order };
  }
  function domReflow(root, orderedIds) {
    if (!root || !orderedIds) return false;
    var c = domCollect(root), spans = c.spans, domOrder = c.order;
    var target = orderedIds.filter(function (id) { return spans[id]; });
    domOrder.forEach(function (id) { if (target.indexOf(id) < 0) target.push(id); }); // defensive
    if (target.length === domOrder.length && target.every(function (id, i) { return id === domOrder[i]; })) return false;
    target.forEach(function (id) { spans[id].forEach(function (n) { root.appendChild(n); }); });
    return true;
  }
  function domReconcile(root, log, opts) {
    opts = opts || {};
    var slugFor = opts.slugFor || function (h) { return h.id; };
    var work = fold(log), evs = [], seen = {}, prevId = null;
    var headings = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll("h2,h3")) : [];
    headings.forEach(function (h) {
      var text = ((h.innerText != null ? h.innerText : h.textContent) || "").trim();
      if (!text) return;
      var slug = slugFor(h) || ("s-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
      var secId = h.getAttribute ? h.getAttribute("data-sec") : null;
      var sec = secId ? sectionById(work, secId) : null;
      if (sec && seen[sec.id]) sec = null;        // duplicate data-sec (copy/paste) → treat as new
      if (sec) {
        seen[sec.id] = true;
        var local = [];
        if (sec.heading !== text) local.push({ t: "section.set_heading", id: sec.id, heading: text });
        if (!sec.body || sec.body.headingSlug !== slug) local.push({ t: "section.set_body", id: sec.id, body: { kind: "headingSpan", headingSlug: slug } });
        if (local.length) { evs = evs.concat(local); work = fold(log.concat(evs)); }
        prevId = sec.id;
      } else {
        var id = makeId("sec");
        if (h.setAttribute) h.setAttribute("data-sec", id);
        seen[id] = true;
        var parent = null, at = 0;
        if (prevId) {
          var p = sectionById(work, prevId);
          parent = p ? p.parentSlotId : null;
          var group = parent == null ? topRefs(work).filter(function (r) { return r.kind === "section"; }).map(function (r) { return r.id; }) : childRefs(work, parent).map(function (x) { return x.id; });
          var pi = group.indexOf(prevId); at = pi < 0 ? group.length : pi + 1;
        }
        evs.push({ t: "section.fromHeader", id: id, headingSlug: slug, heading: text, parentSlotId: parent, at: at });
        work = fold(log.concat(evs));
        prevId = id;
      }
    });
    fold(log).sections.forEach(function (s) { if (!seen[s.id]) evs.push({ t: "section.delete", id: s.id }); });
    return evs;
  }

  /* ---------------- a cheap structural sanity check (used by tests/CI) ---------------- */
  function validate(state) {
    var errs = [];
    var ids = {};
    state.sections.forEach(function (sec) {
      if (ids[sec.id]) errs.push("duplicate section id " + sec.id); ids[sec.id] = 1;
      if (sec.parentSlotId != null && !slotById(state, sec.parentSlotId)) errs.push("section " + sec.id + " points at missing slot " + sec.parentSlotId);
    });
    var slotIds = {};
    state.slots.forEach(function (sl) { if (slotIds[sl.id]) errs.push("duplicate slot id " + sl.id); slotIds[sl.id] = 1; });
    return errs;
  }

  /* ---------------- the user-saved type store (browser) ----------------
   * Built-ins ship with npj; the author's own types live in localStorage and,
   * when signed in, mirror to Matrix account data so they travel across posts
   * and devices (same pattern as drafts.js). All best-effort — never blocks. */
  var TYPES_LS = "npj_post_types_v1";
  var TYPES_ACCOUNT = "press.npj.posttypes";
  function lsUserTypes() { try { var a = JSON.parse(localStorage.getItem(TYPES_LS) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function lsWrite(a) { try { localStorage.setItem(TYPES_LS, JSON.stringify(a)); } catch (e) {} }
  var typeStore = {
    BUILTINS: BUILTIN_TYPES,
    all: function () { return BUILTIN_TYPES.concat(lsUserTypes()); },
    user: function () { return lsUserTypes(); },
    get: function (id) { var all = typeStore.all(); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; },
    save: function (type) {
      if (!type || !type.id) return null;
      var a = lsUserTypes().filter(function (t) { return t.id !== type.id; });
      a.unshift(type); lsWrite(a); typeStore._push();
      return type;
    },
    remove: function (id) { lsWrite(lsUserTypes().filter(function (t) { return t.id !== id; })); typeStore._push(); },
    // pull the account copy in (on sign-in); merge by id, account wins ties.
    sync: function () {
      try {
        if (typeof window === "undefined" || !window.MatrixAuth || !window.MatrixAuth.getAccountData) return Promise.resolve();
        return window.MatrixAuth.getAccountData(TYPES_ACCOUNT).then(function (d) {
          if (!d || !Array.isArray(d.types)) return;
          var byId = {}; lsUserTypes().forEach(function (t) { byId[t.id] = t; }); d.types.forEach(function (t) { if (t && t.id) byId[t.id] = t; });
          lsWrite(Object.keys(byId).map(function (k) { return byId[k]; }));
        }).catch(function () {});
      } catch (e) { return Promise.resolve(); }
    },
    _push: function () {
      try {
        if (typeof window === "undefined" || !window.MatrixAuth || !window.MatrixAuth.setAccountData || !window.MatrixAuth.isSignedIn || !window.MatrixAuth.isSignedIn()) return;
        window.MatrixAuth.setAccountData(TYPES_ACCOUNT, { v: 1, updated: new Date().toISOString(), types: lsUserTypes() });
      } catch (e) {}
    }
  };

  return {
    SCHEMA: SCHEMA,
    BUILTIN_TYPES: BUILTIN_TYPES,
    makeId: makeId,
    emptyState: emptyState,
    fold: fold,
    flatten: flatten,
    flattenIds: flattenIds,
    saveFrom: saveFrom,
    validate: validate,
    ops: ops,
    types: typeStore,
    dom: { collect: domCollect, reflow: domReflow, reconcile: domReconcile },
    // low-level selectors (the editor reads these to render the rail)
    topRefs: topRefs, childRefs: childRefs, sectionById: sectionById, slotById: slotById, flatIndex: flatIndex
  };
});
