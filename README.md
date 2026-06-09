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
| `app/` | the React (in-browser Babel) front end |
| `app/data.js` | content layer — **framework only**, seeded empty |
| `app/layout.jsx` | the editable site chrome + the permission model |
| `app/matrix-auth.js` | real Matrix client-server auth, roles & room recovery |
| `app/drafts.js` | durable drafts — localStorage + Matrix account-data sync (survive refresh & browser wipe) |
| `app/Newsroom.jsx` | the editor: manual span-bound sourcing, images, tags, invites — mobile-responsive |
| `app/Clippy.jsx` | drafting assistant — suggests **tags** (never citations) |
| `app/versions.jsx` | article version history + word-level diff |
| `backend/` | n8n publish workflow + thin browser clients |
| `assets/` | logo + brand art |

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
2. **Sign in with Matrix** — contributors on the allowlist. No account yet? Pick a
   homeserver at <https://matrix.org/ecosystem/hosting/>.

## Sourcing is manual and span-bound

No AI touches citations. In the Newsroom you select the exact words that make a
claim and bind a source to **that span**. One source can back **several spans** in
the same piece (shared citation number). Sources are snapshotted to archive.org;
a claim that points nowhere fails the publish build.

## The Data explorer (`#explore`) is fed by archive.org tags

The Data page queries the Internet Archive's search API on load
(`app/archive-sources.js`) and lists every item carrying the NPJ subject tag —
each one becomes a searchable, previewable card on `#explore` and a citeable
source in the composer's **Cite a dataset** picker.

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
