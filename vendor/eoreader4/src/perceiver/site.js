// Site vs figure — chrome as a semantic role, not a list of conventions.
//
// A unit is a *site* (ground/furniture: a heading, a licence line, a credit)
// when its semantic role is to frame rather than to carry a figure. We do not
// pattern-match that — we read it off two role signals:
//
//   1. it anchors no figure — no INS/CON/SIG lands on the line, and
//   2. it sits off the document's distribution — its embedding is far from the
//      body's centroid (boilerplate vocabulary is off-manifold from the prose).
//
// When both hold, we DEF the unit's role as `site` (an assertion in the log,
// auditable), rather than silently dropping it. The mini-LLM / embedder is the
// organ that reads the role; with a stronger embedder the judgement sharpens.
// It is a weight thresholded, not a verdict: tune `cut`, not a regex.

export const siteRoles = (units, vecs, anchored, cut = 0.16) => {
  const centroid = mean(vecs);
  const roles = [];
  for (let i = 0; i < units.length; i++) {
    const toBody = cosine(vecs[i], centroid);   // how on-distribution the unit is
    const carries = anchored.has(i);
    // Off the body's manifold and carrying no figure → it frames, not narrates.
    const site = !carries && toBody < cut;
    roles.push({ idx: i, role: site ? 'site' : 'figure', toBody, carries });
  }
  return roles;
};

// Apply the role pass to a doc: embed its units, read each role, and DEF the
// sites. Async because reading a role is the embedder's job. Idempotent-ish:
// it appends DEF role events; downstream skips units already marked site.
export const markSites = async (doc, embedder, cut = 0.16) => {
  if (!embedder || typeof doc.sentenceEmbeddings !== 'function') return [];
  const units = doc.units || doc.sentences || [];
  const vecs = await doc.sentenceEmbeddings(embedder);
  const anchored = new Set(
    doc.log.filter(e => e.op === 'INS' || e.op === 'CON' || e.op === 'SIG').map(e => e.sentIdx),
  );
  const already = new Set(
    doc.log.filter(e => e.op === 'DEF' && e.key === 'role' && e.value === 'site').map(e => e.sentIdx),
  );
  const roles = siteRoles(units, vecs, anchored, cut);
  const sites = [];
  for (const r of roles) {
    if (r.role === 'site' && !already.has(r.idx)) {
      doc.log.append({ op: 'DEF', id: `unit:${r.idx}`, key: 'role', value: 'site', sentIdx: r.idx });
      sites.push(r.idx);
    }
  }
  return sites;
};

// The set of unit indices the document has DEF'd as sites — for retrieval and
// the fold to skip when grounding the talker.
export const siteIndices = (doc) => new Set(
  (doc.log.filter ? doc.log.filter(e => e.op === 'DEF' && e.key === 'role' && e.value === 'site') : [])
    .map(e => e.sentIdx),
);

const mean = (vecs) => {
  if (!vecs.length) return [];
  const n = vecs[0].length;
  const out = new Float64Array(n);
  for (const v of vecs) for (let i = 0; i < n; i++) out[i] += v[i];
  for (let i = 0; i < n; i++) out[i] /= vecs.length;
  return out;
};

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
};
