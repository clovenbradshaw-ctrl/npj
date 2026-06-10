# NPJ publish backend

> **Auth is the Matrix token now.** The live publish webhook
> (`POST https://n8n.intelechia.com/webhook/site/publish-npj`) takes
> `Authorization: Bearer <Matrix access token>`, re-checks it with `whoami` on
> hyphae.social, and authorizes against the roles committed in
> `site/layout.json`. No separate publish secret. Body:
> `{ filename, mode, contentRaw, message }`. It serves the EO article logs
> (`articles/<slug>.jsonl`), the site layout + roles (`site/layout.json`, via
> `npj-layout.client.js`), and `chain_head.json`. Permissions also mirror to a
> Matrix control-room state event (`press.npj.permissions`) only admins can write.

## Articles are EO event logs (`articles/<slug>.jsonl`)

A published article is **not** a markdown file: it's an append-only JSONL log
of EO events, schema `npj/article-eo/1` (reader/writer: `app/articles.js`).

```jsonl
{"v":"npj/article-eo/1","op":"INS","target":"article/<slug>","ts":"…","actor":"@…",
 "operand":{"slug","headline","dek","column","tags","authors","assignees","published","body","sources"}}
{"v":"npj/article-eo/1","op":"REC","target":"article/<slug>","ts":"…","actor":"@…",
 "note":"why","operand":{ …only the fields that changed… }}
```

- **Publish** → the Newsroom POSTs `mode:'overwrite'` with the single `INS`
  genesis line (INS — mint an enduring anchor).
- **Edit after publish** → the reader's Edit overlay POSTs `mode:'append'` with
  one `REC` line (REC — restructure the frame). Nothing is rewritten; the file
  IS the article's complete change history, and the reader folds it into the
  current text + the version/diff viewer.
- `operand.assignees` (set at publish, editable by the admin) is the edit
  allowlist for that article: **admin + assignees** may edit. Future ops (e.g.
  EVA suggestion deposits) can append to the same log without breaking readers.
- One-off migration for legacy `.md` articles: `node backend/md-to-eo.mjs <file.md>`.

> ⚠️ **Re-import `npj-publish.n8n.json` after pulling this version** — the live
> instance must pick up the editor/assignee rules. The flow is:
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
> - `articles/<slug>.jsonl` → **admin**, or an **editor** (per the committed
>   roles) — and a non-admin touching an *existing* log must be in that log's
>   genesis `assignees` (checked against the fetched file; otherwise **403**).
>   A brand-new log (fresh publish) just needs the editor role.
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

## Media uploads → archive.org (`/webhook/site/media-npj`)

The browser can't reliably PUT to archive.org's S3 endpoint (CORS) and shouldn't
hold the IA keys, so the bytes go through n8n. `app/media-store.js` POSTs
`{ identifier, filename, mimetype, title, contentBase64 }` with the author's
Matrix Bearer token; the `Media *` branch verifies the token + role, decodes the
bytes, PUTs them to `s3.us.archive.org`, and returns `{ ok, url }`.

```
Media Webhook → Media Whoami → Media Fetch Roles → Media Authorize → Authorized?
              → Media Build (base64 → binary) → IA Put (S3) → Media Result → Media OK
```

Setup in n8n (one-time):
- Add two **environment variables**: `IA_S3_ACCESS` and `IA_S3_SECRET` (your keys
  from `archive.org/account/s3.php`). The `IA Put` node sends
  `authorization: LOW $IA_S3_ACCESS:$IA_S3_SECRET`.
- Re-import `npj-publish.n8n.json`, re-bind no GitHub cred needed for this branch
  (it only talks to archive.org), and **activate**.

> ⚠️ The `IA Put` node uses n8n's HTTP Request binary-body mode
> (`contentType: binaryData`, field `data`). If your n8n version names that
> differently, fix it once on that node. The branch is **untested against the
> live archive.org S3 endpoint from this environment** — confirm a test upload
> returns `{ ok:true, url }` before relying on it.

n8n workflow (`npj-publish.n8n.json`) — two webhooks that commit to
`github.com/clovenbradshaw-ctrl/npj` (main). It commits whatever `contentRaw`
it receives; everything stays plaintext and auditable.

```
Publish Webhook → Whoami → Fetch Roles → Authorize → Authorized? → GH Get File → Build Content → Exists? → GH Update / GH Create → OK
```

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

