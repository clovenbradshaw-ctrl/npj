/* ============================================================
   pii.js — the pii-v1 recognizer pack. Citey's mechanical PII layer. NO MODEL.

   Citey's first real job is to surface candidate PII in a document BEFORE it is
   archived to archive.org (permanent, all-or-nothing, undeletable), so the
   author can hard-redact what shouldn't be public — or consciously affirm it.

   This is the DECISION layer for that job, and it honours the same discipline as
   CiteyBrain: the intelligence is mechanical, never a language model. It is a
   small, Presidio-shaped recognizer set — each recognizer is a CONVENTION made of
   a regex, optional checksum/format validation, and context words — converted
   into a pii-v1 pack the way Readability's heuristics would be. Every finding
   carries a `basis` (which recognizer fired, and why), so a redaction event can
   record WHY a span was flagged: the audit trail the ledger wants.

   Evaluation stance, per Presidio: optimise for RECALL over precision (missing
   PII costs more than over-flagging). Findings are surfaced generously and scored;
   the AUTHOR decides each one. No de-identification is perfect — this is a first
   pass that surfaces candidates, never a guarantee. The maintainers' own caveat
   is the operative fact for source protection.

   Plain script — publishes window.NpjPII. No network, no model, no autonomy.
   ============================================================ */
