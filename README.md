# People's Journalism

A community newsroom prototype: **community-created, community-backed, community-edited.**
Every published claim is bound to a specific span of text and sourced to an
archived snapshot; the record stays open to public suggestion.

This repo ships **empty** — no sample stories, sources or contributors. The
founding admin curates the site and grows the network from there.

## What's here

| Path | What it is |
|---|---|
| `index.html` | the app shell — loads everything below (served at the repo root) |
| `app/boot.js` | the no-build module loader: compiles the front-page core before first paint, defers the reader + editor to after paint, and caches each file's compiled output in the browser (so repeat visits skip Babel entirely) |
| `sw.js` | service worker — caches the app shell + pinned React/Babel for instant repeat loads (and offline) |
| `articles/` | **the published record** — one folder per document (`<slug>/`) of timestamped version files, one EO event each; legacy single-file logs (`<slug>.jsonl`) still readable |
| `app/` | the React (in-browser Babel) front end |
| `app/articles.js` | the EO log store: lists `articles/` onto the front page, folds a document's version files into a readable article, publishes (INS) and commits edits (REC) — each as a brand-new file |
| `app/ArticleEdit.jsx` | edit-after-publish overlay — admin + the article's assignees |
| `app/data.js` | content layer — **framework only**, seeded empty |
| `app/layout.jsx` | the editable site chrome, the **front-page lineup** model (slug ordering + layout templates), the permission model, and the public **contributor profiles** map |
| `app/profiles.js` | contributor profiles — the byline **name + ≤250-char "About me"**, saved to the contributor's Matrix account (pulled from their account info) and folded into the public layout |
| `app/Contributors.jsx` | the public **masthead** — every contributor with their role and About me |
| `app/FrontPage.jsx` | the masthead + front page — renders each piece through the admin's chosen layout template (`FrontCard`) |
| `app/AdminEditor.jsx` | the admin **Edit layout** panel — section nav, taglines, brand, roles, contributor profiles, and the front-page lineup editor |
| `app/matrix-auth.js` | real Matrix client-server auth, roles, profile & room recovery |
| `app/drafts.js` | durable drafts — localStorage + Matrix account-data sync (survive refresh & browser wipe) |
| `app/Newsroom.jsx` | the editor: manual span-bound sourcing, images, tags, invites — mobile-responsive |
| `app/GroundingWorkspace.jsx` | the grounding workspace — four pivoting views of the same draft (Prose / Grounding / Citations / Sources), the publish-gate strip, the cite modal and Citey's walkthrough |
| `app/citations.js` · `app/sentences.js` | the grounding model: reusable citation records (pinned spans of a source, multi-part supported) + live sentence segmentation. One span can hold **several citations** (`data-cite-id`, one `md-cite` marker per source) |
| `app/source-title.js` | best-effort **source identity** — guess a web source's title (URL slug) + outlet (host), and read the real ones off the page's own `<title>`/`og:` tags. No model; pure + tested |
| `app/Documents.jsx` | the **article** explorer — bucketed by **project**, each project a card with permission controls (invite by Matrix ID), its articles, and the **shared source shelf** (deduped + backtracked) |
| `app/sources.js` | source provenance — synthetic content **dedup** (one signature per document, linked across projects/articles, never deleted) + **backtracking** (source → every article that cites it) |
| `app/Citey.jsx` | the drafting assistant — a margin mascot whose face is the mechanical grounding state (⊥ ungrounded → ⊤ grounded); offers **pin a source line** or **own it** (⊢/⊨/⊩, or **⊪ in context** — continuing coverage that builds on prior articles), reflects the publish gate, suggests **tags**. Sits small and quiet (idle bob + "boil" + blink), comes forward on hover/flag, and plays an **interstitial morph** each time he changes shape (motion-reduced for `prefers-reduced-motion`) |
| `app/CiteyBrain.js` | the mechanical layer — reads the editor's live grounding (pinned / owned / undeclared) into Citey's states; **no model** |
| `app/CiteyVoice.js` · `app/citey-assist.js` | leashed (templated) speech; mechanical tag-suggest + source-span ranking (never invents a citation) |
| `app/pii.js` | the **pii-v2 pack** — mechanical recognizers (regex + checksum + context, **no model**) for data-shaped PII: phones, SSNs, cards, addresses, emails…; detects candidate spans and hard-redacts them |
| `app/CiteyRedact.jsx` | **Citey's PII review** — the modal that gates a source on its way to archive.org: hard-redact or affirm each flagged span, plus broad document editing. Reads PDFs/scans in-browser (text layer / OCR) and, for a PDF, builds a **real redacted copy** (boxes burned into rasterized pages) that ships in place of the original |
| `app/PdfRedactView.jsx` | **redact ON the PDF** — renders the real pages and lets the author drag black boxes over anything (name, face, signature, scanned line); shows redactions already on the record. Each box is normalized to the page and burned into the archived copy by `NpjSourceView.buildRedactedPdf` |
| `app/versions.jsx` | article version history + word-level diff |
| `app/feedback.js` | **branches & merge requests** — a contribution is a *branch*: a span suggestion/comment (`scope:"span"`) OR a **fork of the whole article** (`scope:"article"` + `forkBody`, an edited copy). Each carries **visibility** (`public` = anyone can see/preview; `private` = only the article's authors + the submitter), a best-effort MR **roomId** and an archive.org **archiveUrl** (attached async). Stored as EVA events in the article's folder + a local mirror. An editor **merges** a branch (span words applied, or the fork's body committed wholesale) or **ignores** it. Helpers: `canSee`, `previewBranch`, and the lightweight `forkUnits`/`applyForkUnits`/`forkChanged` text-fork model |
| `app/SuggestionRail.jsx` | the review surface — PR-shaped cards (diff, rationale, 👍, replies, visibility badge, **Toggle branch on**, **Discussion**) with **Merge / Ignore**, a **merge-requests table** view (cards ⇄ table), and the composer (span edit/comment) |
| `app/ForkEditor.jsx` | the **lightweight fork editor** — fork the whole article by editing the existing blocks' *text* only (no full editor, no layout changes; images/embeds stay put). Autosaves the working fork to this browser + the contributor's Matrix account; "Submit fork" lands it as a mergeable branch (or a note, if nothing changed) |
| `app/branch-archive.js` | **batched archive.org writes for public branches** — a persistent, throttled queue (one save at a time, backoff, resumes across reloads) that coalesces a piece's branches into one archive.org item (`npj-branches-<slug>/<branchId>.json`) via the `site/branch-archive-npj` webhook; the confirmed URL is written back onto the branch. Private branches are never pushed to the public web |
| `app/ContributeOnboard.jsx` | the **fast on-ramp** a signed-out reader hits when they submit a contribution — sign it by **creating a free account** on hyphae.social (pick a byline name or roll a random one, keep or hand-pick the handle, save a generated password) or **bringing your own** Matrix account from any homeserver. Verified by the homeserver; never gated on the admin allowlist (proposing is open). The reader never leaves the article — their draft is submitted the moment they're in |
| `backend/` | n8n publish workflow + thin browser clients |
| `assets/` | logo + brand art |

## Articles are append-only EO event logs — one folder of version files per document

Each document owns a folder, and every event lands as a **new timestamped
file** inside it:

```
articles/<slug>/20260610T231501123Z-ins-x7k2.jsonl   ← the publish (INS, the whole piece)
articles/<slug>/20260611T010203456Z-rec-9bd1.jsonl   ← an edit (REC, just what changed)
```

Publishing commits one `INS` event file carrying the whole piece (headline,
dek, body blocks, span-bound sources, authors, assignees). Every edit after
publish commits one more `REC` file into the same folder. **No commit ever
updates an existing file** — the old single-file `append` mode rode GitHub's
update-with-SHA call, which kept rejecting commits; create-only version files
can't conflict. The folder is the article's complete, auditable change
history, and uploading the same document again simply lands a newer `INS`
file: it becomes the current version and every earlier version stays on the
shelf. Pre-existing single-file logs (`articles/<slug>.jsonl`) are still read,
folding in before the folder's files.

The front page lists the record straight from GitHub (one git-tree call), the
reader folds a document's version files into the formatted article
(`#article;read=<slug>` is the share link), and the version badge opens a
word-level diff between any two events. **Edit after publish** is gated to the
admin and the article's `assignees` (the publisher by default) — enforced in
the n8n webhook against the document's genesis event, not just in the UI.

**Unpublish never deletes — it just takes the piece off the site.** An admin
can do it from the article control bar or straight from its row under
Documents, where every piece is badged **published / updated / unpublished**.
"Unpublish" commits one more `REC` version file carrying
`{"status":"unpublished"}` — so the act of hiding is itself part of the
permanent record, and the whole folder stays in GitHub and git history. An
unpublished piece drops off the front page, the Documents list and the reader
for everyone **except admins**, who keep seeing it badged and can
**Republish** it (another `REC` with `status:"published"`) at any time. Nothing
is ever truly removed; the site just stops serving it.

### Front-page lineup — hotswap positions, pick layout templates

The front page is a centered **2/3-width** column on desktop (full-width on
phones): the most recent piece runs **one-up** (full-width cover), the next
three sit **3-across**, and everything else flows into a single **vertical
feed**. By default that order is newest-first; the admin can override it from
**Edit layout → Front page lineup** without touching any article:

- **Hotswap positions.** Reorder the lineup (↑/↓) to choose which piece is the
  **cover**, which fill the **3-across row**, and which fall into the **feed**.
  The order is stored as a list of slugs in `front.order`; clear it to fall back
  to newest-first. Newly published pieces flow in after the pinned ones.
- **Layout templates.** Pick a whole-page template (`front.template`:
  *standard / grid / river / posters*) for the default arrangement, then
  override any single card (`front.cards[slug]`). Each template moves the
  **photo, title and subtitle** into a different arrangement — *photo below
  text, photo on top, photo left/right, title over photo,* or *text only* —
  and the public page renders the exact same `FrontCard`, so what the admin
  picks is what ships.
- **Standardized metadata.** The lineup editor checks every piece against the
  shared metadata standard (`NpjArticles.META_STANDARD`: title, subtitle,
  column, photo, date — plus recommended tags & byline) and badges what's
  missing, so each card has the fields its template needs to render
  consistently.

All of it is curated live, saved locally, and committed into `site/layout.json`
(`front`) through the same admin-gated publish webhook as the rest of the
chrome.

## Reader feedback, considered for merge (the PR idea, not the PR UX)

The record stays open to public suggestion — span by span. In the reader, select
**any words** in a story and a small bubble offers **Suggest edit** (propose the
exact replacement words) or **Comment** (pin a note to the span). Each lands as
an **EVA deposit** in the article's own folder (`app/feedback.js`,
`articles/<slug>/…-eva-….jsonl`) and folds as a no-op for the article itself — so
a proposal never changes a published word. Open suggestions are painted right
into the prose (a soft dashed underline, the way a Google-Docs suggestion shows
where a change is proposed), and the **Suggestions** rail reviews them like pull
requests without the pull-request UX: a word-level diff of what would change, the
rationale, 👍 weighting, and threaded replies.

**Merging is the only thing that edits the words.** An editor (the admin or an
article assignee) hits **Merge** and the proposed words are applied to the body
and committed as an ordinary **REC** edit — attributed, with the reader's
rationale as the edit note — then the suggestion is marked *merged*. A suggestion
whose words are gone (the base moved) shows a clean **conflict**, never a silent
wrong edit. Proposing is open to anyone; merging stays gated to the people who
can already edit the piece. Everything is mirrored to `localStorage` so it
survives a refresh, and rides the same auditable GitHub commit machinery as the
article (see [`backend/README.md`](backend/README.md) for the EVA model + the one
webhook rule that opens proposing to any verified reader).

## Identity & permissions (rooted in Matrix)

Authorization flows from one founding admin and is stored where a browser wipe
can't lose it (GitHub + Matrix):

- **Sign-in** is a real Matrix login: password → the homeserver issues an access
  token → `whoami` confirms the `user_id`. Nobody can self-grant access by typing
  an address.
- **Roles** — `admin` (publish + edit + manage roles) and `editor` (draft/edit,
  publish only to assigned columns). The seed admin
  `@collective_boundary730383:hyphae.social` is the immutable root.
- Roles + site layout are committed to GitHub (`site/layout.json`, world-readable)
  and mirrored to a Matrix control-room state event only admins can write.
- **Drafts** live in Matrix rooms; collaborators are invited by `user_id`. Every
  room the app creates is tagged with a `press.npj.room` state event, and the app
  only pays attention to tagged rooms — the rest of your Matrix account is
  ignored. Rooms are recovered from the homeserver on login (one filtered `/sync`
  + a per-account index), so switching or wiping a browser never loses your work.

## Bylines & contributor profiles (the masthead)

Every story carries an outward-facing **byline**, and every contributor has a
public profile — a display **name** and a **≤250-character "About me."**

- **Set the byline at the gate (and after).** The publish boundary has a byline
  control: the authors (defaults to you), an optional **"Edited by"** credit, or
  **Unsigned** (no author credit). The same control rides the edit-after-publish
  overlay, so a byline can be changed on the record like any other field. Authors
  and editors are stored on the article's EO event (`authors[]`, `editors[]`,
  `byline`), so the credit is part of the permanent, auditable log.
