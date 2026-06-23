// parseText / createParser — text → doc.
//
// The factory form is the engine reality: the parser instance owns its
// language module state and transcript-active flag. The state stays at
// the holon boundary, never at module scope. (engine.js:4228 mutates
// LANGUAGE_MODULES and TRANSCRIPT_ACTIVE from a module-scoped `let` —
// that's what we don't do here.)
//
// `parseText(text, opts)` is the one-shot convenience: it spins up a
// fresh parser and parses once. Use `createParser(opts)` when the same
// configuration needs to be applied to multiple texts in sequence, or
// when state ownership matters for testing.

import { createLog }            from '../../core/index.js';
import { VERDICTS }             from '../../core/index.js';
import { segmentSentences }     from './sentences.js';
import { induceBoundaries }     from './boundaries.js';
import { isChrome }             from './chrome.js';
import { frameSpan }            from './frame.js';
import { extractMetadata }      from './metadata.js';
import { createEntityAdmission }from './entities.js';
import { parseRelations, scanDescriptors } from './relations.js';
import { argumentSpanSeg }      from './proposition.js';
import { createCorefField }     from './coref.js';
import { discoverNamings }      from './naming.js';
import { tok }                  from './tokenize.js';
import { createConventions, induceAttributionVerbs } from '../../core/conventions/index.js';

// A pronoun-resolved descriptor owner ("his sister") is taken only when the prior
// field's top candidate outweighs the runner-up by this ratio — an unambiguous
// winner. Below it the descriptor is held with no owner, never a confident guess.
const DESC_OWNER_MARGIN = 2;

