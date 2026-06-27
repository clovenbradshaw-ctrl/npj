# NPJ publish backend

> **Auth is the Matrix token now.** The live publish webhook
> (`POST https://n8n.intelechia.com/webhook/site/publish-npj`) takes
> `Authorization: Bearer <Matrix access token>`, re-checks it with `whoami` on
> hyphae.social, and authorizes against the roles committed in
> `site/layout.json`. No separate publish secret. Body:
> `{ filename, mode, contentRaw, message }`. It serves the EO article logs
> (per-document version folders `articles/<slug>/` + legacy
> `articles/<slug>.jsonl`), the site layout + roles (`site/layout.json`, via
> `npj-layout.client.js`), and `chain_head.json`. Permissions also mirror to a
> Matrix control-room state event (`press.npj.permissions`) only admins can write.

## Article content lives on archive.org — read AND write

**Articles no longer touch GitHub.** Both reading and writing happen on the
Internet Archive (`app/record/articles.js`). GitHub still hosts the *layout +
roles* (`site/layout.json`) — that's where the auth gate reads roles from — but
the article event logs are archive.org-native:

- **One item per article** — `npj-article-<slug>` / `<slug>.jsonl` — holds the
  full append-only EO event log, so `loadArticle()` fetches and folds it directly
  (no GitHub, no API rate limit). Bodies are cached in the browser (Cache Storage,
  keyed by the manifest version) and served stale-while-revalidate, and the whole
  line-up is **prefetched in the background** after the front page paints, so
  opening any piece is instant.
- **Writing appends one line** to that same file via the article webhook below —
  publish (INS), edit (REC), unpublish/republish (REC status) and reader feedback
  (EVA) all append to `<slug>.jsonl`. There is no version-file folder and no git
  history anymore: the append-only log *is* the history.

### `POST /webhook/site/article-npj` — append to the log (`npj-article.n8n.json`)

```jsonc
// Authorization: Bearer <matrix token>
{ "slug": "demo-article", "line": "{\"v\":\"npj/article-eo/1\",\"op\":\"INS\",…}", "message": "publish: demo-article" }
```

The webhook re-verifies the token (admin always; editor only if the article is
new or lists them in its genesis `assignees`), **GETs** the current
`<slug>.jsonl`, **appends** the line, and **PUTs** it back (read-modify-append —
IA S3 has no atomic append, so the node owns the merge). Returns
`{ ok, url, bytes, base_sha }`. Import `npj-article.n8n.json` alongside the
manifest workflow (same IA S3 keys, same role gate). **Concurrency:** two writers
appending to one slug in the same instant can race (last PUT wins, one line lost)
— fine for single-author editorial writes; a lost reader EVA can be re-sent. The
old GitHub `publish` flow is now only used for `site/layout.json` + `chain_head`.
- **One site manifest** — `npj-site` / `manifest.json` — is the front-page
  line-up: a compact meta row per piece (`slug, headline, dek, column, image,
  published, updated, status, versions, readMins, ver`). The front page paints
  from this single fetch and is **never gated on article-body downloads**.

### Validation: the manifest is the trust anchor

Anyone can upload an item and tag it `npj-article`, so the subject tag alone is
**not** trusted — it's only a bootstrap fallback (`searchArchiveDocs`, optionally
pinned to an uploader via `window.NPJ.ARCHIVE.articleQuery =
'uploader:"you@example.com"'`) for the window before a manifest exists. The
**manifest** is the real trust anchor: the reader trusts a slug *because it is
listed in our manifest*, and only an authorized admin/editor can write that —
through the manifest webhook below, which re-verifies the Matrix token and PUTs
with our IA S3 keys to the `npj-site` item we own. A stranger's self-tagged
upload therefore never enters the site.

### `POST /webhook/site/manifest-npj` — write the manifest (`npj-manifest.n8n.json`)

```jsonc
// Authorization: Bearer <matrix token>   (admin/editor, same gate as publish)
{ "identifier": "npj-site", "filename": "manifest.json",
  "manifest": { "v": "npj/site-manifest/1", "updated": "…", "articles": [ /* meta rows */ ] } }
```

