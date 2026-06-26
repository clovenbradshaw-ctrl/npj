# Vendored: eoreader4 (model-free reading core)

This directory is a **partial, pinned vendor** of
[eoreader4](https://github.com/clovenbradshaw-ctrl/eoreader4) (MIT) — only the
self-contained, **mechanical (no model / no network / no WASM)** slice needed to
read prose into an Event-Order proposition graph.

- **Upstream commit:** `779a6b77506be78f5d36b13d58a80c7227eb98bf` (branch `main`)
- **Entry used by npj:** `src/organs/in/text.js` → `ingestText(textOrFile)` and
  `src/core/index.js` → `projectGraph(log, frame)`.
- **What `ingestText` gives back:** a `doc` with `.sentences`, `.log`,
  `.mentions`, `.admission` (the admitted figures, with `.counts`/`.mentions`),
  and `doc.projectGraph(frame)` → `{ entities: Map, edges: [], ... }` where edges
  carry `{ from, to, via, kind, weight, sentIdx }`. npj's Definitions section
  reads `doc.admission` to rank a piece's terms — no eoreader4 code is added or
  copied in for it; the ranking + sizing live in `app/definitions.js`.

## Scope of the vendor (53 files)

Computed as the exact static-import closure of `src/organs/in/text.js`:
`src/core/**`, `src/perceiver/**` (incl. `perceiver/parse/**`),
`src/organs/in/text.js`, and `src/converse/**`. **Zero third-party imports**,
no `src/model/`, no embedder, no WebGPU/WASM. The full upstream app (UI, model
backends, retrieval, turn pipeline, etc.) is intentionally **not** vendored.

## How npj loads it

eoreader4 is vanilla **ES modules**; npj is a no-build, window-global app. The
seam is `app/eoreader4-bridge.js` (`<script type="module">`), which imports the
entries above and publishes `window.EOReader4`. ES modules require the app to be
served over **http(s)** (it is, in deployment).

## Updating

Re-pin by refetching the import closure of `src/organs/in/text.js` at a new
commit from `raw.githubusercontent.com`, overwriting this tree, and bumping the
sha above. Do not hand-edit these files — keep them byte-faithful to upstream so
the engine stays swappable.
