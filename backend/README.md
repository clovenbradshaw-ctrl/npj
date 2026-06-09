# NPJ publish backend

> **Auth is the Matrix token now.** The live publish webhook
> (`POST https://n8n.intelechia.com/webhook/site/publish-npj`) takes
> `Authorization: Bearer <Matrix access token>`, re-checks it with `whoami` on
> hyphae.social, and authorizes against the roles committed in
> `site/layout.json`. No separate publish secret. Body:
> `{ filename, mode, contentRaw, message }`. It serves articles (`<slug>.md`),
> the site layout + roles (`site/layout.json`, via `npj-layout.client.js`), and
> `chain_head.json`. Permissions also mirror to a Matrix control-room state
> event (`press.npj.permissions`) only admins can write.

> ⚠️ **Re-import `npj-publish.n8n.json` after pulling this version.** The
> earlier export still gated the publish webhook on a `body.token ===
> CHANGE_ME_SECRET` check — but the app sends the Matrix token in the
> `Authorization` header and no `token` field, so every layout/article publish
> died with a 401. The workflow now actually implements the documented auth:
>
> ```
> Publish Webhook → Whoami (hyphae.social) → Fetch Roles (raw site/layout.json)
>                 → Authorize → Authorized? → GH Get File → … → GH Update/Create
> ```
>
> Per-file rules enforced by the `Authorize` node:
> - `site/layout.json` (layout + roles) → **admin** only
> - everything else (articles, …) → **admin or editor**, per the committed roles
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
  endpoint: 'https://YOUR-N8N/webhook/site/publish',
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

