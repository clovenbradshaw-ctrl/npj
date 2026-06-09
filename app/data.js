/* NPJ data layer — FRAMEWORK ONLY.
   All sample/demo content was removed for the public GitHub launch. The app
   now boots empty: no articles, sources, suggestions, datasets or feeds ship in
   the repo. Editors populate everything from the Newsroom + Submit flows, and
   layout config is curated by a verified admin (see app/layout.jsx).

   What stays here is structural and content-free:
   • the EO §2.2 operator table + eoEvent() — the notation the app is built on
   • empty seed collections with the exact shapes the components expect
   • the helpers (articlePlainText, gazetteer) the eoreader3 engine reads
   Attached to window.NPJ. */
(function () {
  // ---- Source records (every src: key resolves here) — populated at runtime
  const SOURCES = {};

  // ---- The lead article — null until something is published.
  //      Shape, for reference: { slug, kicker, headline, dek, byline, authors[],
  //      published, base_sha, readMins, body[] } where each body block is
  //      { type:'p', tokens:[ "text" | {c,src[],id} ] } or { type:'pull', text, attribution }.
  const ARTICLE = null;

  // ---- Suggestions (EVA deposits against claims) — empty until readers act.
  //      status: proposed | review | accepted | rejected
  const SUGGESTIONS = [];

  // ---- Front-page line-up — no lead, no secondary, no briefs yet.
  const FRONT = { lead: null, secondary: [], briefs: [] };

  // ---- People (trust graph) — filled as real Matrix IDs sign in.
  //      Shape: "@mxid": { name, role, trust: editor|preferred|open, color }
  const PEOPLE = {};

  // ---- EO notation — authoritative §2.2 glyph table (framework, not content) --
  // op(target, operand). Three triads. Helix order is dependency, not sequence.
  const EO = {
    operators: [
      { code: "NUL", glyph: "∅", greek: "ν", triad: "Existence",    fn: "Non-transformation. Encounter without change.", logs: false },
      { code: "SIG", glyph: "○", greek: "σ", triad: "Existence",    fn: "Attention. Set the subject.", logs: false },
      { code: "INS", glyph: "●", greek: "α", triad: "Existence",    fn: "Instantiation. Mint an enduring anchor.", logs: true },
      { code: "SEG", glyph: "｜", greek: "κ", triad: "Structure",    fn: "Segmentation. Draw a boundary; the query operator.", logs: true },
      { code: "CON", glyph: "⋈", greek: "ε", triad: "Structure",    fn: "Connection. Relate across a boundary. The JOIN.", logs: true },
      { code: "SYN", glyph: "△", greek: "η", triad: "Structure",    fn: "Synthesis. A whole exceeding its parts. GROUP BY.", logs: true },
      { code: "DEF", glyph: "⊢", greek: "δ", triad: "Significance", fn: "Definition. Set terms within a stable frame.", logs: true },
      { code: "EVA", glyph: "⊨", greek: "ψ", triad: "Significance", fn: "Evaluation. Test a particular against DEF's terms.", logs: true },
      { code: "REC", glyph: "⊛", greek: "Ω", triad: "Significance", fn: "Recontextualization. Restructure the frame itself.", logs: true }
    ],
    glyph(code) { const o = this.operators.find(o => o.code === code); return o ? o.glyph : "?"; }
  };

  // Build the canonical event string for a suggestion (an EVA deposit).
  // Reads window.NPJ.ARTICLE (not the shipped null above) — articles are now
  // loaded at runtime from their committed EO logs (app/articles.js).
  function eoEvent(s) {
    const A = window.NPJ.ARTICLE;
    const slug = (A && A.slug) || "untitled";
    const base = (A && A.base_sha) || "0000000";
    const range = s.range ? `[${s.range[0]},${s.range[1]}]` : "";
    const target = `${slug}@${base}${range}`;
    const operand = JSON.stringify(s.proposed);
    return {
      op: "EVA",
      target,
      operand,
      target_path: `article/${slug}/claim/${s.claimId}`,
      string: `EVA(${target}, ${operand})`,
      // resolution folds the deposit: accept→REC, reject→NUL, else pending
      resolves: s.status === "accepted" ? "REC" : s.status === "rejected" ? "NUL" : null
    };
  }

  window.NPJ = { SOURCES, ARTICLE, SUGGESTIONS, FRONT, PEOPLE, EO, eoEvent };

  // ---- Feeds: NPJ is the flagship; communities run their own. The flagship
  //      entry is structural (the publication itself), so the composer always
  //      has a publish target. It ships with no stories.
  const FEEDS = [
    { id: "npj", name: "People's Journalism", handle: "@npj", kind: "flagship", accent: "#ffec01",
      tagline: "community-created · community-backed · community-edited", followers: 0, members: [], stories: [] }
  ];

  // ---- Datasets: citeable across projects — empty until editors ingest data.
  const DATASETS = [];

  window.NPJ.FEEDS = FEEDS;
  window.NPJ.DATASETS = DATASETS;

  // Plain prose of the article body — fed to the eoreader3 engine for
  // entity/prominence extraction. Returns "" when nothing is published.
  // Reads the LIVE article (window.NPJ.ARTICLE is set by the EO log loader).
  window.NPJ.articlePlainText = function () {
    const A = window.NPJ.ARTICLE;
    if (!A || !Array.isArray(A.body)) return "";
    if (window.NpjArticles) return window.NpjArticles.plainText(A.body);
    return A.body.filter(b => b.type === "p")
      .map(b => b.tokens.map(t => (typeof t === "string" ? t : (t.c != null ? t.c : t.text || ""))).join(""))
      .join("\n\n");
  };

  // Domain gazetteer: corrects compromise's NER guesses for known entities and
  // drops non-figure terms. Empty by default — add "name": "person|place|org|drop"
  // pairs to tune extraction for your beat. Applied AFTER prominence projection.
  window.NPJ.gazetteer = {};
})();