- **Names pull from the contributor's account.** A byline name defaults to the
  contributor's **Matrix display name** (`app/profiles.js` → the profile API) —
  the byline is right without anyone typing it. Editor names are optional; a
  byline can be **Unsigned**.
- **"About me" is the contributor's to set.** From **Documents → "Your byline &
  About me,"** any signed-in contributor edits their name + a 250-char bio. It
  saves to **their Matrix account** (`press.npj.profile`), so it survives a
  browser wipe, and shows in their byline immediately.
- **Stored publicly on GitHub, as a variable.** Profiles live in the
  world-readable `site/layout.json` under a `contributors` map — the same public
  file as roles and chrome. Every visitor reads names + bios straight from there
  (folded into the byline, the expandable contributor card under each story, and
  the **Contributors** masthead page). An admin curates/commits them with the
  existing "Publish layout"; a non-admin's bio is durable on their account and
  goes public on the next layout publish. The backend is **ready for direct
  self-service** writes too (see [`backend/README.md`](backend/README.md) → the
  per-contributor profile rule) — documented, not yet wired into the live flow.

## Submitting

Two ways in, surfaced on the **Submit** page:

1. **Email a tip** — anyone, no account: `peoplesjournalism@proton.com`.
2. **Sign in with Matrix** — contributors on the allowlist. Signing in lands you
   in **Documents** (your drafts, projects and the published record). No account
   yet? Pick a homeserver at <https://matrix.org/ecosystem/hosting/>.