The **client sends the full manifest** (`app/record/articles.js` →
`publishManifest` / `syncArticleToManifest` / `patchManifestStatus`), so the
webhook is a plain overwrite — no server-side merge, no half-merged race. It
fires after every publish, edit, revert, merge and unpublish/republish, so the
index **updates over time** without waiting on archive.org's search index
(which can lag minutes to ~an hour). Import `npj-manifest.n8n.json` into the same
n8n instance as the publish workflow (it reuses the same IA S3 keys and the same
Matrix role gate). Until it's deployed, the reader falls back to the tag search
and still works — just unvalidated and subject to the search-index lag.

## Articles are EO event logs — one folder of version files per document

A published article is **not** a markdown file: it's an append-only log of EO
events, schema `npj/article-eo/1` (reader/writer: `app/articles.js`). Each
document owns a folder, and every event is committed as a **brand-new
timestamped file** inside it:

```
articles/<slug>/20260610T231501123Z-ins-x7k2.jsonl   ← publish (INS)
articles/<slug>/20260611T010203456Z-rec-9bd1.jsonl   ← edit / unpublish / republish (REC)
```

```jsonl
{"v":"npj/article-eo/1","op":"INS","target":"article/<slug>","ts":"…","actor":"@…",
 "operand":{"slug","headline","dek","column","tags","authors","assignees","published","body","sources"}}
{"v":"npj/article-eo/1","op":"REC","target":"article/<slug>","ts":"…","actor":"@…",
 "note":"why","operand":{ …only the fields that changed… }}
```

- **Every write is a CREATE.** Publish, edit, unpublish, republish — each POSTs
  `mode:'overwrite'` with a filename that doesn't exist yet, so the webhook
  always takes its create path. The old single-file `append` mode rode GitHub's
  update-with-SHA call, which kept rejecting commits (409/422); create-only
  version files can't conflict. `append` remains in the workflow only for
  legacy single-file logs.
- **Re-uploading the same document** lands a newer `INS` file: the reader's
  fold restarts from it (it becomes the current version) and every earlier
  version file stays put — version control for free.
- `operand.assignees` (set at publish, editable by the admin) is the edit
  allowlist for that article: **admin + assignees** may edit. Future ops (e.g.
  EVA suggestion deposits) can land in the same folder without breaking readers.
- Legacy single-file logs (`articles/<slug>.jsonl`) are still read; they fold
  in before the folder's version files.
- One-off migration for legacy `.md` articles: `node backend/md-to-eo.mjs <file.md>`.

> ⚠️ **Re-import `npj-publish.n8n.json` after pulling this version** — the live
> instance must pick up the folder-path rule, or **editors** (not admins, whose
> rule covers any filename) get a 401 when publishing into `articles/<slug>/`.
> The flow is:
>
> ```
> Publish Webhook → Whoami (hyphae.social) → Fetch Roles (raw site/layout.json)
>                 → Authorize → Authorized? → GH Get File → Build Content
>                 → Forbidden? → GH Update / GH Create → OK
> ```
>
> Rules enforced server-side (`Authorize` + `Build Content`):
> - `site/layout.json` (layout + roles) → **admin** only
> - any other file → **admin** only
> - `articles/<slug>.jsonl` **or** `articles/<slug>/<version>.jsonl` →
>   **admin**, or an **editor** (per the committed roles) — and a non-admin
>   touching an existing document must be in its genesis `assignees`
>   (otherwise **403**). For a legacy flat log the genesis is line 1 of the
>   fetched file; for a version folder, `Build Content2` lists the folder and
>   reads the earliest file (via `this.helpers.httpRequest`, best-effort). A
>   brand-new document (empty folder) just needs the editor role.
> - nothing committed yet (bootstrap) → only the founding admin passes
>
> After importing: re-bind the GitHub OAuth2 credential on the `GH *` nodes and
> activate the workflow. The static secret now only guards the separate
> chain-head webhook.

> **n8n is publish-only now.** No app data is stored in n8n. When a piece is
> published it is committed to **GitHub** and frozen to **archive.org**; the
> archive.org snapshot is the canonical shareable link (surfaced in-app with the
> basic social share targets). The suggestion-storage workflow
> (`npj-api.n8n.json` + Data Table) is therefore optional/deprecated — keep it
> only if you want server-side suggestion storage instead of GitHub JSONL.

