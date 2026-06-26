/* NPJ layout config — the editable chrome of the site + the permission model.
   The verified founding admin curates these values; everyone else reads them.
   Defaults are intentionally generic so the public repo ships with no place- or
   beat-specific content baked in.

   Shape:
     sections     : { name, publishers[] }[]  // the nav columns/verticals + who may publish to each
     taglines     : string[]                  // the masthead "community-___." lines
     utility      : { label, nav }[]          // utility-bar links (nav ∈ explore|standards|submit|contributors)
     brand        : null | { accent, headline, body, palette[] }  // optional admin brand overrides
     roles        : { "@mxid": "admin" | "editor" }  // delegated permissions (see below)
     contributors : { "@mxid": { name, bio } } // the PUBLIC contributor masthead — a display
                                               // name + a ≤250-char "About me", read by every
                                               // visitor (this is the world-readable "variable")

   Permission model — authorization flows through the founding admin:
     • SEED_ADMIN (@collective_boundary730383:hyphae.social) is the immutable root
       admin. Always 'admin'; can never be demoted or removed.
     • admin  → publish (layout + articles), edit, AND manage roles.
     • editor → edit / draft / invite collaborators, but cannot publish or
       change permissions.
     • everyone else → can email a tip, but cannot sign into the contributor tools.

   Durability (survives a browser wipe): roles are committed to GitHub inside
   layout.json (world-readable) and mirrored to a Matrix control-room state event
   that only admins can write (app/identity/matrix-auth.js → writePermissions). The browser
   holds only a cache; on re-login every capability re-derives from those stores.

   Contributor profiles (the byline) — name + "About me" — ride the SAME public
   layout.json so a visitor reads them straight from GitHub (the requested public
   "variable"). A contributor edits their own profile in-app; it saves durably to
   their Matrix account (app/identity/profiles.js → press.npj.profile) and is published to
   the public file by an admin (who already commits layout.json). Names default
   from the contributor's Matrix account (their displayname). A byline may credit
   editors (optional) or be "Unsigned" — that lives on the article, not here. */

// The founding admin — the root of trust. Matches MatrixAuth.ADMIN_MXID.
const SEED_ADMIN = "@collective_boundary730383:hyphae.social";

const LAYOUT_DEFAULTS = {
  sections: [
    { name: "Latest", publishers: [] }
  ],
  taglines: ["created", "backed", "edited"],
  utility: [
    { label: "Our standards", nav: "standards" },
    { label: "Submit", nav: "submit" }
  ],
  brand: null,
  // Front-page lineup curation (admin "Edit layout"):
  //   template : a whole-page preset that sets the default card layout per slot
  //   order    : explicit slug order — lets the admin hotswap which piece is the
  //              cover / row-2 / "more". Empty → fall back to newest-first.
  //   cards    : per-slug card-template override (wins over the page template).
  front: { template: "standard", order: [], cards: {} },
  roles: {},
  contributors: {}
};

const LAYOUT_LS_KEY = "npj_layout_v1";

// Byline / profile limits — the "About me" caps at 250 VISIBLE characters (the
// ask): link labels + plain text. The committed markdown source also carries
// the [..](..) syntax and the URLs (which don't count toward the 250), so the
// stored string is clamped to the roomier BIO_RAW_MAX — clamping to 250 here
// would cut a trailing link in half. The display name caps at a headline width.
const BIO_MAX = 250;
const BIO_RAW_MAX = 1500;
const NAME_MAX = 80;

// Length-clamp only — NOT a trim. This runs on every keystroke (the layout is
// re-normalized on each edit), so trimming here would eat the trailing space you
// need to type between words. Trimming for the committed file happens at the
// explicit save points (app/identity/profiles.js → clean()).
function clampStr(v, max) { return String(v == null ? "" : v).slice(0, max); }

// A contributor profile is { name, bio } keyed by mxid. Anything malformed is
// dropped; strings are length-clamped so a committed file can never carry an
// oversized bio. Profiles that are empty once trimmed (no name and no bio) prune.
function normalizeContributors(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(raw)) {
      if (!/^@[^:]+:[^:]+$/.test(k)) continue;
      const p = raw[k] || {};
      const name = clampStr(p.name, NAME_MAX);
      const bio = clampStr(p.bio, BIO_RAW_MAX);
      if (!name.trim() && !bio.trim()) continue;
      out[k] = { name, bio };
      if (p.updated) out[k].updated = String(p.updated).slice(0, 40);
    }
  }
  return out;
}

/* Front-page card templates — each names where the photo sits relative to the
   title + subtitle (dek). The admin picks one per article, or the article
   inherits the whole-page template's default. `img` ∈ below|top|left|right|
   behind|none. These are the "form templates with different positions of images
   and titles and subtitles." */
