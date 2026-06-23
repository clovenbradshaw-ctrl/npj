/* eoreader4-bridge.js — the one seam between eoreader4 (vanilla ES modules) and
 * npj (no-build, classic <script> → window globals).
 *
 * Loaded as <script type="module"> in index.html. It pulls in only the vendored,
 * model-free reading core (see vendor/eoreader4/README.md) and publishes a tiny
 * surface on window.EOReader4, then fires `eoreader4-ready` so React views that
 * mounted before this deferred module ran can re-render.
 *
 * Module scripts are deferred — window.EOReader4 appears AFTER the classic app
 * scripts and the first React paint. Every consumer must guard on its presence
 * (the same way npj guards window.NpjStructure / window.StructureRail).
 *
 * ES modules need http(s); on file:// the import fails and the Graph view shows a
 * "serve over http" message instead of breaking the rest of the app.
 */
import { ingestText } from "../vendor/eoreader4/src/organs/in/text.js";
import { projectGraph, DEFAULT_PROJECTION_RULES } from "../vendor/eoreader4/src/core/index.js";

window.EOReader4 = {
  ingestText,                 // (textOrFile, opts?) -> Promise<doc>  (doc.projectGraph(frame), doc.sentences, doc.log, doc.mentions)
  projectGraph,               // (log, frame) -> { entities:Map, edges:[], propositions, voids }
  DEFAULT_PROJECTION_RULES,
  version: "eoreader4@779a6b7",
  ready: true
};

try { window.dispatchEvent(new Event("eoreader4-ready")); } catch (e) {}
