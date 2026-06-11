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
| `articles/` | **the published record** — one folder per document (`<slug>/`) of timestamped version files, one EO event each; legacy single-file logs (`<slug>.jsonl`) still readable |
| `app/` | the React (in-browser Babel) front end |
| `app/articles.js` | the EO log store: lists `articles/` onto the front page, folds a document's version files into a readable article, publishes (INS) and commits edits (REC) — each as a brand-new file |
| `app/ArticleEdit.jsx` | edit-after-publish overlay — admin + the article's assignees |
| `app/data.js` | content layer — **framework only**, seeded empty |
| `app/layout.jsx` | the editable site chrome + the permission model |
| `app/matrix-auth.js` | real Matrix client-server auth, roles & room recovery |
| `app/drafts.js` | durable drafts — localStorage + Matrix account-data sync (survive refresh & browser wipe) |
| `app/Newsroom.jsx` | the editor: manual span-bound sourcing, images, tags, invites — mobile-responsive |
| `app/GroundingWorkspace.jsx` | the grounding workspace — four pivoting views of the same draft (Prose / Grounding / Citations / Sources), the publish-gate strip, the cite modal and Citey's walkthrough |
| `app/citations.js` · `app/sentences.js` | the grounding model: reusable citation records (pinned spans of a source, multi-part supported) + live sentence segmentation |
| `app/Documents.jsx` | the **article** explorer — bucketed by **project**, each project a card with permission controls (invite by Matrix ID), its articles, and the **shared source shelf** (deduped + backtracked) |
| `app/sources.js` | source provenance — synthetic content **dedup** (one signature per document, linked across projects/articles, never deleted) + **backtracking** (source → every article that cites it) |
| `app/Citey.jsx` | the drafting assistant — a margin mascot whose face is the mechanical grounding state (⊥ ungrounded → ⊤ grounded); offers **pin a source line** or **own it** (⊢/⊨/⊩), reflects the publish gate, suggests **tags**. Sits small and quiet (idle bob + "boil" + blink), comes forward on hover/flag, and plays an **interstitial morph** each time he changes shape (motion-reduced for `prefers-reduced-motion`) |
| `app/CiteyBrain.js` | the mechanical layer — reads the editor's live grounding (pinned / owned / undeclared) into Citey's states; **no model** |
| `app/CiteyVoice.js` · `app/citey-assist.js` | leashed (templated) speech; mechanical tag-suggest + source-span ranking (never invents a citation) |
| `app/versions.jsx` | article version history + word-level diff |
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
back **several spans**, each pinned to its own words. Sources are snapshotted to
archive.org; a claim that points at a page but no span fails the build.

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
  sources · ⊥ needs source · ⊩/⊨/⊢ owned · ¬ sources disagree), the citations
  attached to it, and its stance. Click a sentence and the panel shows its
  grounding card; click a citation chip and the panel pivots to the registry.
- **Citations** — the registry of reusable records. A citation is a pinned span
  of a source — exact words plus character offsets (multi-part when the support
  lives in more than one place). One record can back many sentences ("USED ×n");
  unlinking a sentence never destroys the record. **In context** opens the quote
  highlighted inside its source; **Usage ×n** lights up every sentence it backs.
- **Sources** — the documents themselves, rendered as paper with a letterhead
  (kind · title · archived-or-not). Search within the document, see every cited
  span highlighted in place, and — from any "+ Cite" — go in **armed**: Citey
  shades the passages he scents (mechanical word overlap, dotted, never a
  one-click pin), and you drag-select the exact words. Grab two spans if the
  support lives in two places; *⊕ Cite this span* mints the reusable record.

A **Ground truth** strip keeps the running tally (grounded / yours / conflicts /
needs sources) and the gate chip — **⚑ N blockers** until every sentence is
grounded or owned, **⊤ gate open** after. **Walk me through** hands Citey the
floor: he steps sentence-by-sentence through everything unsourced with one
honest choice each — 🔍 find support, or own it (Argue ⊩ / Assert ⊨ / Infer ⊢).
All of it reads and writes the same editor DOM and autosave as Prose; the views
can't diverge.

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

**The page knows its own media.** The contents rail keeps a census of every
image and embed in the piece; image thumbnails open a full-size viewer
(arrows page through, esc closes, "show in document" jumps to the figure).

**Every article has a subtitle.** A dek line sits under the headline (older
drafts get the field on restore); it publishes as the italic standfirst and
rides the article's EO genesis event as `dek`.

**The filename is the author's call.** It follows the headline by default,
but the publish gate has a rename field — a custom name sticks with the
draft and the committed file is named accordingly.

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
the repo serves at its root). It uses in-browser Babel — no build step. Matrix
calls go straight to the homeserver (`hyphae.social`), which is CORS-open per the
Matrix spec. The UI (including the Newsroom editor) is responsive down to phones.

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
