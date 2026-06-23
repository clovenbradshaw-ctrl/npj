// Front-matter metadata — the document's bibliographic header, read off its SHAPE.
//
// A human-language document conventionally opens with a block of LABELED FIELDS:
// "Title: …", "Author: …", "Release date: …" in book front matter; "From: / To: /
// Subject: / Date:" in an email or memo; a citation block, a manuscript title page.
// The pattern is the same everywhere, and it is STRUCTURAL, not semantic: a short
// set-off line whose key is a leading capitalized label, whose mark is a colon, and
// whose value is the rest of the line. We read that shape — we do NOT match a
// whitelist of "real" titles — exactly as frame.js reads a banner's SHAPE (a run of
// asterisks) rather than the words "Project Gutenberg". The colon is the field's
// banner; the label is the key; the line's tail is the value.
//
// This is the harvest the frame was throwing away. frame.js already HOLDS the front
// matter (the licence header, the title block) as frame so it never enters the graph
// as a figure; here we read that block's STRUCTURE and take note of what it says. The
// field LABELS are learned into the conventions ledger (the field-label register — a
// header that runs on "Composer:" teaches that label as a document teaches a speech
// verb); the harvested VALUES are the document's own facts — a structural thing to
// take note of.
//
// Read off RAW LINES, not the segmented sentences. Metadata is a LAYOUT property: a
// header line carries no terminal punctuation, so the sentence splitter glues the
// whole block into one run ("To: … From: … Date: …") and the structure is lost. The
// raw line is where the field actually lives — one line, one field — so that is what
// we read, the same bytes the layout was written in.
//
// Conservative by construction, like the frame. In a FRAMED document the window is
// everything before the banner that opens the body (the front matter, bracketed).
// UNFRAMED, it engages only on a CONTIGUOUS block of ≥2 field lines at the very top
// (an email/memo header). Either way the harvest is accepted only when the block
// holds a KNOWN field label or at least two fields — so a lone mid-prose colon ("She
// had one goal: survival.") or a stray heading is never mistaken for a header. With
// no such block it harvests NOTHING and the parse is unchanged.

const MAX_LABEL_WORDS = 4;
const MAX_LABEL_CHARS = 40;
const FRONT_MAX = 30;        // unframed, the header sits near the top; do not scan past it
const BLOCK_START_MAX = 8;   // …and begins within the first few lines
const BODY_MAJORITY = 0.25;  // a framed body must be a clear bulk, or we treat as unframed

// The structural mark: a leading capitalized label of ≤4 words, a colon, then a
// value. The label class admits letters/digits and the in-word marks a label carries
// (".&'-/") but NOT the colon, bracket, or hash — so a date value ("…[eBook #5200]")
// or a time ("12:30") cannot be read as a label.
const LABEL = String.raw`[A-Z][A-Za-z0-9.&'’\/-]*(?:\s+[A-Za-z0-9.&'’\/-]+){0,${MAX_LABEL_WORDS - 1}}`;
const FIELD = String.raw`(?:^|\s)(${LABEL})\s*:\s+`;

// Canonical metadata keys — the small normalization from a label's surface form to a
// stable key, so "Release date" / "Publication date" / "Published" all answer `date`
// and "By" / "Written by" answer `author`. This is presentation, not a language
// convention: the LABELS live in the ledger (field-label), this only names the key a
// caller reads off doc.metadata. An unmapped label keeps its own normalized form.
const CANON = new Map([
  ['title', 'title'], ['subtitle', 'subtitle'],
  ['author', 'author'], ['authors', 'author'], ['by', 'author'], ['writer', 'author'],
  ['written by', 'author'], ['creator', 'author'], ['creators', 'author'],
  ['editor', 'editor'], ['edited by', 'editor'],
  ['translator', 'translator'], ['translated by', 'translator'], ['translation', 'translator'],
  ['illustrator', 'illustrator'], ['contributor', 'contributor'],
  ['credits', 'credits'], ['produced by', 'producer'], ['producer', 'producer'],
  ['publisher', 'publisher'], ['publication', 'publisher'], ['published by', 'publisher'],
  ['imprint', 'publisher'],
  ['date', 'date'], ['release date', 'date'], ['publication date', 'date'],
  ['published', 'date'], ['posted', 'date'], ['posted on', 'date'], ['pubdate', 'date'],
  ['updated', 'updated'], ['last updated', 'updated'], ['most recently updated', 'updated'],
  ['revised', 'updated'],
  ['language', 'language'], ['lang', 'language'],
  ['source', 'source'], ['origin', 'source'],
  ['subject', 'subject'], ['subjects', 'subject'], ['topic', 'subject'],
  ['keywords', 'subject'], ['re', 'subject'],
  ['rights', 'rights'], ['copyright', 'rights'], ['license', 'rights'], ['licence', 'rights'],
  ['from', 'from'], ['sender', 'from'], ['to', 'to'], ['recipient', 'to'],
  ['cc', 'cc'], ['bcc', 'bcc'],
  ['isbn', 'isbn'], ['issn', 'issn'], ['doi', 'doi'], ['url', 'url'],
  ['volume', 'volume'], ['edition', 'edition'], ['series', 'series'], ['genre', 'genre'],
  ['composer', 'composer'], ['director', 'director'], ['artist', 'artist'], ['performer', 'performer'],
]);

