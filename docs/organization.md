# Organizing npj's operations — a holon map

> What we can learn from **eoreader4** about turning a flat bag of modules
> into a nest of swappable holons — *without copying any of its code.*

> **Status (done): the physical holonization landed.** The feature files
> below now live in 14 `app/<holon>/` directories this doc proposed, and the
> dead root `engine.js` (the standalone Cleon extractor, referenced nowhere in
> the live app — the shipping reading core is the vendored eoreader4 reached via
> `app/graph/eoreader4-bridge.js`) was deleted. See [`../app/README.md`](../app/README.md)
> for the as-built map. The §6 migration to native ES modules (collapsing the two
> hand-maintained orderings) is the remaining, still-incremental work — the moves
> were git renames, so nothing was rewritten yet.

npj and eoreader4 are the same family. Both treat an **append-only EO event
log as the single source of truth** and recompute everything else as a
projection of it. npj already proves this at the data layer: `articles/<slug>/`
is one timestamped event file per change (`INS` to publish, `REC` to edit,
`EVA` for reader feedback), and `engine.js` is the EO graph extractor speaking
all nine operators.

The difference is at the **code** layer. eoreader4 is *Hora* — a nest of stable
sub-assemblies. npj is *Tempus* — a monolith of flat files. This doc is about
closing that gap using npj's own vocabulary.

---

## 1. The diagnosis — why it feels like a birdsnest (measured, not vibes)

| Symptom | Evidence |
|---|---|
| **No structure** | 66 files flat in `app/` + a 4,498-line root `engine.js`. Zero subdirectories. |
| **Two hand-maintained orderings** | The `<script>` tag list in `index.html` ("Plain scripts, order matters") **and** the `EAGER`/`READ`/`EDITOR` manifest in `app/boot.js`. Add a file → edit both, in the right slot, or it breaks at runtime. |
| **~40 unenforced boundaries** | Modules talk through `window.*` globals — `NPJ` (155 refs), `MatrixAuth` (106), `NpjCitations`, `NpjArticles`, `NpjSourceView`, `NpjStructure`, `NpjMedia`, `CiteyBrain`… Each is a *de facto* module interface with nothing stopping any file from reaching into any other. |
| **God files** | `Newsroom.jsx` 3,912 lines · `GroundingWorkspace.jsx` 1,835 · `ArticleRead.jsx` 1,734 · `articles.js` 1,347 · `Documents.jsx` 929 · `shared.jsx` 894. eoreader4's stated rule: *no file over ~250 lines.* |

The key realization: **the seams are already drawn.** Those ~40 `window.Npj*`
names *are* the module boundaries — npj just never cut the files along them.
This is the exact situation eoreader4's `docs/holons.md` describes: the tests
(here, the globals) had already decomposed the problem into sub-assemblies
"that did not exist as modules."

---

## 2. What eoreader4 does differently — the discipline (not the code)

A module is a **holon** when ([eoreader4 `docs/holons.md`](../../eoreader4/docs/holons.md)):

1. **One entrance.** Only its `index.js` is imported by other holons.
2. **One boundary.** Inside, files import each other freely; outside, they're invisible.
3. **Own tests.** Stub everything across the boundary, so a failure is *local*.
4. **Swappable.** Replace the implementation behind the same interface; nothing else knows.
5. **Whole at its own scale.** It runs and has meaning on its own.
6. **Survives interruption.** Crash mid-write? The events already appended are still in the log.

Two principles wire the holons together (`docs/architecture.md`):

- **The low sets the possibility for the high.** `core` imports nothing; everyone
  imports `core`. Parse can't surface a span the log never admitted; the model
  can't cite a span that doesn't exist.
- **The high sets the probabilities for the low.** A `frame` parameter re-weights
  the projection without violating the lower contract. Influence is *explicit*,
  never a hidden global.

And three anti-patterns it bans outright — **no god module, no 760-line
orchestrator, no silent feedback loops** — plus a *covenant* of registries:
add a backend → register it in `model/index.js`; add a stage → list it in
`turn/pipeline.js`. The wiring lives in one declared place, not scattered.

**How it stays buildless:** native ES modules. `index.html` loads exactly one
line — `<script type="module" src="src/main.js">` — and `main.js` is itself one
line: `import './ui/app.js'`. The browser walks the import graph. No Babel, no
bundler, no hand-ordered script list. **npj already runs this in production**:
`app/eoreader4-bridge.js` is loaded as `<script type="module">` and uses real
`import`. The path is proven inside npj's own repo.