const FRONT_CARD_TEMPLATES = {
  "classic":     { label: "Classic · photo below text",  img: "below" },
  "image-top":   { label: "Photo on top",                img: "top" },
  "image-left":  { label: "Photo left · text right",     img: "left" },
  "image-right": { label: "Photo right · text left",     img: "right" },
  "overlay":     { label: "Title over photo",            img: "behind" },
  "text-only":   { label: "Text only · no photo",        img: "none" }
};
const FRONT_CARD_DEFAULT = "image-top";

/* Whole-page front templates. Each just supplies the DEFAULT card template for
   the cover slot (`lead`) and the secondary slots (`card`); a per-article
   override in front.cards always wins. */
const FRONT_TEMPLATES = {
  "standard": { label: "Standard — cover, 3-up, list",  lead: "classic",    card: "image-top" },
  "grid":     { label: "Grid — even photo cards",       lead: "image-top",  card: "image-top" },
  "river":    { label: "River — side-by-side rows",     lead: "image-left", card: "image-left" },
  "posters":  { label: "Posters — titles over photos",  lead: "overlay",    card: "overlay" }
};
const FRONT_TEMPLATE_DEFAULT = "standard";

function normalizeFront(raw) {
  const d = LAYOUT_DEFAULTS.front;
  if (!raw || typeof raw !== "object") return { template: d.template, order: [], cards: {} };
  const template = FRONT_TEMPLATES[raw.template] ? raw.template : d.template;
  const order = Array.isArray(raw.order) ? raw.order.filter(s => typeof s === "string" && s).map(String) : [];
  const cards = {};
  if (raw.cards && typeof raw.cards === "object") {
    for (const k of Object.keys(raw.cards)) {
      const v = raw.cards[k];
      if (typeof v === "string" && FRONT_CARD_TEMPLATES[v]) cards[k] = v;
    }
  }
  return { template, order, cards };
}

// The page template entry (always a valid object).
function frontTemplateOf(layout) {
  const f = (layout && layout.front) || {};
  return FRONT_TEMPLATES[f.template] || FRONT_TEMPLATES[FRONT_TEMPLATE_DEFAULT];
}
// The card template NAME for one article at a slot. An explicit per-article
// override wins; otherwise inherit the page template's default for the slot.
// position ∈ "lead" | "card".
function cardTemplateFor(layout, slug, position) {
  const f = (layout && layout.front) || {};
  const explicit = f.cards && f.cards[slug];
  if (explicit && FRONT_CARD_TEMPLATES[explicit]) return explicit;
  const tpl = frontTemplateOf(layout);
  const name = position === "lead" ? tpl.lead : tpl.card;
  return FRONT_CARD_TEMPLATES[name] ? name : FRONT_CARD_DEFAULT;
}
// Reorder a lineup by front.order: listed slugs first (in that order), then any
// remaining items in their incoming (newest-first) order. Unknown slugs ignored.
function orderFrontItems(items, front) {
  const order = (front && Array.isArray(front.order)) ? front.order : [];
  const list = Array.isArray(items) ? items : [];
  if (!order.length) return list.slice();
  const bySlug = new Map(list.map(it => [it.slug, it]));
  const out = [], used = new Set();
  order.forEach(slug => { const it = bySlug.get(slug); if (it && !used.has(slug)) { out.push(it); used.add(slug); } });
  list.forEach(it => { if (!used.has(it.slug)) { out.push(it); used.add(it.slug); } });
  return out;
}

function normalizeRoles(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(raw)) {
      const r = raw[k] === "admin" ? "admin" : raw[k] === "editor" ? "editor" : null;
      if (r && /^@[^:]+:[^:]+$/.test(k) && k !== SEED_ADMIN) out[k] = r;
    }
  }
  return out;
}

function normalizeSections(raw) {
  const d = LAYOUT_DEFAULTS.sections;
  if (!Array.isArray(raw) || !raw.length) return d.map(s => ({ ...s, publishers: [] }));
  return raw.map(s => {
    if (typeof s === "string") return { name: s, publishers: [] };
    return { name: String((s && s.name) || "Section"), publishers: Array.isArray(s && s.publishers) ? s.publishers.filter(Boolean).map(String) : [] };
  });
}

function normalizeLayout(raw) {
  const d = LAYOUT_DEFAULTS;
  if (!raw || typeof raw !== "object") return { ...d, sections: [...d.sections], taglines: [...d.taglines], utility: d.utility.map(u => ({ ...u })), front: normalizeFront(null), roles: {}, contributors: {} };
  const cleanNav = (n) => (["explore", "standards", "submit", "contributors"].includes(n) ? n : "submit");
  // tolerate the older `members: []` shape by upgrading it to editor roles
  let roles = normalizeRoles(raw.roles);
  if (Array.isArray(raw.members)) raw.members.forEach(m => { if (m && m !== SEED_ADMIN && !roles[m]) roles[m] = "editor"; });
  return {
    sections: normalizeSections(raw.sections),
    taglines: Array.isArray(raw.taglines) && raw.taglines.length ? raw.taglines.slice(0, 4).map(String) : [...d.taglines],
    utility: Array.isArray(raw.utility) && raw.utility.length
      ? raw.utility.map(u => ({ label: String(u.label || "Link"), nav: cleanNav(u.nav) }))
      : d.utility.map(u => ({ ...u })),
    brand: raw.brand && typeof raw.brand === "object" ? raw.brand : null,
    front: normalizeFront(raw.front),
    roles,
    contributors: normalizeContributors(raw.contributors)
  };
}