const norm = (s) => String(s || '').toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ').trim();
const canonKey = (label) => CANON.get(norm(label)) || norm(label);
const isBanner = (s) => /\*{3,}/.test(String(s || ''));
const isGap = (s) => { const t = String(s || '').trim(); return t.length < 3 || isBanner(t); };

// Split one line into the labeled fields it carries — usually one. A line that
// collapses two ("Title: X  Author: Y") yields both; each field's value runs to the
// next label or the line end, and a trailing bracket note ("[eBook #5200]") is
// stripped. If a multi-field split would leave an empty value, the later colons were
// inside a value, not field breaks — fall back to the first label with the whole
// remainder ("Subject: Meeting: notes" → one field).
export const splitFields = (line) => {
  const s = String(line || '');
  const ms = [...s.matchAll(new RegExp(FIELD, 'g'))];
  if (!ms.length) return [];
  const clean = (v) => v.trim().replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const parts = ms.map((m, i) => ({
    label: m[1].trim(),
    value: clean(s.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : s.length)),
  }));
  if (parts.length > 1 && parts.some(p => !p.value)) {
    const label = ms[0][1].trim();
    const value = clean(s.slice(ms[0].index + ms[0][0].length));
    return label.length <= MAX_LABEL_CHARS && value ? [{ label, value }] : [];
  }
  return parts.filter(p => p.value && p.label.length <= MAX_LABEL_CHARS);
};

// The front-matter window in RAW LINE indices, or [] to abstain.
//   framed   — ≥2 banner lines bracket a body that is a clear bulk: the front matter
//              is every line BEFORE the banner that opens it (the largest banner gap),
//              the same structure frame.js reads, in line space.
//   unframed — no such bracket: a CONTIGUOUS block of ≥2 field lines at the very top,
//              blank/degenerate gaps tolerated, the first prose line closing it.
const frontMatterWindow = (lines) => {
  const n = lines.length;
  const banners = [];
  for (let i = 0; i < n; i++) if (isBanner(lines[i])) banners.push(i);

  if (banners.length >= 2) {
    let lo = -1, hi = -1, span = -1;
    for (let k = 1; k < banners.length; k++) {
      const gap = banners[k] - banners[k - 1];
      if (gap > span) { span = gap; lo = banners[k - 1]; hi = banners[k]; }
    }
    if (lo > 0 && (hi - lo - 1) >= n * BODY_MAJORITY) {
      const idx = [];
      for (let i = 0; i < lo; i++) idx.push(i);   // everything before the body-opening banner
      return idx;
    }
  }

  // Unframed: the contiguous top block.
  const limit = Math.min(FRONT_MAX, n);
  let first = -1;
  for (let i = 0; i < limit; i++) if (splitFields(lines[i]).length) { first = i; break; }
  if (first < 0 || first > BLOCK_START_MAX) return [];
  let end = first, count = 0;
  for (let i = first; i < limit; i++) {
    if (splitFields(lines[i]).length) { end = i; count++; continue; }
    if (isGap(lines[i])) continue;
    break;
  }
  if (count < 2) return [];
  const idx = [];
  for (let i = first; i <= end; i++) idx.push(i);
  return idx;
};

// Read the document's front-matter metadata from its raw `text`. `conventions` is the
// ledger, into which each accepted field LABEL is learned (the field-label register).
// Returns { fields, byKey }: `fields` the harvested list in reading order (each with
// its raw `line`), `byKey` the first value per canonical key — the shape doc.metadata
// exposes. Harvests nothing unless the window holds a KNOWN label or ≥2 fields.
export const extractMetadata = (text = '', { conventions = null } = {}) => {
  const lines = String(text || '').split(/\r?\n/);
  const window = frontMatterWindow(lines);
  const fields = [];
  for (const i of window)
    for (const f of splitFields(lines[i]))
      fields.push({ label: f.label, value: f.value, line: i });
  if (!fields.length) return { fields: [], byKey: {} };

  // Was each label known BEFORE we read it? (Captured before learning, which would
  // flip every label to 'learned'.) A seed answers true; a label this document invents
  // answers false. The harvest is trusted only if the block holds a known label or ≥2
  // fields — a header, not a stray colon.
  for (const f of fields)
    f.known = !!(conventions && conventions.isFieldLabel && conventions.isFieldLabel(f.label));
  if (fields.length < 2 && !fields.some(f => f.known)) return { fields: [], byKey: {} };

  for (const f of fields) {
    f.key = canonKey(f.label);
    if (conventions && conventions.learn) conventions.learn('field-label', f.label);
  }

  const byKey = {};
  for (const f of fields) if (!(f.key in byKey)) byKey[f.key] = f.value;
  return { fields, byKey };
};