> **Images never reach the _publish_ webhook as bytes.** A photo dropped into an
> editor uploads to the Matrix media store while drafting (`app/media-store.js`),
> and at publish/save is moved onto **archive.org** through a separate media
> webhook (below). Only the resulting archive.org URL rides into the committed
> JSONL, so the repo stays plaintext + auditable and no base64 is ever committed.

## Media: draft to the Matrix store, publish to archive.org

Image bytes never ride a GitHub commit, and the archive.org S3 keys never reach
the browser — so media moves in two steps:

1. **Draft → Matrix media store.** A dropped photo uploads straight to the
   author's homeserver media repo (`app/media-store.js` → `/_matrix/media/v3/upload`,
   the author's own session) and the draft references the returned `mxc://…` as an
   https download URL. No bytes, no base64 in the draft — just a durable URL.
2. **Publish → archive.org (`/webhook/site/media-archive-npj`).** For every
   media-store image still in the body, `app/media-store.js` derives the `mxc`
   from that URL and POSTs `{ mxc, identifier, filename, mimetype, title }` with
   the author's Matrix Bearer token. The `MArc *` branch verifies the token +
   role, **pulls the bytes from the homeserver server-side** (authenticated, so it
   works even when the homeserver gates media behind auth), PUTs them to
   `s3.us.archive.org`, and returns `{ ok, url }` — the archive.org URL swapped
   into the committed JSONL. If the endpoint can't be reached the app falls back
   to a Wayback snapshot; if *that* also fails the publish is blocked (a
   media-store URL must never land in the committed record).

```
MArc Webhook → MArc Whoami → MArc Fetch Roles → MArc Authorize → Authorized?
             → MArc Fetch Bytes (Matrix) → MArc Prep → MArc IA Put (S3) → MArc Result → MArc OK
```

The server-side pull + S3 PUT is synchronous and **can take up to a minute per
image**, so the browser waits ~120s before giving up and the publish UI shows a
"moving N images to archive.org…" step.

Setup in n8n (one-time):
- Add two **environment variables**: `IA_S3_ACCESS` and `IA_S3_SECRET` (your keys
  from `archive.org/account/s3.php`). The IA Put node sends
  `authorization: LOW $IA_S3_ACCESS:$IA_S3_SECRET` — keep the keys in env, **never
  hard-coded in the node** (a committed workflow JSON is public).
- Re-import `npj-publish.n8n.json` and **activate**. The media branch needs no
  GitHub cred (it only talks to the homeserver + archive.org).

> ✅ **The committed `npj-publish.n8n.json` now carries this branch.** It registers
> both `site/media-npj` (draft upload → Matrix store) and `site/media-archive-npj`
> (the `MArc *` publish-time migration the app calls), so the committed copy matches
> the live instance. Re-import it and **activate** to deploy; the IA keys come from
> the `IA_S3_ACCESS` / `IA_S3_SECRET` env vars above — the JSON references
> `$env.IA_S3_*`, never a literal key (a committed workflow JSON is public).

> ⚠️ The IA Put node uses n8n's HTTP Request binary-body mode
> (`contentType: binaryData`). If your n8n version names that differently, fix it
> once on the node, and confirm a test publish returns `{ ok:true, url }` from
> `media-archive-npj` before relying on it.

n8n workflow (`npj-publish.n8n.json`) — five POST webhooks, each its own branch
off the same workflow. The publish + chain-head branches commit to
`github.com/clovenbradshaw-ctrl/npj` (main), committing whatever `contentRaw`
they receive (everything stays plaintext and auditable); the media + source
branches move bytes to archive.org instead.

| Webhook path | Branch | What it does |
|---|---|---|
| `site/publish-npj` | `Publish Webhook → … → GH Update / GH Create → Mirror? → Publish OK` | commit an article/layout/profile to GitHub, then mirror a snapshot to archive.org |
| `site/media-npj` | `Media Webhook → … → Media OK` | draft-time image upload → Matrix media store, returns `{ ok, mxc }` |
| `site/media-archive-npj` | `MArc Webhook → … → MArc OK` | publish-time migration: pull one image from Matrix by `mxc`, PUT to archive.org, return `{ ok, url }` |
| `site/source-npj` | `Source Webhook → … → Source OK` | redaction-gated source-document upload → archive.org |
| `chain-head-npj` | `Chain Head Webhook → … → Chain OK` | commit `chain_head.json` (static-token auth) |

