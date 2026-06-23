// Significance as predictive coding — the LLM-in-the-loop surprise.
//
// The mechanical surprisal in `reading.js` is the instant baseline. This is the
// real significance pass the reader is meant to run: read the passage so far,
// ask the model to *predict the next line*, embed that prediction, and measure
// its distance to what the document actually says next. Surprise is the
// prediction error in embedding space — high when the text defies the model's
// expectation, low when it confirms it.
//
//   past ─model─▶ predicted next ─embed─┐
//                                        ├─ cosine ─▶ surprise = 1 − similarity
//   actual next ──────────────────embed─┘
//
// Async (a model call + two embeddings), so it runs in reading mode where a
// per-step model call is affordable — not in the synchronous parse.

export const predictNext = async (doc, cursor, { model, embedder, window = 4 } = {}) => {
  const units = doc.units || doc.sentences || [];
  const at = Math.max(0, Math.min(units.length - 1, cursor | 0));
  if (!model || !embedder || at + 1 >= units.length) return null;

  const past = units.slice(Math.max(0, at - window + 1), at + 1).join(' ');
  const actual = units[at + 1];

  const messages = [
    { role: 'system', content: 'You are reading a document. Predict the very next sentence that follows. Reply with one short sentence only — the prediction itself, nothing else.' },
    { role: 'user', content: `Passage so far:\n${past}\n\nThe next sentence is:` },
  ];

  const prediction = String(await model.phrase(messages, { maxTokens: 48 }) || '').trim();
  if (!prediction) return null;

  const [pv, av] = await Promise.all([embedder.embed(prediction), embedder.embed(actual)]);
  const similarity = cosine(pv, av);
  const surprise = clamp(1 - similarity, 0, 1);

  return { cursor: at, prediction, actual, similarity, surprise };
};

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