## Sourcing is manual and span-bound — on both ends

In the Newsroom you select the exact words that make a claim and bind a source to
**that span**. But binding a source is only half of it: **you can't cite a whole
page.** Every bound span must then **pin the exact words *inside the source*** that
back the claim. Until it does, the span is flagged (⚑ `needs-quote`) and the
publish build refuses it — right next to the "no source record" check. The pinned
passage rides the article (`data-quote` → the claim token's `q` map) and shows in
the reader's citation card as *"the cited passage — in the source."* One source can
back **several spans**, each pinned to its own words — and one span can rest on
**several sources**: cite the same words again (or use the pin popover's **+ add a
source**) and each source gets its own pinned passage, so a claim corroborated by
two documents publishes as a single ⊨ claim carrying both (`data-cite-id` holds the
records; the publish path reads one `md-cite` marker per source into the token's
`src[]` + `q{}`). Sources are snapshotted to archive.org; a claim that points at a
page but no span fails the build.

**Citey finds the span — he never invents the citation.** When you bind a source,
hit **📎 Find the line**: Citey takes your claim and the source's text, ranks the
source's sentences by overlap, and points at the one that backs the claim — you
review and pin it. No source text yet? Paste the passage and Citey ranks within it
(and remembers it on the source for the next claim). He proposes the span; the
author decides what's true.

## The Grounding Workspace — four pivoting views of one draft

Next to **Prose** (the editor), the Newsroom's view switcher opens the
**grounding workspace** (`app/GroundingWorkspace.jsx`): three more views of the
*same* draft, each a different cut of its grounding record, with a side panel
that always shows a second view and **pivots** as you work:

- **Grounding** — every sentence is a row: its status pill (⊤ grounded · ⊨ N
  sources · ⊥ needs source · ⊩/⊨/⊢ owned · ⊪ in context · ¬ sources disagree), the
  citations attached to it, and its stance. A sentence can *also* carry **context**
  — the prior coverage it builds on (⊪), cited for context rather than proof and
  kept apart from the citations that back it, so a claim can be *both* proved by the
  article **and** set against past articles. Click a sentence and the panel shows its
  grounding card; click a citation chip and the panel pivots to the registry.
- **Citations** — the registry of reusable records. A citation is a pinned span
  of a source — exact words plus character offsets (multi-part when the support
  lives in more than one place). One record can back many sentences ("USED ×n");
  unlinking a sentence never destroys the record. **In context** opens the quote
  highlighted inside its source; **Usage ×n** lights up every sentence it backs.
  **Reusing a record is one search away:** the cite modal and the grounding card
  both carry a searchable **Reuse an existing citation** browser over the *whole*
  registry (best mechanical match first, but never hidden behind a threshold), so
  a citation you've already pinned attaches in one click instead of being hunted
  down in its source and re-grabbed.
- **Sources** — a **table** of the documents: where each is from, our best guess
  at its title, how many citations rest on it, archived-or-not, and the
  housekeeping (**⟲ Guess · ✎ Rename · ✕**). **The library names its own sources.**
  A web source no longer lands as a generic *"Web snapshot"* — it's named
  mechanically from its URL (the slug → a readable title, the host → the outlet),
  then **upgraded from the page's own `<title>`/`og:` tags** when the CORS-open
  archived HTML is reachable (`app/source-title.js` parses, `archive-cdn.pageMeta`
  fetches — no model, best-effort, a manual Rename always wins). Pick a row to open
  the document as paper with a letterhead: search within it, see every cited span
  highlighted in place, and — from any "+ Cite" — go in **armed**: Citey shades the
  passages he scents (mechanical word overlap, dotted, never a one-click pin), and
  you drag-select the exact words. Grab two spans if the support lives in two
  places; *⊕ Cite this span* mints the reusable record.

A **Ground truth** strip keeps the running tally (grounded / yours / conflicts /
needs sources) and the gate chip — **⚑ N blockers** until every sentence is
grounded or owned, **⊤ gate open** after. **Walk me through** hands Citey the
floor: he steps sentence-by-sentence through everything unsourced with one
honest choice each — 🔍 find support, or own it (Argue ⊩ / Assert ⊨ / Infer ⊢ / In context ⊪).
All of it reads and writes the same editor DOM and autosave as Prose; the views
can't diverge.

**Export outstanding fact checks.** When some claims can't be sourced from the
desk, hand them off: the **Export for fact-check** action turns every blocker
(⊥ needs source · ¬ conflict) into a plain, paste-anywhere list of *outstanding
fact checks* — one line per claim, each naming the **type of evidence** that
would ground it (the negative space), e.g. `… → an official document (court
filing, permit, or ordinance)`. The evidence type is read **mechanically** from
cues in the claim (`app/evidence-needs.js` — quotation marks, legal/governmental
verbs, figures, attribution, dates → a coarse evidence category; no model, never
prescriptive about the specific document). A **Sharpen with local model** button
upgrades the types through a local LLM when one is reachable (Ollama, or any
`setLLM` hook — the same ladder as Citey's voice), falling back silently to the
mechanical read. `app/fact-check-export.js` shapes the plain text; nothing here
judges a claim, only what would let someone else judge it.

## Citey — every claim grounded before it ships

Citey is the drafting assistant: a margin mascot whose face **is** the editor's
mechanical grounding state — a bent-wire logic operator that reads ⊥ when a claim
is unsupported and flips to ⊤ the moment a source line is pinned (⊨ when that
source is a primary, archived snapshot). His state is never a guess: it is read
straight off the draft's own grounding (`CiteyBrain.js` over the `.claim-src`
spans), and his voice is templated — there is **no model** deciding anything.

Click him on a flagged claim and he offers the two honest ways to ground it:

- **Pin a source line** — the manual, span-bound path above (Citey ranks the
  source's sentences for you; you pin).
- **Own it** — not everything wants a citation. Declare a claim as your **⊢
  analysis**, your **⊨ account** (you witnessed it), or your **⊩ stated position**.
  Owning records the stance and clears the flag; it publishes as your prose, not a
  citation. The thing Citey won't rest beside is the *undeclared* claim.
- **In context** — a fourth, lighter declaration for *continuing coverage*: a claim
  the article itself substantiates while building on the outlet's prior reporting
  (a topic or thesis sentence like "The war over benches continues"). It grounds
  the claim (⊪) and carries links to the **past articles** it builds on — cited for
  context, not proof. Context links ride a separate channel from the proof
  citations, so the same sentence can be *both* proved **and** set in context.

Citey also reflects the **publish gate**: a live count of how many claims would
still ship unverified, and a wary face until they're all sourced or owned — the
same `needs-quote` rejection the publish build already runs, given a face. He
also suggests **tags** (mechanical entity surfacing from the people, places and
orgs you name — `citey-assist.js`, no model).

**Pasting is plain by design.** Text copied in from anywhere — web pages, docs,
PDFs — loses its original formatting at the door: the editors rebuild the
clipboard's plain text into clean paragraphs (blank line = new ¶), so stray
fonts, colors and backgrounds never enter a draft. **Images paste too**: a
screenshot or a copied image lands as a regular image figure (and if it was
copied off archive.org, the durable CDN link is kept instead of raw bytes).

**Return vs Shift+Return.** A plain **Return** is a paragraph break — a new
`<p>`, which ships with paragraph spacing between it and the last one. A
**Shift+Return** is a soft line break — a `<br>`, which ships tight, with no
extra space (addresses, verse, a forced wrap). The editor pins the browser's
block separator to `<p>` so a Return splits consistently across browsers, and
the publish pipeline (`htmlToBlocks` → the reader) renders each exactly that
way; inside a code/verse block a Return is a literal newline instead.

**Preview is the real thing, not a mock.** The editor's **Preview** button folds
the live draft through the *same* builder that publishing uses
(`NpjArticles.genesisFromContent`) and hands the result to the reader's own
renderer (`ArticleRead` in preview mode) — same Header, same body blocks, same
paper page. So what you see in Preview is byte-for-byte what ships: paragraph
spacing, soft line breaks, images, the byline and the sources footer. Esc (or
✕ Close) drops you back in the editor.

**Transparency — the grounding, painted onto the prose.** Both the **Preview**
overlay and the published reader carry a **Transparency** toggle that colours
every grounded span by *how* it stands — the **same vocabulary the editor's
Grounding workspace uses** (`proseShade`/`pillFor`), so a reader (or an author
auditing a draft) sees the evidence behind each claim at a glance instead of
hovering one by one:

- **⊤ Grounded** / **⊨ Multiple sources** (yellow): pinned to one — or more than
  one — source passage that backs it.
- **⊢ analysis · ⊨ account · ⊩ position** (violet): claims the author *owns* —
  grounded by honest declaration, not a citation.
- **⊥ Needs a source** (orange, dashed): bound to a source but with no passage
  pinned — the same claim the publish gate flags; normally only visible in
  Preview.
- **¬ Sources disagree** (red): two pinned quotes pull opposite ways.

Each span also carries the small logic glyph the workspace uses, and a legend
keys the colours and tallies each kind; everything unmarked is uncited prose.
The lens reads the body's own grounding, so it lights up the same way in Preview
and on the live page. Owning a claim used to flatten to plain prose at publish —
now the stance rides the published body (`{c, stance}` tokens through
`htmlToBlocks`/`tokensToHtml`), so the record itself carries *which kind* of
grounding each owned claim has, and the lens can show it.

**The page knows its own media.** The contents rail keeps a census of every
image and embed in the piece; image thumbnails open a full-size viewer
(arrows page through, esc closes, "show in document" jumps to the figure).

**Every article has a subtitle.** A dek line sits under the headline (older
drafts get the field on restore); it publishes as the italic standfirst and
rides the article's EO genesis event as `dek`.

**The filename is the author's call.** It follows the headline by default,
but the publish gate has a rename field — a custom name sticks with the
draft and the committed file is named accordingly.

## Export to Substack — a paste that lands perfectly

Any published piece carries an **Export** button (the reader's control bar)
that opens the Substack panel (`app/SubstackExport.jsx`, over
`app/substack-export.js`). The mechanic it leans on: Substack's editor honors
**pasted HTML** (headings, bold/italic, links, lists, blockquotes, `<img>`) but
treats **pasted markdown syntax as literal text** — so the formatting has to
travel as HTML, not as `#`/`*` characters. Two paths, both land formatted:

- **Copy article** — one click puts rich HTML *and* a markdown fallback on the
  clipboard in a single write; paste into a new Substack post and headings,
  emphasis, links, lists, blockquotes and photos come across. Substack re-hosts
  each image straight from its **archive.org URL** (auth-gated Matrix
  `store:`/`mxc:` copies are dropped, since Substack fetches server-side), so
  there's nothing to re-upload.
- **Download .html — the file that copies perfectly.** A self-contained web
  page (`toHtmlDocument`): open it in any browser and click its own **Copy
  article** button for the same rich paste, **offline** and **without the
  clipboard quirks** — even a plain select-all + ⌘/Ctrl-C copies as formatted
  HTML, because a rendered browser selection already is. This is the durable,
  shareable artifact; a `.md` download is offered too, but only as the
  plain-text archival record (pasted markdown stays literal in Substack).

**The sourcing rides along, as footnotes.** NPJ's distinctive payload — every
claim bound to an archived snapshot *and the exact pinned passage that backs it*
— survives the export. Each sourced claim gets a superscript footnote marker,
and a **Sources** section closes the piece: every source, with the passage(s) it
backs quoted in full. The catch that makes it auditable on someone else's
platform: **every one of those links opens the archive.org snapshot deep-linked
to the cited words** — a [Text Fragment](https://developer.mozilla.org/en-US/docs/Web/Text_fragments)
(`#:~:text=…`) the browser scrolls to and highlights — so a reader lands on
*precisely the evidence*, not the top of a long archived article (long passages
anchor by their first/last words, so the highlight survives small drifts; an
unmatched fragment just opens the snapshot normally). Both footnote markers and
the Sources list are toggleable for a clean copy. **Title and subtitle** are
handed over as their own one-click chips, because Substack fills those from its
own fields — so the copied body omits them.

## Citey reviews every source for PII before it's archived

archive.org is permanent, public and all-or-nothing — once a source is up it
can't be edited or taken down. So **Citey's first real job** is a redaction gate
on the way there. Upload a document and Citey opens a review (you can defer it,
but a source can't be archived until you've been through it):

- **He scans it mechanically.** `app/pii.js` is a small, Presidio-shaped
  `pii-v2` recognizer pack — regexes, checksums (Luhn for cards, the SSN
  never-issued ranges, IBAN mod-97) and context words — surfacing emails, phone
  numbers, SSNs, cards, IBANs, IPs, street addresses, PO boxes, birth dates and
  government IDs. It is **data-shaped only**: it deliberately does **not** guess
  person names (without a model that means flagging every proper noun, which
  buries the real findings) — drag-select a name in review to redact it. Like
  the rest of Citey it runs with **no model** — every finding carries a `basis`
  (which recognizer fired, and why).
- **You decide each span.** Hard-**redact** it, or **keep** it public on purpose
  (affirm). Citey can also redact any selection you make, or let you edit the
  whole document — broad editing, not just toggling his findings.
- **Redaction is hard.** `NpjPII.redactText` destroys the characters in place
  (an offset-preserving █ block, so any pinned-citation offsets into the source
  stay valid). What gets archived no longer contains them — there's no taking it
  back, which is the whole point.
- **The act is auditable.** Each redaction and affirmation is logged on the
  source record with its `basis` and offsets, so you can prove what was withheld
  without un-withholding it. The archive consent now checks that **`✓ PII
  reviewed`** gate instead of a self-ticked "no private info" box.
- **PDFs are read AND redacted on the document.** A PDF is no longer opaque to
  Citey: `app/source-view.js` pulls its text layer (so the recognizers scan the
  real words) and the per-run geometry, and the review renders the actual pages
  (`app/PdfRedactView.jsx`). Redact a flagged span and the black box is mapped
  onto the page; **drag a box over anything** — a name, a face, a signature, a
  scanned line — and it scrubs the words under it too. When the source is
  archived, `NpjSourceView.buildRedactedPdf` ships a **real redacted PDF**: every
  page that carries a box is rasterized (its text destroyed) with the box burned
  in, clean pages copy through untouched, and that scrubbed copy reaches
  archive.org **in place of the original** — not "original withheld", the
  document itself, minus what you blacked out. (Can't build/store it — signed
  out, offline — and it falls back to scrubbed-text + original withheld.)

For a file type Citey still can't read inside the browser (`.docx`, a scan with
no text Citey can OCR), the review offers **paste-or-affirm**: paste the text for
a real scan, or vouch that you've checked it. He's a first pass that surfaces
candidates — **never a guarantee** — so for source-identifying material the human
stays the decider.

## Images ride archive.org — it's the media CDN

Article images aren't committed to this repo or stuffed into drafts as data
URLs. Upload the image at <https://archive.org/upload> (tag it `npj-media` if
you want your media library greppable, same idea as `npj-source`), then drop
the item's link onto any image slot in the Newsroom — a details page, a direct
`/download/` link, or a wayback capture all work; `app/archive-cdn.js` resolves
them to the item's primary image file via the IA metadata API. The slot renders
straight from archive.org, the URL travels inside the draft HTML (so it syncs
to your Matrix account and other devices with the draft), and the published
article hotlinks the same copy in its `img` block.

Local file drops still preview instantly, but they have no durable URL — they
stay out of the published article until they're on archive.org.

### Edit the photo before it's frozen — crop + hard redaction

Hover a filled image slot and hit **Edit** (`app/photo-editor.js`) to crop the
frame and paint hard black over anything that shouldn't be public — a face, a
plate, a screen, an address. Both are **baked into a new image**: the editor
flattens the crop and the redaction boxes onto a canvas, and `<image-slot>`
re-uploads *that* copy to the media store. So when publish freezes the slot onto
archive.org it can only ever copy the redacted version — the un-redacted original
never reaches the permanent, public record. This is the pixel counterpart to
Citey's text redaction: a redaction is **hard** (black pixels, not a removable
overlay or render-time metadata) and **before the archive**, by construction.

### Every photo carries a credit

Each image figure has a **credit** line under the caption. It takes a hyperlink
the same way a contributor bio does — a name and an optional `[outlet](https://…)`
in markdown — sanitized through `safeHref`/`npjRichText` (http(s)/mailto only,
escaped text, `rel="noopener noreferrer nofollow"`) and rendered as a safe link
in the reader, the hero banner, and the Substack export.

## Projects, articles & sources

A **project** is a shared Matrix room that *buckets* the work: any number of
**articles** (the pieces you write) and the **sources** (the documents you
upload to back them). Membership is the unit of access — everyone invited to a
project can open and edit **every article and every source in it**, no
per-document grant needed. Documents (`#docs`) is where this lives: each project
is a card with its invitees, an **Invite** control (a Matrix ID → an invite the
homeserver authorizes), the project's articles, and the **shared source shelf**.

Sources are **deduped synthetically** (`app/sources.js`): the same document
uploaded twice — to one article, one project, or across projects — collapses to
one row by a content **signature**, and the copies are *linked* rather than
thrown away (so a source's cross-project life is visible, and nothing is lost).
The grounding graph already points article → source; sources.js also walks it
**backwards** — from any source, trace every article that cites it.

## The Data explorer (`#explore`) — the archive behind the stories

The Data page opens on **Published sources**: every source a *released* article
rests on, folded out of the committed record (`app/sources.js` over
`app/articles.js`), deduped by signature and **backtracked** — each card traces
the trail back to the stories that cite it (open one straight from the source).
A second tab, **All tagged items**, is the raw archive.org view: it queries the
Internet Archive's search API on load (`app/archive-sources.js`) and lists every
item carrying the NPJ subject tag — each a searchable, previewable card and a
citeable source in the composer's **Cite a dataset** picker.

**Tag an upload so it shows up:**

| archive.org metadata | Value | |
|---|---|---|
| Subject tag | `npj-source` | **required** — the tag the query matches |
| Subject tag | `npj-project:<Name>` | optional — groups the item under a project filter |
| Title / description | human-readable | recommended — shown on the card |
| License | CC-BY-4.0 | per our standards |

Add tags at upload time (<https://archive.org/upload> → *Subject tags*) or
afterwards from the item's **Edit metadata** page. New or re-tagged items appear
once the archive.org search index refreshes — minutes up to about an hour.

The query lives in `window.NPJ.ARCHIVE` (`app/archive-sources.js`): change `tag`
to rename the convention, or set `extraQuery: 'uploader:"you@example.com"'` to
pin the page to a single IA account so nobody else can tag their way in.

## Running

Open `index.html` in a browser (or serve the folder statically — it's the entry
the repo serves at its root). It uses in-browser Babel — no build step — but the
front page no longer waits on it: `app/boot.js` compiles just the front-page core
before first paint, streams the reader + editor in afterwards, and caches every
file's compiled output in the browser (so a returning visitor skips Babel and all
transpilation), with a service worker (`sw.js`) caching the shell for instant
repeat loads. Matrix calls go straight to the homeserver (`hyphae.social`), which
is CORS-open per the Matrix spec. The UI (including the Newsroom editor) is
responsive down to phones.

**Closed network, for now.** Only the founding admin — and the contributors the
admin adds — can open the Newsroom and draft/edit; everyone else gets the email-a-tip
path. That allowlist is the same role model above, so opening the network up later
is just adding editors. **Drafts are durable:** they autosave to this browser
*and*, once you sign in, to your Matrix account — so a refresh, a closed tab, or a
switched/wiped device no longer loses work (see `app/drafts.js`).

## Backend

See [`backend/README.md`](backend/README.md). Publishing (articles *and* the
layout config) goes through one n8n webhook that re-verifies the caller's Matrix
token before committing to `clovenbradshaw-ctrl/npj`.
