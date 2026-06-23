// Text ingestion. Reads the file, parses it, attaches a lazy sentence-
// embedding cache. Anything beyond plain text (PDF, audio, OCR) belongs
// in an adapter that turns its modality into text; the spine stays the same.

import { parseText }    from '../../perceiver/parse/index.js';
import { projectGraph } from '../../core/index.js';
import { areDisjoint }  from '../../core/index.js';

export const ingestText = async (file, opts = {}) => {
  const text  = typeof file === 'string' ? file : await file.text();
  const name  = typeof file === 'string' ? `doc-${Date.now()}` : (file.name || `doc-${Date.now()}`);
  // Inject the role-conflict predicate here, the one layer allowed to see both
  // holons: parse stays a leaf, and the standing-descriptor trigger consults the
  // typing bridge's algebra (sister ⟂ mother) without ever importing it. The
  // sentinel is the CHARGE/VALENCE force: `rolesConflict: false` turns it OFF, so a
  // harness can confirm the forbidden-relation gate trips when exclusivity is gone.
  const rolesConflict = opts.rolesConflict === false ? () => false
    : (typeof opts.rolesConflict === 'function' ? opts.rolesConflict : areDisjoint);
  const doc   = parseText(text, { docId: name, rolesConflict, corefOpts: opts.corefOpts });

  // The graph is a fold of the log. Expose it as a frame-parameterised
  // projection so the UI can re-weight around a reading cursor (γ decay)
  // without the parse holon knowing the UI exists. Memoised in core.
  doc.projectGraph = (frame = {}) => projectGraph(doc.log, frame);

  // Sentence embeddings are computed lazily and cached on the doc itself.
  // First caller pays the warmup; subsequent callers (retrieve, impression,
  // form) re-use the cache. The hot lexical path never invokes this.
  //
  // Cached PER EMBEDDER ORGAN: hash-space and MiniLM-space vectors are not
  // interchangeable, so a single cache keyed by nothing would hand a later MiniLM
  // caller the stale hash vectors the first caller computed — silently defeating the
  // retrieval upgrade. Key by organ id so each space is memoised independently.
  const vecByOrgan = new Map();
  doc.sentenceEmbeddings = async (embedder) => {
    const key = embedder?.id || 'default';
    if (!vecByOrgan.has(key)) vecByOrgan.set(key, Promise.all(doc.sentences.map(s => embedder.embed(s))));
    return vecByOrgan.get(key);
  };

  return doc;
};