// Capability resolution. SEED_ADMIN is always admin.
function roleOf(layout, mxid) {
  if (!mxid) return null;
  if (mxid === SEED_ADMIN) return "admin";
  const roles = (layout && layout.roles) || {};
  return roles[mxid] || null;
}
function canPublish(layout, mxid) { return roleOf(layout, mxid) === "admin"; }
// May this mxid publish into a specific column? Admins publish anywhere; editors
// only into columns they're assigned to.
function canPublishColumn(layout, mxid, columnName) {
  if (canPublish(layout, mxid)) return true;
  if (roleOf(layout, mxid) !== "editor") return false;
  const col = ((layout && layout.sections) || []).find(s => s.name === columnName);
  return !!(col && (col.publishers || []).includes(mxid));
}
function canEdit(layout, mxid) { const r = roleOf(layout, mxid); return r === "admin" || r === "editor"; }
// May this mxid sign into the contributor tools at all?
function isMember(layout, mxid) { return roleOf(layout, mxid) != null; }

// The display name for a mxid: the curated/published name, else the localpart.
function nameOf(layout, mxid) {
  if (!mxid) return "";
  const p = ((layout && layout.contributors) || {})[mxid];
  return (p && p.name) || mxid.replace(/^@/, "").split(":")[0];
}
// The full public profile for a mxid — always resolves to a usable shape.
function profileOf(layout, mxid) {
  const p = ((layout && layout.contributors) || {})[mxid] || {};
  return { mxid, name: p.name || (mxid ? mxid.replace(/^@/, "").split(":")[0] : ""), bio: p.bio || "" };
}
// Fold the committed contributor profiles into the runtime people registry
// (window.NPJ.PEOPLE) so Handle, the byline and the masthead all read real
// names + bios. Merges (never deletes), and keeps a stable per-mxid color.
function applyContributorsToPeople(layout) {
  if (!window.NPJ || !window.NPJ.PEOPLE) return;
  const C = (layout && layout.contributors) || {};
  const color = (mx) => (window.NpjProfiles && window.NpjProfiles.colorFor) ? window.NpjProfiles.colorFor(mx) : "#6b6b6b";
  Object.keys(C).forEach(mx => {
    const prof = C[mx] || {};
    const prev = window.NPJ.PEOPLE[mx] || {};
    window.NPJ.PEOPLE[mx] = Object.assign({}, prev, {
      name: prof.name || prev.name || mx.replace(/^@/, "").split(":")[0],
      bio: prof.bio != null ? prof.bio : (prev.bio || ""),
      color: prev.color || color(mx)
    });
  });
}

function loadLayout() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_LS_KEY) || "null");
    return normalizeLayout(stored);
  } catch (e) { return normalizeLayout(null); }
}

function saveLayoutLocal(layout) {
  try { localStorage.setItem(LAYOUT_LS_KEY, JSON.stringify(layout)); } catch (e) { /* private mode */ }
}

// React context — App provides { layout, setLayout, isAdmin, isEditor, role, me, admin }.
const LayoutCtx = React.createContext({
  layout: normalizeLayout(null), setLayout: () => {}, isAdmin: false, isEditor: false,
  role: null, me: null, admin: SEED_ADMIN
});

// Reactive viewport hook — drives the mobile layouts (the newsroom especially).
// Inline-styled components can't lean on CSS media queries alone, so they read
// this. matchMedia, so it flips live on rotate / resize. Exposed on window so
// every babel file can call it bare.
function useIsMobile(maxWidth = 760) {
  const q = "(max-width: " + maxWidth + "px)";
  const [m, setM] = useState(() => (typeof window !== "undefined" && window.matchMedia) ? window.matchMedia(q).matches : false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, [q]);
  return m;
}

Object.assign(window, {
  LAYOUT_DEFAULTS, SEED_ADMIN, BIO_MAX, NAME_MAX, normalizeLayout, normalizeRoles, normalizeSections,
  normalizeContributors, loadLayout, saveLayoutLocal,
  roleOf, canPublish, canPublishColumn, canEdit, isMember, nameOf, profileOf, applyContributorsToPeople,
  LayoutCtx, useIsMobile,
  FRONT_CARD_TEMPLATES, FRONT_CARD_DEFAULT, FRONT_TEMPLATES, FRONT_TEMPLATE_DEFAULT,
  normalizeFront, frontTemplateOf, cardTemplateFor, orderFrontItems
});
