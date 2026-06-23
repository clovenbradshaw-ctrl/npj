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
| `app/layout.jsx` | the editable site chrome, the **front-page lineup** model (slug ordering + layout templates), the permission model, and the public **contributor profiles** map |
| `app/profiles.js` | contributor profiles — the byline **name + ≤250-char "About me"**, saved to the contributor's Matrix account (pulled from their account info) and folded into the public layout |
| `app/Contributors.jsx` | the public **masthead** — every contributor with their role and About me |
| `app/FrontPage.jsx` | the masthead + front page — renders each piece through the admin's chosen layout template (`FrontCard`) |
| `app/AdminEditor.jsx` | the admin **Edit layout** panel — section nav, taglines, brand, roles, contributor profiles, and the front-page lineup editor |
| `app/matrix-auth.js` | real Matrix client-server auth, roles, profile & room recovery |
| `app/drafts.js` | durable drafts — localStorage + Matrix account-data sync (survive refresh & browser wipe) |
| `app/Newsroom.jsx` | the editor: manual span-bound sourcing, images, tags, invites — mobile-responsive |
| `app/GroundingWorkspace.jsx` | the grounding workspace — four pivoting views of the same draft (Prose / Grounding / Citations / Sources), the publish-gate strip, the cite modal and Citey's walkthrough |
| `app/citations.js` · `app/sentences.js` | the grounding model: reusable citation records (pinned spans of a source, multi-part supported) + live sentence segmentation |
| `app/Documents.jsx` | the **article** explorer — bucketed by **project**, each project a card with permission controls (invite by Matrix ID), its articles, and the **shared source shelf** (deduped + backtracked) |
| `app/sources.js` | source provenance — synthetic content **dedup** (one signature per document, linked across projects/articles, never deleted) + **backtracking** (source → every article that cites it) |
| `app/Citey.jsx` | the drafting assistant — a margin mascot whose face is the mechanical grounding state (⊥ ungrounded → ⊤ grounded); offers **pin a source line** or **own it** (⊢/⊨/⊩), reflects the publish gate, suggests **tags**. Sits small and quiet (idle bob + "boil" + blink), comes forward on hover/flag, and plays an **interstitial morph** each time he changes shape (motion-reduced for `prefers-reduced-motion`) |
| `app/CiteyBrain.js` | the mechanical layer — reads the editor's live grounding (pinned / owned / undeclared) into Citey's states; **no model** |
| `app/CiteyVoice.js` · `app/citey-assist.js` | leashed (templated) speech; mechanical tag-suggest + source-span ranking (never invents a citation) |
| `app/pii.js` | the **pii-v2 pack** — mechanical recognizers (regex + checksum + context, **no model**) for data-shaped PII: phones, SSNs, cards, addresses, emails…; detects candidate spans and hard-redacts them |
| `app/CiteyRedact.jsx` | **Citey's PII review** — the modal that gates a source on its way to archive.org: hard-redact or affirm each flagged span, plus broad document editing |
| `app/versions.jsx` | article version history + word-level diff |
| `app/feedback.js` | **span feedback** — readers suggest an edit (or comment) on any selected words; stored as EVA events in the article's folder + a local mirror; an editor **merges** (apply + commit a REC) or declines |
| `app/SuggestionRail.jsx` | the review surface — PR-shaped cards (diff, rationale, 👍, threaded replies) with **Merge / Decline** for editors |
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
  **Reusing a record is one search away:** the cite modal and the grounding card
  both carry a searchable **Reuse an existing citation** browser over the *whole*
  registry (best mechanical match first, but never hidden behind a threshold), so
  a citation you've already pinned attaches in one click instead of being hunted
  down in its source and re-grabbed.
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

**The page knows its own media.** The contents rail keeps a census of every
image and embed in the piece; image thumbnails open a full-size viewer
(arrows page through, esc closes, "show in document" jumps to the figure).

**Every article has a subtitle.** A dek line sits under the headline (older
drafts get the field on restore); it publishes as the italic standfirst and
rides the article's EO genesis event as `dek`.

**The filename is the author's call.** It follows the headline by default,
but the publish gate has a rename field — a custom name sticks with the
draft and the committed file is named accordingly.

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

For a file type Citey can't read inside the browser (PDF, image, `.docx`), the
review offers **paste-or-affirm**: paste the text for a real scan, or vouch that
you've checked it. He's a first pass that surfaces candidates — **never a
guarantee** — so for source-identifying material the human stays the decider.

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