---

## 3. The holon map for npj

Grouping today's 66 files by the boundaries the globals already imply. Each row
is a candidate holon: one directory, one `index.js`, one global surface.

| Holon `app/<dir>/` | Owns (global) | Files today | EO operators it speaks |
|---|---|---|---|
| **`core/`** | `window.NPJ`, `EOReader4` | `engine.js`*, `eoreader4-bridge.js`, `data.js`, `void-kinds.js` | `SYN` graph · `DEF` assert · `NUL` hold |
| **`record/`** | `NpjArticles`, `NpjStructure`, `NpjComposition`, `NpjSentences` | `articles.js`*, `structure.js`, `composition.js`, `sentences.js`, `versions.jsx` | `INS` publish · `REC` edit · `SEG` resplit |
| **`sources/`** | `NpjSources`, `NpjCitations`, `NpjSourceView`, `NpjArchiveCDN`, `NpjSourceTitle` | `sources.js`, `citations.js`, `source-view.js`, `source-title.js`, `archive-sources.js`, `archive-cdn.js` | **`CON` the bond** · `SIG` attribute |
| **`grounding/`** | `CiteyBrain`, `CiteyAssist`, `__citey`, `NpjDefinitions`, `__npjGround` | `CiteyBrain.js`, `citey-assist.js`, `citey-states.js`, `CiteyVoice.js`, `evidence-needs.js`, `definitions.js`, `Citey.jsx` | `EVA` evaluate · `DEF` define |
| **`redaction/`** | `NpjPII` | `pii.js`, `CiteyRedact.jsx`, `PdfRedactView.jsx` | `NUL` hold · `DEF`→void |
| **`media/`** | `NpjMedia`, `NpjEmbed` | `media-store.js`, `image-slot.js`*, `photo-editor.js`, `PdfView.jsx`, `embed.js` | — (carriers) |
| **`identity/`** | `MatrixAuth`, `NpjProfiles`, `NpjDrafts`, `PasskeyVault` | `matrix-auth.js`, `profiles.js`, `passkey-vault.js`, `drafts.js` | — (provenance) |
| **`editor/`** | (mounts core/record/grounding) | `Newsroom.jsx`*, `GroundingWorkspace.jsx`*, `PreviewScreen.jsx` (standalone publish-preview; draws media from Matrix), `PostStructure.jsx`, `SourcePicker/Viewer/Adapter/Explorer.jsx`, `InterviewSource.jsx`, `DefinitionsRail.jsx` | writes `INS`/`REC`/`CON` |
| **`reader/`** | `SourceViewer` etc. | `ArticleRead.jsx`*, `FrontPage.jsx`, `Contributors.jsx`, `Standards.jsx`, `ArticleEdit.jsx` | projects the log |
| **`feedback/`** | `NpjFeedback` | `feedback.js`, `SuggestionRail.jsx` | **`EVA` evaluate** · `REC` merge |
| **`admin/`** | `LayoutCtx` | `AdminEditor.jsx`, `layout.jsx`, `Documents.jsx`, `Data.jsx`, `Entities.jsx`, `Submit.jsx`, `Invite.jsx` | layout `REC` |
| **`export/`** | `NpjSubstack`, `NpjFactCheck` | `substack-export.js`, `SubstackExport.jsx`, `fact-check-export.js`, `FactCheckExport.jsx` | read-only |
| **`ui/`** (shared kit) | `useIsMobile`, icons | `shared.jsx`*, `graph-render.js`, `GraphView.jsx`, `prop-graph.js`, `boot.js` | — |

`*` = god file, split first (§5).

Dependency direction (low → high): `core` → `record` → `sources` → `grounding`
→ `editor`/`reader`/`feedback`/`export`/`admin`. `identity`, `media`, `ui` are
cross-cutting carriers imported by the upper holons. **No holon reaches above
its line.** That single rule is what makes any one of them swappable.

---

## 4. EO/holonic labelling as the organizing axis

This is the part worth leaning into: npj already emits the nine operators —
promote them from "what the log stores" to **"how the code is addressed."**

Every event in EO has an address `operator(Site, Resolution)` — *what* operation,
*where* it landed (the **Site** = the span/position), and *how* the target is
held. The same triple labels a holon's job:

- A **citation** is `CON(span, source)` — the binding bond. That's why
  `sources/` + `grounding/` are one region of the cube: they own `CON`/`SIG`.
- A **publish** is `INS(piece, Ground)`; an **edit** is `REC(diff, Pattern)` —
  both owned by `record/`.
- A **reader suggestion** is `EVA(span, frame)` — owned by `feedback/`.
- A **redaction** is `NUL(span)` / `DEF→void` — owned by `redaction/`.

Practical payoffs of labelling holons (and their events) this way:

1. **Naming falls out of the cube.** A new feature gets placed by asking "which
   operator, on which Site?" — not "which 3,000-line file does this sort of
   belong in?"
2. **Sites are addressable.** A "Site" is a pinned span of text or a source —
   exactly npj's `data-cite-id` markers. Make the Site the shared address and
   `record`, `sources`, `feedback` all reference *the same span* without
   reaching into each other's internals.
3. **Review happens against a fixed vocabulary.** Tuning, audit, and tests check
   operators, never ad-hoc fields (eoreader4 `docs/operators.md`: "the operators
   are the genome").

This costs npj nothing new conceptually — `engine.js` and `articles/` already
speak it. It just makes the *folders* admit what the *data* already knows.

---

## 5. The god files — split these first

These four hold most of the tangle; splitting them unlocks the rest.

- **`Newsroom.jsx` (3,912 lines)** mixes 9 concerns and reads/writes 8 globals.
  Carve out: the prose canvas, the metadata/tags sidebar, the image/redaction
  layer (grounding is already external). Target: a thin `editor/Newsroom.jsx`
  shell that mounts holons.
- **`GroundingWorkspace.jsx` (1,835)** — four pivot views in one file. Split into
  one component per view (Prose / Grounding / Citations / Sources) behind a small
  coordinator. It currently mutates back through Newsroom's API — make that a
  declared interface, not a DOM back-channel.
- **`ArticleRead.jsx` (1,734)** — block renderer + 3 evidence layouts + media. Pull
  the block renderer and the evidence-layout coordinator out as `reader/` modules.
- **`articles.js` (1,347)** — the fold lives here; keep it pure and move the
  source-merge and version-history helpers into `record/` siblings.

---

## 6. Migration path — incremental, native ESM, zero copy

Strictly reorganizing npj's own code. **Do not vendor eoreader4 beyond the
existing `eoreader4-bridge.js`.**

1. **Kill one of the two orderings first.** Convert the plain `app/*.js` helpers
   (not the JSX yet) to native ES modules with explicit `import`/`export`, one
   `index.js` per holon from the §3 map. Each holon's `index.js` keeps writing its
   `window.Npj*` global during transition, so the JSX consumers don't change yet.
2. **Make `core` import nothing**, and have every other holon import only from
   another holon's `index.js`. Add a tiny lint/test that fails on a deep import
   (`from '../sources/citations.js'` instead of `from '../sources/index.js'`).
3. **One registry per extension point** (the covenant): exporters listed in
   `export/index.js`, vetoes/grounding states in `grounding/index.js`, front-page
   templates in `admin/layout`. New thing → one declared edit.
4. **Split the four god files** (§5) into their holon directories.
5. **Collapse the manifests.** Once holons are real ES modules, `boot.js`'s
   EAGER/READ/EDITOR split becomes dynamic `import()` of three holon entrypoints —
   the browser's import graph replaces the hand-ordered list, and `index.html`
   drops most of its `<script>` tags. (JSX still needs the Babel step; keep
   compiling the `.jsx` leaves, but let native modules carry the `.js` spine.)
6. **Co-locate the tests by holon** so `tests/` mirrors `app/`, each suite stubbing
   across its boundary.

Do it holon by holon — that's the whole point of Hora. An interruption costs you
one sub-assembly, never the watch.

### What *not* to do

- **Don't copy eoreader4 in.** The lesson is the *discipline* — one entrance, one
  boundary, operator labelling. The `eoreader4-bridge.js` seam is enough.
- **Don't big-bang rewrite.** The durable EO log means you can reorganize the code
  under it incrementally and recompute; there's no flag day.
- **Don't add a bundler.** Native ES modules already give real boundaries with no
  build — that's how eoreader4 stays buildless and fast.
