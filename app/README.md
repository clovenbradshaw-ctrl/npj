# `app/` — the holon map

The front end is organized as **holons**: cohesive sub-assemblies, each one a
directory with a single public surface (its `window.Npj*` global). Nothing
reaches across a boundary except through that surface. See
[`docs/organization.md`](../docs/organization.md) for the why and the EO
operator labelling.

Load order is owned in two places only: the `<script>` list in `index.html`
(the plain-JS holons) and the `EAGER`/`READ`/`EDITOR` manifest in
[`boot.js`](boot.js) (the JSX, compiled in-browser). `boot.js` itself is the
loader infrastructure and stays at the `app/` root.

| Holon | Surface (entrance) | What it is | EO operators |
|---|---|---|---|
| [`core/`](core/) | `window.NPJ` | seed collections + shared helpers + the void taxonomy | `SYN` · `DEF` · `NUL` |
| [`graph/`](graph/) | `EOReader4`, `NpjPropGraph`, `NpjGraphRender` | the model-free proposition graph: the eoreader4 bridge, the prose→doc adapter, the SVG renderer + view | `SYN` |
| [`record/`](record/) | `NpjArticles`, `NpjStructure`, `NpjComposition`, `NpjSentences` | the append-only EO record: fold version files into articles, publish, commit edits, diff | `INS` · `REC` · `SEG` |
| [`sources/`](sources/) | `NpjSources`, `NpjCitations`, `NpjSourceView`, `NpjArchiveCDN`, `NpjSourceTitle` | source provenance, dedup, the citation registry — **the `CON` bond** | `CON` · `SIG` |
| [`grounding/`](grounding/) | `CiteyBrain`, `CiteyAssist`, `NpjDefinitions` | the mechanical grounding state + Citey (the leashed assistant) | `EVA` · `DEF` |
| [`redaction/`](redaction/) | `NpjPII` | PII recognizers + hard-redact gates (page + PDF) | `NUL` · `DEF`→void |
| [`media/`](media/) | `NpjMedia`, `NpjEmbed` | image/PDF upload, crop, embed, homeserver→archive freeze | — (carriers) |
| [`identity/`](identity/) | `MatrixAuth`, `NpjProfiles`, `NpjDrafts`, `PasskeyVault` | Matrix auth, roles, profiles, durable drafts, passkeys | — (provenance) |
| [`feedback/`](feedback/) | `NpjFeedback` | span-anchored reader suggestions → `EVA`, merge → `REC` | `EVA` · `REC` |
| [`export/`](export/) | `NpjSubstack`, `NpjFactCheck` | Substack + fact-check export adapters (read-only) | — |
| [`editor/`](editor/) | (mounts core/record/sources/grounding) | the Newsroom writing surface + grounding workspace + source pickers | writes `INS`/`REC`/`CON` |
| [`reader/`](reader/) | — | the article reader, front page, masthead, post-publish edit | projects the log |
| [`admin/`](admin/) | `LayoutCtx` | the layout/lineup editor, project & document explorer, onboarding | layout `REC` |
| [`ui/`](ui/) | shared kit | the shared UI kit (icons, cards, hooks) used by every view | — |

Dependency direction is downhill: `core` → `graph`/`record` → `sources` →
`grounding` → the UI holons (`editor`/`reader`/`admin`/`feedback`/`export`).
`identity`, `media` and `ui` are cross-cutting carriers. No holon imports above
its line.

> Legacy note: the old root `engine.js` (the standalone Cleon extractor) was
> dead in the shipping app — the live reading core is the vendored eoreader4,
> reached through [`graph/eoreader4-bridge.js`](graph/eoreader4-bridge.js) — and
> has been removed.