(function (root) {
  'use strict';

  var BASIS = 'pii-v1';                       // the pack; recognizers add their own clause
  var MAX_SCAN = 200000;                      // don't choke the main thread on a giant paste

  /* ---------------- validators (cheap checksums / format gates) ---------------- */
  function digits(s) { return (String(s).match(/\d/g) || []).length; }
  function luhn(s) {
    var n = String(s).replace(/\D/g, ''); if (n.length < 12) return false;
    var sum = 0, alt = false;
    for (var i = n.length - 1; i >= 0; i--) {
      var d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt;
    }
    return sum % 10 === 0;
  }
  function ssnValid(s) {
    var m = String(s).replace(/\D/g, ''); if (m.length !== 9) return false;
    var area = m.slice(0, 3), grp = m.slice(3, 5), ser = m.slice(5);
    if (area === '000' || area === '666' || area[0] === '9') return false;   // never-issued ranges
    if (grp === '00' || ser === '0000') return false;
    return true;
  }
  function ipv4Valid(s) { return String(s).split('.').every(function (o) { return o.length && +o <= 255; }); }
  function ibanValid(s) {
    var v = String(s).replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
    var re = v.slice(4) + v.slice(0, 4);
    var expanded = re.replace(/[A-Z]/g, function (c) { return (c.charCodeAt(0) - 55).toString(); });
    var rem = 0; for (var i = 0; i < expanded.length; i++) rem = (rem * 10 + (+expanded[i])) % 97;
    return rem === 1;
  }

  /* ---------------- the pii-v1 pack: data-shaped recognizers ----------------
     Each: { type, label, basis, score, re, valid?, context?, ctxBoost?, ctxGated? }
       • re        — global regex; match.index/[0] give the span + offsets
       • valid     — checksum/format gate; a fail DROPS the candidate (precision)
       • context   — lemma-ish words near the span that raise confidence (Presidio
                     LemmaContextAwareEnhancer, done mechanically)
       • ctxGated  — only fire when a context word is near (kills generic-number noise)
     Frozen Presidio defaults are revisable here without touching the engine. */
  var TITLES = '(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sen|Rep|Gov|Mayor|Officer|Det|Sgt|Capt|Lt|Col|Judge|Justice|Atty|Rev|Fr|Sr|Jr)\\.?';
  var PACK = [
    { type: 'EMAIL_ADDRESS', label: 'Email address', basis: BASIS + ':EmailRecognizer', score: 0.95,
      re: /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,24}/gi },

    { type: 'CREDIT_CARD', label: 'Credit-card number', basis: BASIS + ':CreditCardRecognizer', score: 0.9,
      re: /\b(?:\d[ \-]?){13,19}\b/g, valid: function (s) { var d = digits(s); return d >= 13 && d <= 19 && luhn(s); } },

    { type: 'US_SSN', label: 'US Social Security number', basis: BASIS + ':UsSsnRecognizer', score: 0.85,
      re: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, valid: ssnValid, context: ['ssn', 'social security'], ctxBoost: 0.1 },

    { type: 'PHONE_NUMBER', label: 'Phone number', basis: BASIS + ':PhoneRecognizer', score: 0.55,
      re: /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.\-]\d{2,4}[\s.\-]\d{2,4}(?:[\s.\-]\d{2,4})?/g,
      valid: function (s) { var d = digits(s); return d >= 7 && d <= 15; },
      context: ['phone', 'call', 'tel', 'mobile', 'cell', 'fax', 'text', 'reach', 'contact'], ctxBoost: 0.3 },

    { type: 'IBAN_CODE', label: 'IBAN / bank account', basis: BASIS + ':IbanRecognizer', score: 0.75,
      re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, valid: ibanValid },

    { type: 'IP_ADDRESS', label: 'IP address', basis: BASIS + ':IpRecognizer', score: 0.6,
      re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, valid: ipv4Valid,
      context: ['ip', 'address', 'logged', 'login', 'server', 'host'], ctxBoost: 0.2 },

    { type: 'GOVERNMENT_ID', label: 'Government / ID number', basis: BASIS + ':IdRecognizer (context-gated)', score: 0.5,
      re: /\b[A-Z]{0,2}\d[\dA-Z\-]{5,16}\b/g, valid: function (s) { return digits(s) >= 5; }, ctxGated: true,
      context: ['passport', 'license', 'licence', 'id no', 'id number', 'badge', 'permit', 'visa', 'case no', 'inmate', 'employee id', 'account'] },

    { type: 'DATE_OF_BIRTH', label: 'Date (possible DOB)', basis: BASIS + ':DateRecognizer', score: 0.35,
      re: /\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi,
      context: ['born', 'birth', 'dob', 'd.o.b', 'date of birth', 'age', 'aged'], ctxBoost: 0.4 },

    { type: 'STREET_ADDRESS', label: 'Street address', basis: BASIS + ':AddressRecognizer (heuristic)', score: 0.55,
      re: /\b\d{1,6}\s+(?:[A-Z][A-Za-z'.\-]+\s){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Suite|Ste|Apt|Unit)\b\.?/g },

    // PERSON — mechanical NER stand-in (capitalised runs + personal titles), the
    // way citey-assist surfaces entities. Recall-favouring but low-confidence: in
    // journalism a name is often the point, so the author keeps most and redacts
    // the source-identifying few. Sentence-start single words are dropped.
    { type: 'PERSON', label: 'Person name', basis: BASIS + ':NerStandIn (mechanical, no model)', score: 0.4,
      re: new RegExp('\\b' + TITLES + '\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2}|\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,2}\\b', 'g'),
      titled: new RegExp('^' + TITLES + '\\s', '') }
  ];

  // Words that, standing alone as a Title Case run, are almost never a person.
  var PERSON_STOP = new Set(('The This That These Those United States America American Monday Tuesday Wednesday Thursday '
    + 'Friday Saturday Sunday January February March April May June July August September October November December '
    + 'Street Avenue Road North South East West City County State Department Police Court House Senate Congress '
    + 'University College Company Inc Corp Mr Mrs Ms Dr President Director Officer').split(/\s+/));

  function contextHit(text, start, end, words) {
    if (!words || !words.length) return false;
    var win = text.slice(Math.max(0, start - 42), start).toLowerCase()
            + ' ' + text.slice(end, Math.min(text.length, end + 42)).toLowerCase();
    return words.some(function (w) { return win.indexOf(w) >= 0; });
  }

  function personOk(text, m) {
    var span = m[0];
    if (PACK[PACK.length - 1].titled.test(span)) return true;            // titled → a person
    if (/\s/.test(span.trim())) {                                        // multi-word Title Case
      var head = span.trim().split(/\s+/)[0];
      if (PERSON_STOP.has(head)) return false;
      // a capitalised run that opens a sentence is likely just a sentence start
      var before = text.slice(Math.max(0, m.index - 2), m.index);
      if (/[.!?]\s$/.test(before) || m.index === 0) {
        // still keep if every token is Title Case AND not in the stoplist
        return span.trim().split(/\s+/).every(function (w) { return !PERSON_STOP.has(w); });
      }
      return true;
    }
    return false;
  }

  /* ---------------- detect: run the pack, score, resolve overlaps ---------------- */
  function detect(input) {
    var text = String(input == null ? '' : input);
    if (text.length > MAX_SCAN) text = text.slice(0, MAX_SCAN);
    if (!text.trim()) return [];
    var found = [];
    PACK.forEach(function (rec) {
      var re = rec.re; re.lastIndex = 0; var m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        var start = m.index, end = start + m[0].length, value = m[0];
        if (rec.valid && !rec.valid(value)) continue;
        if (rec.type === 'PERSON' && !personOk(text, m)) continue;
        var ctx = contextHit(text, start, end, rec.context);
        if (rec.ctxGated && !ctx) continue;                              // generic-id noise gate
        var score = rec.score + (ctx ? (rec.ctxBoost || 0.1) : 0);
        if (score > 0.99) score = 0.99;
        found.push({ type: rec.type, label: rec.label, basis: rec.basis, recognizer: rec.type,
          start: start, end: end, text: value, score: score, context: ctx });
      }
    });
    return resolve(found);
  }

  // Overlap resolution: keep the strongest (then longest) span; drop anything it
  // covers. Sorted by document order for rendering.
  function resolve(found) {
    found.sort(function (a, b) { return b.score - a.score || (b.end - b.start) - (a.end - a.start); });
    var kept = [];
    found.forEach(function (f) {
      if (kept.some(function (k) { return f.start < k.end && k.start < f.end; })) return;
      kept.push(f);
    });
    kept.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return kept;
  }

  /* ---------------- redact: HARD, offset-preserving block ----------------
     Replace each non-whitespace character in the range with █ (whitespace kept),
     so the span is destroyed in the bytes that will be archived, the length is
     preserved (any pinned-citation char offsets into this source stay valid), and
     the redaction reads as a block. Ranges may overlap / be unsorted. */
  var BLOCK = '█';
  function redactText(input, ranges) {
    var text = String(input == null ? '' : input);
    var rs = (ranges || []).filter(function (r) { return r && r.end > r.start; })
      .map(function (r) { return { start: Math.max(0, r.start | 0), end: Math.min(text.length, r.end | 0) }; })
      .sort(function (a, b) { return b.start - a.start; });
    rs.forEach(function (r) {
      var block = text.slice(r.start, r.end).replace(/\S/g, BLOCK);
      text = text.slice(0, r.start) + block + text.slice(r.end);
    });
    return text;
  }
  function isRedacted(s) { return BLOCK.charCodeAt(0) === 0x2588 && String(s || '').indexOf(BLOCK) >= 0; }

  /* ---------------- summary + gate helpers ---------------- */
  function summarize(findings) {
    var by = {};
    (findings || []).forEach(function (f) { (by[f.type] = by[f.type] || { type: f.type, label: f.label, count: 0, max: 0 }).count++; by[f.type].max = Math.max(by[f.type].max, f.score); });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.count - a.count; });
  }
  function band(score) { return score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low'; }

  // The archive gate, read off a source record's review state. A source clears
  // the gate only once the author has been THROUGH Citey's review — every finding
  // either hard-redacted or consciously affirmed (kept public), or the document
  // marked reviewed-clean.  → 'reviewed' | 'pending' | 'unscanned'
  function reviewState(rec) {
    var r = rec && rec.piiReview;
    if (!r) return 'unscanned';
    return r.state === 'reviewed' ? 'reviewed' : 'pending';
  }
  function gateClear(rec) { return reviewState(rec) === 'reviewed'; }

  root.NpjPII = {
    BASIS: BASIS, BLOCK: BLOCK, PACK: PACK,
    detect: detect, redactText: redactText, isRedacted: isRedacted,
    summarize: summarize, band: band, contextHit: contextHit,
    reviewState: reviewState, gateClear: gateClear,
    luhn: luhn, ssnValid: ssnValid, ibanValid: ibanValid
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjPII;
})(typeof window !== 'undefined' ? window : this);