```
Publish Webhook → Whoami → Fetch Roles → Authorize → Authorized? → GH Get File → Build Content → Forbidden? → Exists? → GH Update / GH Create → Check GH Result → Mirror? → (Mirror to Archive.org) → Publish OK
```

## Span feedback rides the article's own folder (EVA deposits → merge as REC)

Reader feedback — a span-anchored **suggestion** (the exact words it would
change) or a **comment** — is stored as one more EO event in the *same*
per-document folder as the article, schema `npj/feedback-eo/1`
(reader/writer: `app/feedback.js`):

```
articles/<slug>/20260619T2031Z-eva-7f3k.jsonl   ← a reader's suggestion (EVA)
articles/<slug>/20260619T2105Z-eva-9bd1.jsonl   ← a 👍 / reply / resolution (EVA)
```

```jsonl
{"v":"npj/feedback-eo/1","op":"EVA","target":"article/<slug>","ts":"…","actor":"@reader:hs",
 "operand":{"id":"fb-…","kind":"suggestion","anchor":{"quote":"…","prefix":"…","suffix":"…","claimId":null},
            "proposed":"…","rationale":"…","base_sha":"a3f9c1e"}}
{"v":"npj/feedback-eo/1","op":"EVA","target":"article/<slug>","ts":"…","actor":"@editor:hs",
 "operand":{"id":"fbr-…","ref":"fb-…","act":"resolve","outcome":"merged","commit_sha":"…"}}
```

- **EVA folds as a no-op for the article reader** (`app/articles.js` keeps it in
  `events[]` but never touches article state), so feedback shares the folder
  without changing a single published word. The merge is the only thing that
  edits the prose, and it goes through the ordinary **REC** edit path.
