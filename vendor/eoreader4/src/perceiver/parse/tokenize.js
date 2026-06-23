// The single tokenizer. Everything in the system that needs tokens goes
// through here. Drift between the index and retrieval is impossible.

const STOP = new Set([
  'the','a','an','of','to','in','on','at','for','with','and','or','but','if','as','by','from','into','over','under',
  'is','are','was','were','be','been','being','am','have','has','had','do','does','did','done',
  'this','that','these','those','i','you','he','she','it','we','they','them','us','me','him','her','my','your','our','their','his','its',
  'will','would','can','could','should','may','might','must','shall','not',
]);

export const tok = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length > 1 && !STOP.has(t));

export const tokSet = (text) => new Set(tok(text));

export const isStop = (t) => STOP.has(String(t).toLowerCase());
