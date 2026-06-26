# `app/` — the 14 holons

The app's source, grouped into one directory per **holon** (a stable
sub-assembly with a single public surface — its `window.Npj*` / `window.*`
global). This is the physical realization of the holon map proposed in
[`../docs/organization.md`](../docs/organization.md): the seams the globals
already implied, cut into folders.

Two files stay at the root because they're loader infrastructure, not features:

- **`boot.js`** — the no-build module loader (compiles + caches the `.jsx`
  files, splits front-page core / reader / editor). It holds the
  `EAGER`/`READ`/`EDITOR` manifest; **add or move a file → update it here.**
- **`styles.css`** — the single global stylesheet, loaded by `index.html`.

The plain `app/<holon>/*.js` scripts are still hand-ordered in `index.html`'s
`<script>` list ("order matters"); the `.jsx` files are listed in `boot.js`.
Those two orderings are the wiring — keep them in sync with any move here.

| Holon | Public surface | What lives here |
|---|---|---|
| **`core/`** | `window.NPJ`, void taxonomy | `data.js`, `void-kinds.js` |
| **`graph/`** | `EOReader4`, `NpjPropGraph`, `NpjGraphRender` | `eoreader4-bridge.js` (ES-module seam to vendored eoreader4), `prop-graph.js`, `graph-render.js`, `GraphView.jsx` |
| **`record/`** | `NpjArticles`, `NpjStructure`, `NpjComposition`, `NpjSentences` | `articles.js`, `structure.js`, `composition.js`, `sentences.js`, `versions.jsx` |
| **`sources/`** | `NpjSources`, `NpjCitations`, `NpjSourceView`, `NpjArchiveCDN`, `NpjSourceTitle` | `sources.js`, `citations.js`, `source-view.js`, `source-title.js`, `archive-sources.js`, `archive-cdn.js` |
| **`grounding/`** | `CiteyBrain`, `CiteyAssist`, `NpjDefinitions` | `CiteyBrain.js`, `CiteyVoice.js`, `citey-assist.js`, `citey-states.js`, `evidence-needs.js`, `definitions.js`, `Citey.jsx` |
| **`redaction/`** | `NpjPII` | `pii.js`, `CiteyRedact.jsx`, `PdfRedactView.jsx` |
| **`media/`** | `NpjMedia`, `NpjEmbed` | `media-store.js`, `image-slot.js`, `photo-editor.js`, `embed.js`, `PdfView.jsx` |
| **`identity/`** | `MatrixAuth`, `NpjProfiles`, `NpjDrafts`, `PasskeyVault`, `NpjE2EE` | `matrix-auth.js`, `profiles.js`, `passkey-vault.js`, `drafts.js`, `e2ee.js` (Web Crypto group sessions) |
| **`feedback/`** | `NpjFeedback`, `NpjCollab` | `feedback.js`, `collab.js` (e2ee comments/chat/suggested edits) |
| **`export/`** | `NpjSubstack`, `NpjFactCheck` | `substack-export.js`, `SubstackExport.jsx`, `fact-check-export.js`, `FactCheckExport.jsx` |
| **`editor/`** | the newsroom (mounts core/record/grounding) | `Newsroom.jsx`, `GroundingWorkspace.jsx`, `PostStructure.jsx`, `DefinitionsRail.jsx`, `SourcePicker.jsx`, `SourceViewer.jsx`, `SourceAdapter.jsx`, `SourceExplorer.jsx`, `InterviewSource.jsx` |
| **`reader/`** | the published-record reader + its rails | `ArticleRead.jsx`, `ArticleEdit.jsx`, `FrontPage.jsx`, `Contributors.jsx`, `Standards.jsx`, `SuggestionRail.jsx`, `CollabRail.jsx` |
| **`admin/`** | `LayoutCtx` | `AdminEditor.jsx`, `layout.jsx`, `Documents.jsx`, `Data.jsx`, `Entities.jsx`, `Submit.jsx`, `Invite.jsx` |
| **`ui/`** | shared kit (icons, hooks) | `shared.jsx` |

Dependency direction (low → high): `core` → `record` → `sources` →
`grounding` → `editor`/`reader`/`feedback`/`export`/`admin`. `identity`,
`media`, `graph`, `ui` are cross-cutting carriers imported by the upper holons.
No holon should reach above its line — that's what keeps each one swappable.