- **Anchoring is re-locatable.** A span is pinned by its quote plus a little
  context on each side (or a bound claim's stable id); `app/feedback.js` finds it
  again in the live text even after the article moves on, and flags a suggestion
  "stale" when its `base_sha` has been superseded.
- **Merge = apply + commit.** An editor's *Merge* applies the proposed words to
  the body and commits a normal `REC` (attributed, with the reader's rationale as
  the edit note), then writes a resolution EVA marking the suggestion `merged`.
  A suggestion whose words are gone is a clean **conflict**, never a silent wrong
  edit — the pull-request idea (propose → review-in-context → merge/decline)
  without the pull-request UX.
- **Local mirror.** Every write is also mirrored to `localStorage`, so feedback
  survives a refresh and the whole flow is demonstrable before the webhook rule
  below is live.

### Webhook rule to add (publish workflow)

The commit path is the same `POST …/webhook/site/publish-npj`. Two new things
for the `Authorize` + `Build Content` nodes:

| File written | Who | Notes |
|---|---|---|
| `articles/<slug>/<stamp>-eva-<tail>.jsonl` | **any whoami-verified Matrix user** | proposing/commenting/voting is open — an EVA can't change article state, so it doesn't need editor or assignee rights |
| the merge `…-rec-….jsonl` | **admin / assignee** (unchanged) | merging is an ordinary edit; the existing REC rule already gates it |

So: relax the existing rule to let a *verified* user create an `*-eva-*.jsonl`
inside `articles/<slug>/` (no role/assignee check), while every `*-rec-*` and
`*-ins-*` write keeps its current admin/editor+assignee gate. Anonymous (no
Matrix account) feedback can ride the separate **Suggestion API**
(`npj-api.n8n.json`, `propose` op) instead — same lifecycle, Data-Table storage.

## Contributor profiles — the byline (name + "About me")

Every story is bylined to its contributors, and each contributor has a public
display **name** and a ≤250-char **About me**. Today these live in the
world-readable `site/layout.json` under a `contributors` map:

```json
"contributors": {
  "@reporter:hyphae.social": { "name": "Sam Reporter", "bio": "Covers housing and the courts." }
}
```

- **Read** is a plain GitHub read — the app folds `layout.contributors` into the
  byline at boot (no auth). The display name **defaults from the contributor's
  Matrix account** (their homeserver displayname), so a new byline is right
  without typing.
- **Write today is admin-only.** A contributor edits their own profile in-app
  (Documents → *Your byline & About me*); it saves durably to **their Matrix
  account** (`press.npj.profile` account data) and shows in their byline live.
  The **admin's** "Publish layout" commits everyone's profiles into the public
  `site/layout.json` (the existing admin-only `site/layout.json` rule covers it —
  no workflow change needed). An admin editing their *own* profile publishes it
  straight away. This is the live default: **no public self-write yet.**

### Ready-to-enable: self-service profiles direct to GitHub

To let a **non-admin** contributor publish their own profile without waiting on
an admin — same spirit as the open EVA-feedback rule — add ONE rule to the
`Authorize` + `Build Content` nodes. A verified user may write **only their own**
profile file, keyed by their mxid:

| File written | Who | Notes |
|---|---|---|
| `site/contributors/<localpart>=<domain>.json` | **the whoami-verified owner only** | the path must encode the caller's own `user_id` (`@a:b` → `a=b.json`); body is `{ name, bio }`, bio clamped to 250 — a profile can't change article state or anyone else's entry, so it needs no role |

So: relax the rule to let a verified user create/overwrite the single file whose
name decodes back to their own `user_id` (reject any other path with **403**),
while every `site/layout.json`, `*-ins-*` and `*-rec-*` write keeps its current
gate. The app would then read `site/contributors/` (one git-tree call, like the
front page) and fold those per-user files over the `layout.contributors` map.
The client plumbing already exists (`app/profiles.js`: durable account-data
save + a stable shape); flipping this on is purely the webhook rule above plus a
directory read. **Not wired into the live flow yet** — documented so it's ready.

## Optional: EO-notation formatting (client-side)

If you want commits stored as EO events instead of raw content, `eo-event.client.js`
wraps content in one plaintext JSONL line before the POST — `append → EVA`,
new → `DEF`, republish → `REC`. Nothing encrypted; the n8n side doesn't change.

```js
import { publish } from './eo-event.client.js';
await publish({
  endpoint: 'https://YOUR-N8N/webhook/site/publish-npj',
  token:    '…',
  filename: 'the-37013-squeeze.md',
  content:  '# The 37013 Squeeze\n…',
  mode:     'overwrite',
  author:   '@dani:npj.press'
});
```

Skip it entirely and POST `contentRaw` directly if you'd rather keep raw markdown.

## Setup

| What | Where |
|---|---|
| GitHub OAuth2 cred | the `GH *` nodes — write access to `clovenbradshaw-ctrl/npj` |
| `CHANGE_ME_SECRET` | `Auth Check1` rightValue — the **chain-head** scraper token only; the publish path needs no secret (Matrix whoami) |
| Founding admin mxid | the `Authorize` code node (`ADMIN`) — must match `MatrixAuth.ADMIN_MXID` |

## Suggestion API (`npj-api.n8n.json`)

The auth front for reader actions. A request is authenticated **either** by a
service token (`NPJ_INGEST_TOKEN` in the body) **or** a Matrix access token
(`Authorization: Bearer …`, verified via `/_matrix/client/v3/account/whoami`).
It resolves identity to `{ mxid, role: service|editor|user, op, body }` and ends
at the **Authenticated** node.

- Ops: `read | propose | resolve | delete` — these map 1:1 to the prototype's
  suggestion lifecycle (`propose` → deposit an EVA, `resolve` → REC accept / NUL
  reject, `delete` → remove).
- `role` is `editor` when the mxid is in `NPJ_EDITORS` (comma-separated env).
- `npj-api.client.js` is a ~20-line browser client for these four ops.

| Env | Purpose |
|---|---|
| `NPJ_INGEST_TOKEN` | service-caller token |
| `MATRIX_BASE_URL` | homeserver base for `whoami` |
| `NPJ_EDITORS` | comma-separated editor mxids → `role: editor` |

### Wired downstream

After **Authenticated**, the workflow routes by `op` and authorizes per op:

| op | who | Data Table action | response |
|---|---|---|---|
| `read` | anyone | get rows where `article` | `{ ok, suggestions: [...] }` |
| `propose` | any authed user | insert row (status `proposed`, votes 0, `author_mxid`) | `{ ok, id }` |
| `resolve` | **editor / service only** | update `status` where `id` | `{ ok, id, status }` |
| `delete` | **editor / service only** | delete row where `id` | `{ ok, id }` |

Non-editors hitting `resolve`/`delete` get **403**; an unknown op gets **400**.

**Data Table to create** (`suggestions`), then bind it on the four `DT · …` nodes:

```
id (string) · article (string) · base_sha (string) · range (json/string)
proposed (string) · rationale (string) · author_mxid (string)
status (string: proposed|review|accepted|rejected) · votes (number) · ts (string)
```

> The `DT · …` nodes use best-guess operation/filter keys — if your n8n's Data
> Table version names them differently, fix the dropdown once and the wiring holds.

## Troubleshooting: publish answers `ok:false` / `error:"github commit failed"`

If the publish webhook returns
`{ ok:false, statusCode:502, error:"github commit failed", gh_status:null }`,
the GitHub commit failed but the **real reason was swallowed**. `GH Update2` /
`GH Create2` run with `continueOnFail`, so a GitHub 4xx/5xx arrives as data — but
the `Check GH Result` node read `gh.error?.message`, while n8n usually puts the
error in `gh.error` as a *string* and the HTTP status outside `gh.status`. So it
collapsed to the generic message and `gh_status:null` — which also disables the
front end's 409/422 **Retry publish** button.

Replace the `Check GH Result` node's code with this — it surfaces the real status
+ message across n8n's error shapes, and reports a true success only when a commit
SHA comes back:

```js
// Surface the REAL GitHub outcome — don't swallow it as a generic failure.
// GH Update2 / GH Create2 run with continueOnFail, so a 4xx/5xx from GitHub
// lands here as data. n8n shapes that error differently across versions:
//   { error: "message string" }   ·   { error: { message, httpCode } }
//   sometimes a top-level .status / .statusCode, sometimes nested in .context.
// A success returns the GitHub API body: { commit:{sha}, content:{sha} }.
const gh = $input.first().json || {};
const build = $('Build Content2').first().json || {};

const errObj = gh.error;
const errMsg = (typeof errObj === 'string' ? errObj
  : (errObj && (errObj.message || errObj.description))) || gh.message || null;

const ctx = (errObj && (errObj.context || errObj.cause)) || {};
const ghStatus = Number(
  gh.status || gh.statusCode || gh.httpCode ||
  (errObj && (errObj.httpCode || errObj.status || errObj.statusCode)) ||
  ctx.httpCode || ctx.statusCode || 0
) || null;

const commitSha = (gh.commit && gh.commit.sha) || (gh.content && gh.content.sha) || null;
const hasError = !!errObj || (ghStatus && ghStatus >= 400) || (!commitSha && !!errMsg);
const statusCode = hasError ? (ghStatus || 502) : 200;

return [{ json: {
  ok: !hasError,
  statusCode,
  filename: build.filename,
  bytes: build.bytes,
  user_id: build.user_id,
  role: build.role,
  error: hasError ? (errMsg || 'github commit failed') : null,
  gh_status: ghStatus,
  commit_sha: commitSha,
}}];
```

Re-run the publish; the response now carries the true GitHub status + message.
Common causes:

- **401 / 403** ("Bad credentials" / "Resource not accessible by integration") —
  the GitHub OAuth2 credential on the `GH *` nodes expired or lost write scope.
  Re-bind / reauthorize it (needs `repo` / Contents: write on
  `clovenbradshaw-ctrl/npj`). This is the most common cause of a sudden
  every-publish failure.
- **409 / 422** — a blob-SHA race on overwrite. With `gh_status` now populated,
  the front end shows **Retry publish**; one re-POST (which re-fetches the SHA)
  resolves it.
- **413 / 422 "too large"** — an image is still embedded as a base64 `data:` URL
  in the body. Fresh drops upload to the media store and move to archive.org, but
  a *legacy* article edited through the reader's Edit overlay can round-trip an
  old embedded image. Re-insert the image (it uploads to the media store) and
  publish again.

> The committed `npj-publish.n8n.json` now carries this fix **and** the full
> response-contract topology (`Build Content2` → `GH Update2`/`GH Create2` →
> `Check GH Result` → `OK2`). Re-import it to apply the fix wholesale — then
> re-bind the **GitHub OAuth2 credential** on the `GH *` nodes (credential IDs
> don't transfer between n8n instances) and re-activate the workflow.