export const createParser = ({
  languageModules    = {},
  transcriptHandler  = null,
  chromeHint         = null,   // optional (sentence) → score nudge toward chrome
  // The role-conflict predicate for the standing-descriptor trigger. INJECTED by
  // the assembly layer (ingest), which is allowed to see both holons and backs it
  // with the typing bridge's areDisjoint. Parse never imports the algebra; the
  // default asserts no conflict, so a bare parse has no descriptor exclusivity.
  rolesConflict      = undefined,
  // The coref field's tuning — the CONFINEMENT WINDOW. The reach over which a
  // pronoun resolves (`maxDist`) and a standing role epithet can still bind a name
  // (`descMaxDist`, `descGamma`). INJECTED so a harness can sweep it without the
  // parser knowing why: too wide and wrong-owner relations bind, too narrow and the
  // long-range descriptor (a sibling named long after its epithet) never reaches.
  // The default is the coref field's own (a bare parse is unchanged).
  corefOpts          = undefined,
  // The coherence-strain threshold at which the boundary-induction loop RECs a
  // punctuation mark into a sentence boundary (parse/boundaries.js). The default is
  // deliberately conservative (a rare crisis); exposed so a test or a known dialect
  // can set its own sensitivity. Undefined → the loop's own default.
  boundaryThreshold  = undefined,
  // The core's learning layer (reshape §5), injectable so a harness can turn the
  // inherited priors OFF ({ seeds: false }) to prove the core still reads from
  // units alone (TEST 1), or feed sediment a prior read deposited ({ inherit }).
  // Default undefined → the seeded ledger; a bare parse is unchanged.
  conventionsOpts    = undefined,
  // Coordinated-subject reading (relations.js): when a clause coordinates two named
  // subjects onto one predicate ("Delgado and Reyes listed…"), bond EACH conjunct to
  // the shared object so the convergence reaches the graph as a length-two path. A
  // RULES_REV-style switch held OFF by default: with it off the single-subject scan is
  // byte-identical (the goldens are untouched); a harness flips it on to expose the
  // convergence the bond graph otherwise never sees.
  coordSubjects      = false,
} = {}) => {
  // State owned by this parser instance. Mutated by parse(); the mutation
  // is visible only inside the holon. Tests construct one parser per case.
  const state = {
    languageModules:  { ...languageModules },
    transcriptActive: false,
  };

  const parse = (text, { docId } = {}) => {
    const log         = createLog({ docId });
    // Conventions first — the home for the language-specific stuff. The splitter
    // reads its abbreviation list from the ledger, so segmentation already honours
    // "Mr. Darcy" before a single word is classified, and the relation parser
    // reads its copula/modifier/speech lists from the same place.
    const conventions = createConventions(conventionsOpts);
    // Before the first cut, let MEANING revise SYNTAX (parse/boundaries.js): the
    // DEF·EVA·REC coherence loop learns whether THIS document uses ':'/';' as
    // sentence boundaries — promoting one only when leaving it ignored fuses
    // propositions into run-on units that will not cohere (the KJV genealogies). The
    // learned marks are recorded as 'boundary' conventions, exactly as learned
    // abbreviations are, and flow into the splitter.
    const { extraBoundaries, recs: boundaryRecs } =
      induceBoundaries(text, {
        isAbbreviation: conventions.isAbbreviation,
        thresholds: boundaryThreshold != null ? { segmentation: boundaryThreshold } : undefined,
      });
    for (const r of boundaryRecs) conventions.learn('boundary', r.token, r.fused || 1);
    const sentences   = segmentSentences(text, { isAbbreviation: conventions.isAbbreviation, extraBoundaries });
    // Admission reads its language-specific word-classes (starters, prepositions,
    // role words, function words, auxiliaries) from the same conventions ledger the
    // splitter and relation parser use — seed ∪ what this document taught.
    const admission   = createEntityAdmission({ conventions });

    // Transcript detection — the handler is injected, not imported.
    if (transcriptHandler && transcriptHandler.detect && transcriptHandler.detect(text)) {
      state.transcriptActive = true;
      state.languageModules['transcript-v1'] = { enabled: true };
    } else {
      state.transcriptActive = false;
      if (state.languageModules['transcript-v1']) {
        state.languageModules['transcript-v1'] = {
          ...state.languageModules['transcript-v1'], enabled: false,
        };
      }
    }

    // Pass 0 — learn the document's conventions before reading it. Induced
    // attribution verbs become REC entries in the ledger and are written into
    // the log, so how *this* text marks speech biases every later sentence.
    // (The conventions ledger was created above, before segmentation.)
    for (const { token, count } of induceAttributionVerbs(sentences)) {
      conventions.learnAttribution(token, count);
    }

    // Structural frame: the head and tail OUTSIDE the body the banners bracket (the
    // licence header, the title block, the boilerplate footer). Read from the
    // document's own shape, embedder-free (parse/frame.js). The per-line loop below
    // holds it; the metadata harvest reads the same front matter from raw lines.
    const frame = frameSpan(sentences);

    // Pass 0 (cont.) — front-matter metadata (parse/metadata.js). Read the title
    // block's STRUCTURE — labeled fields, "Title:" / "Author:" / "Release date:" —
    // off the RAW LINES (a header carries no terminal punctuation, so the sentence
    // splitter would glue the block into one run): learn each field LABEL into the
    // ledger (the field-label register, so the document's own header vocabulary joins
    // what it taught the reader) and take note of the VALUES as the document's own
    // facts. Conservative — it harvests nothing without a clear header block.
    const metadata = extractMetadata(text, { conventions });

    for (const r of conventions.rules) log.append(r);

    // The harvested metadata as DEF notes on the log — a structural fact about the
    // DOCUMENT ("the title is X"), tagged kind:'meta', distinct from a per-unit role
    // DEF (key:'role'). Each fact is addressed under the DOCUMENT's own holon —
    // `<doc>.meta.<key>` — so the holon address reflects WHICH document it belongs to:
    // the title of one document is not the title of another, and the address keeps them
    // apart exactly as the namespaced referents do (organs/in/composite.js). Held
    // DEFEASIBLY: harvested front matter is a held theory, a DEF the reading can still
    // revise, not a collapsed axiom. The field lines are still held as frame below
    // (NUL → no figure); this only records what their structure says. The sentIdx is
    // the sentence carrying the value (for the trail) — best-effort, omitted when the
    // splitter glued it past recognition.
    const slugOf = (s) => String(s || '').trim().replace(/[.\s]+/g, '-').replace(/[^\w-]/g, '');
    const docSlug = slugOf(docId) || 'doc';
    for (const f of metadata.fields) {
      const keySlug = slugOf(f.key) || 'field';
      const sentIdx = f.value ? sentences.findIndex(s => s.includes(f.value)) : -1;
      log.append({ op: 'DEF', id: `${docSlug}.meta.${keySlug}`, kind: 'meta',
                   key: f.key, label: f.label, value: f.value, known: f.known,
                   defeasible: true, line: f.line, ...(sentIdx >= 0 ? { sentIdx } : {}) });
    }

    const isSpeech = (verb) => conventions.isAttributionVerb(verb);

    // Coreference is a field, not a decision. Each mention feeds a decaying
    // referent trace; a subject pronoun reads the field *as it stood before
    // this sentence* and the strongest candidate's weight becomes the bond's
    // coupling. Nothing is committed — the weight carries the uncertainty.
    const corefField = createCorefField({ ...corefOpts, ...(rolesConflict ? { rolesConflict } : {}) });
    // Derived descriptor edges (owner --role--> bearer) accumulate here and are
    // logged after the candidate relations — they are the trigger's output, marked
    // `derived` so the graph and the edge-grounding veto read them as defeasible.
    const derivedEdges = [];

    // Candidate relations are collected here and emitted AFTER the pass, so each
    // can be weighed by how often its verb recurs across the whole document (the
    // recurrence gate, move 3). INS/SYN still emit inline, in reading order.
    const candidates = [];

    // The arrow of time, tracked at instantiation: the LAST INS referent activated,
    // in reading order. A clause that resolves no subject defaults to it (the
    // genealogy's "and begat …" continues the patriarch just named, not whatever
    // has the most accumulated mass). Snapshotted before each line so a subjectless
    // clause looks strictly backward, and bounded by the activation reach so a
    // long-dead referent never reaches forward to claim a verb.
    const INHERIT_REACH = 8;
    let lastIns = null;                         // { id, sentIdx } in reading order

    // Defeasible surname (tail) merges accumulate here as they are committed, each
    // with the seq of its SYN. After the read, the reconciliation fires their
    // rebutter when the surname proves shared by distinct agents (see below).
    const surnameMerges = [];

    // The structural frame (computed in Pass 0 above) is held BEFORE the per-line
    // chrome test so a block of licence prose — full sentences a per-line test reads
    // as narrative — is held by the bracket it sits outside. Empty for an unframed
    // document; this changes nothing there.
    sentences.forEach((sent, sentIdx) => {
      // Frame is held like chrome (NUL → no entities, no edges) AND marked a site (DEF
      // role=site), so retrieval and the fold skip it too — a licence line can no longer
      // surface as a citable span. The `via:'frame'` stamp distinguishes it in the trail
      // from the degenerate-line chrome below.
      if (frame.all.has(sentIdx)) {
        log.append({ op: 'NUL', kind: 'chrome', via: 'frame', sentIdx, text: sent });
        log.append({ op: 'DEF', id: `unit:${sentIdx}`, key: 'role', value: 'site', sentIdx });
        return;
      }
      // Chrome-ness is a weight: the mechanical score plus an optional nudge
      // (a mini-LLM's chrome probability) decides whether the line is held.
      if (isChrome(sent, chromeHint ? chromeHint(sent) : 0)) {
        // NUL is non-transformation — the line is *held*, not cleared. It is
        // simply not turned into entities or relations. (Voiding a fact would
        // be a DEF to VOID, an assertion; NUL asserts nothing.)
        log.append({ op: 'NUL', kind: 'chrome', sentIdx, text: sent });
        return;
      }
      // Snapshot the field before this line's own entities are folded in, so
      // a subject pronoun looks backward for its antecedent. The last-INS register
      // is snapshotted the same way — a subjectless clause defaults to the referent
      // activated before this line, never one this line introduces.
      const priorField = corefField.field(sentIdx);
      const priorLastIns = lastIns;

      for (const obs of admission.observe(sent, sentIdx)) {
        // INS on every sighting (admit and present) so edge weights track how
        // often a figure actually appears, not just that it exists.
        if (obs.status === 'admit' || obs.status === 'present') {
          log.append({ op: 'INS', id: obs.id, label: obs.label, sentIdx });
          corefField.note(obs.id, sentIdx);
          lastIns = { id: obs.id, sentIdx };       // the arrow of time advances
        }
        if (obs.status !== 'admit' || !obs.aliasOf) continue;
        // A name-containment alias is a synthesis (SYN), and EVA fires AS it is
        // committed — the write-time evaluation the ingestion log used to lack.
        if (obs.aliasKind === 'head') {
          // "Gregor" folded into "Gregor Samsa": the given name individuates, so the
          // ids were unified at admission and the merge is corroborated on its face.
          if (obs.rawId !== obs.id) {
            const syn = log.append({ op: 'SYN', kind: 'alias', from: obs.rawId, to: obs.id,
                                     label: obs.label, sentIdx, match: 'head', warrant: 'given-name' });
            log.append({ op: 'EVA', site: 'merge', ref: syn.seq, verdict: VERDICTS.CORROBORATED,
                         reason: 'given-name-containment', sentIdx });
          }
        } else if (obs.aliasKind === 'tail') {
          // "Samsa" folded into "Gregor Samsa": a surname is shared across a family,
          // so the merge is THIN. It is a REAL merge (kind:'merge' — the projection
          // unions it), so a single-Samsa document still folds; but it is committed
          // DEFEASIBLY, carrying its rebutter, with the write-time EVA held at
          // indeterminate. The reconciliation after the read overturns it — by an
          // appended SEG-retract the projection honours — if the surname proves shared.
          const syn = log.append({ op: 'SYN', kind: 'merge', from: obs.id, to: obs.aliasOf,
                                   label: obs.label, sentIdx, match: 'tail', surname: obs.surname,
                                   warrant: 'surname', defeasible: true,
                                   rebutter: 'distinct-agent-shares-surname' });
          log.append({ op: 'EVA', site: 'merge', ref: syn.seq, verdict: VERDICTS.INDETERMINATE,
                       reason: 'surname-containment-thin', surname: obs.surname, sentIdx });
          surnameMerges.push({ synSeq: syn.seq, surname: obs.surname });
        }
      }

      // The relations parser reads coref two ways: `field()` for a leading
      // subject pronoun, and `resolve()` for a possessive owner pronoun in a
      // kinship apposition ("his sister Grete"). Both look backward through the
      // same pre-line field and take the strongest prior candidate. `resolve`
      // had no implementation, so that call site got nothing and pronoun-owned
      // kinship bonds dropped silently — only named owners survived. Wired now.
      const coref = {
        field:   () => priorField,
        resolve: () => priorField[0]?.id ?? null,
        // The last INS referent activated before this line, for a subjectless
        // clause to default to — within the activation reach, weight decayed by how
        // many lines back it was instantiated (the same γ kernel, as coupling).
        lastIns: () => {
          if (!priorLastIns) return null;
          const d = sentIdx - priorLastIns.sentIdx;
          if (d < 0 || d > INHERIT_REACH) return null;
          return { id: priorLastIns.id, w: Math.round(Math.pow(0.7, d) * 1000) / 1000 };
        },
      };
      const relOpts = { isSpeech, isCopula: conventions.isCopula, isModifier: conventions.isModifier,
                        isConjunction: conventions.isConjunction,   // ledger coordinator predicate
                        referents: true, coordSubjects };   // open the NP object slot (move 2); coord subjects (gated)
      for (const rel of parseRelations(sent, admission, coref, relOpts)) candidates.push({ rel, sentIdx });

      // Standing descriptors — the third coref channel (extraction half). A role
      // epithet with no adjacent name ("his sister", "Gregor's sister") is a HELD
      // role: it deposits into NO name's channel here. A named owner is sticky and
      // authoritative; a pronoun owner is taken only when it is the unambiguous
      // winner of the PRIOR field (the Frame-A margin guard — a wrong-but-weak
      // owner is worse than none). Binding a name to the role is the trigger's job.
      for (const desc of scanDescriptors(sent)) {
        let ownerId = null, named = false;
        if (desc.owner.kind === 'name' && admission.isAdmitted(desc.owner.name)) {
          ownerId = admission.idOf(desc.owner.name); named = true;
        } else if (desc.owner.kind === 'pron') {
          const [top, second] = priorField;
          if (top && (!second || top.w >= DESC_OWNER_MARGIN * second.w)) ownerId = top.id;
        }
        corefField.noteDescriptor(desc.roleKey, sentIdx, ownerId, { named });
      }

      // The unify trigger (phase b): once this sentence's admissions and
      // descriptors are folded in, bind any role whose bearer is now uniquely
      // determined by elimination. Each binding becomes a derived owner→bearer
      // edge (e.g. Gregor --sister--> Grete), typed downstream as the sibling
      // primitive — the apposition-free hop the channel exists to recover.
      for (const b of corefField.bindDescriptorsByElimination([...admission.admitted.values()], sentIdx))
        derivedEdges.push({ op: 'CON', src: b.owner, tgt: b.id, via: b.role, sentIdx, w: b.w, derived: true });
    });

    // ── Defeat the thin surname merges whose rebutter has gone live ─────────────
    // Each tail (surname) SYN above was committed defeasibly, carrying the rebutter
    // "a distinct agent bears this surname." The rebutter is LIVE when the surname is
    // borne by ≥2 distinct multi-word names — a family, not an individual (Gregor
    // Samsa / Mr Samsa / Mrs Samsa). Then the merge is OVERTURNED. Defeat does not
    // rewind: a SEG-retract is appended to supersede the SYN (the projection drops it
    // through the same union-find), and a write-time EVA records the contradiction.
    // A surname unique to one name is left merged — "Samsa" then does pick out the one
    // Samsa. This is the mr/mrs-samsa fix: the merge that ossified now unmerges.
    if (surnameMerges.length) {
      const bearers = new Map();   // surname → Set<label> of the multi-word names bearing it
      for (const label of admission.admitted.keys()) {
        const words = label.split(' ');
        if (words.length < 2) continue;
        const s = words[words.length - 1].toLowerCase();
        if (!bearers.has(s)) bearers.set(s, new Set());
        bearers.get(s).add(label);
      }
      for (const m of surnameMerges) {
        if ((bearers.get(m.surname)?.size || 0) < 2) continue;   // unique surname → the merge stands
        const seg = log.append({ op: 'SEG', kind: 'retract', refSeq: m.synSeq,
                                 reason: 'surname-shared-by-distinct-agents', surname: m.surname });
        log.append({ op: 'EVA', site: 'merge', ref: m.synSeq, verdict: VERDICTS.CONTRADICTED,
                     reason: 'distinct-agent-shares-surname', surname: m.surname, defeatedBy: seg.seq });
      }
    }

    // Move 3 — the relation recurrence gate (ReVerb's lexical constraint). A real
    // relation recurs; a verb seen once is suspect. We gate relations the way the
    // referent table gates entities — by recurrence — but HOLD WEAK rather than
    // drop, because many one-off verbs are real (walked, made, told): the
    // uncertainty rides along as reduced coupling, the same physics the pronoun
    // field already uses. A recurrent verb is learned into the conventions ledger
    // (a 'relation' REC), so the document's own relation vocabulary joins what it
    // taught the reader.
    const viaCount = new Map();
    const nounCount = new Map();   // NP-referent head → document-wide occurrences
    for (const { rel } of candidates)
      if (rel.op === 'CON' || rel.op === 'SIG') {
        viaCount.set(rel.via, (viaCount.get(rel.via) || 0) + 1);
        if (rel.tgtKind === 'np') nounCount.set(rel.tgt, (nounCount.get(rel.tgt) || 0) + 1);
      }
    for (const [via, n] of viaCount) if (via && n >= 2) conventions.learn('relation', via, n);

    for (const { rel, sentIdx } of candidates) {
      const { args, coord, ...edge } = rel;   // `coord` is read by the gate below, then dropped (never logged)
      // The recurrence coupling: a one-off relation verb is held weak (×0.5),
      // compounding with any pronoun coupling already on the edge. A bond on a
      // recurrent verb keeps full coupling. The argument-span SEG is still written
      // before the bond and cited by it, so a CON walks back to the text (§3).
      if (edge.op === 'CON' || edge.op === 'SIG') {
        // A coordinated-subject convergence edge is held FIRM on a single sighting: a
        // reveal's verb ("listed") is single by nature, and the edge's warrant is the
        // construction, not the verb's recurrence — so it is not held weak and dropped
        // from the firm graph the bridge channel reads.
        const recurrent = (viaCount.get(edge.via) || 1) >= 2 || coord === true;
        let factor = recurrent ? 1 : 0.5;
        // An NP referent rides the SAME recurrence gate as the verb and the figure: a
        // common noun seen once across the document is held weak, never dropped — the
        // uncertainty rides as reduced coupling, the physics the pronoun field uses.
        if (edge.tgtKind === 'np' && (nounCount.get(edge.tgt) || 1) < 2) factor *= 0.5;
        const base = edge.w == null ? 1 : edge.w;          // existing (pronoun) coupling
        const w = Math.round(base * factor * 1000) / 1000;
        if (w < 1) edge.w = w; else delete edge.w;         // sub-unit coupling rides along
        // Type the predicate (move 3): the raw verb stays as `via` (the citation and
        // the talker's arrow label); the closed-vocab type rides beside it as
        // `relType`, the comparable grouping key. Additive — an untyped real verb
        // keeps no relType and still projects.
        const relType = conventions.relationType(edge.via);
        if (relType) edge.relType = relType;
      }
      if (args) {
        const seg = log.append(argumentSpanSeg(args, sentIdx));
        log.append({ ...edge, sentIdx, argspan: seg.seq });
      } else {
        log.append({ ...edge, sentIdx });
      }
    }

    // The derived descriptor edges, after the witnessed candidates. They carry
    // `derived: true` so the projection and the edge-grounding veto treat them as
    // defeasible (e.g. they never satisfy the functional-axiom's witnessed-filler
    // requirement) — the apposition-free binding, held as a weak, citable bond.
    for (const e of derivedEdges) {
      const relType = conventions.relationType(e.via);   // a role via → 'kinship'
      log.append(relType ? { ...e, relType } : e);
    }

    // The naming-scene discovery (parse/naming.js) — coreference by direct address.
    // A role epithet is a referent; the name that answers it as a vocative ("Grete!"
    // … "his sister called") is the SAME referent. We materialise the role referent,
    // bond the owner to it (Gregor → his sister), and SYN it to the name — the
    // projection's union-find then carries the kinship edge onto Grete with no
    // cascade, the apposition-free hop the elimination trigger could not bootstrap.
    // Guarded by owner-distinctness, the injected disjointness algebra, and sticky
    // abstention; a role no scene names is left as an UNNAMED referent, not guessed.
    for (const m of discoverNamings(sentences, { admission, corefField, conventions, rolesConflict })) {
      const roleRef    = `role:${m.role}@${m.ownerId}`;
      const ownerLabel = admission.labelOf(m.ownerId) || m.ownerId;
      const relType    = conventions.relationType(m.role);
      log.append({ op: 'INS', id: roleRef, label: `${ownerLabel}’s ${m.role}`, sentIdx: 0 });
      log.append({ op: 'CON', src: m.ownerId, tgt: roleRef, via: m.role, sentIdx: 0, ...(relType ? { relType } : {}) });
      const syn = log.append({ op: 'SYN', kind: 'merge', from: roleRef, to: m.name, sentIdx: 0 });
      // EVA at write time: discoverNamings already ran the merge's guards (owner-
      // distinctness, disjointness, sticky abstention), so the surviving merge is
      // corroborated by the naming scene as it is committed.
      log.append({ op: 'EVA', site: 'merge', ref: syn.seq, verdict: VERDICTS.CORROBORATED,
                   reason: 'naming-scene', role: m.role, sentIdx: 0 });
    }

    const tokensBySentence = sentences.map(s => new Set(tok(s)));

    return {
      docId, text, sentences, log,
      tokensBySentence,
      admission,
      conventions,                  // the learned-rules ledger (REC)
      metadata: metadata.byKey,     // the document's front-matter facts, by canonical key
      metaFields: metadata.fields,  // the harvested fields in reading order (label · value · sentIdx)
      mentions: admission.mentions, // id → unit indices
      // Modality-neutral contract: `units` is the reading sequence the spine
      // walks (here, sentences). An image adapter fills the same field with
      // regions; the operators, log, graph and reading levels are unchanged.
      units: sentences,
      modality: 'text',
      corefField,    // the referent field, incl. held standing descriptors (inspection)
      state, // exposed for inspection; not for outside mutation
    };
  };

  return { parse, state };
};

// One-shot convenience. Tests and the default ingest path use this form.
export const parseText = (text, opts = {}) =>
  createParser(opts).parse(text, opts);
