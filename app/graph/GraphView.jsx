/* GraphView.jsx — window.GraphView.
 *
 * The "Graph" top-level view: the live document read into a proposition graph by
 * eoreader4 (window.EOReader4 via app/prop-graph.js) and drawn by the imperative
 * SVG renderer (window.NpjGraphRender). React owns only the lifecycle + status;
 * the physics/SVG live in a plain host element so React never re-renders per frame.
 *
 * Props:
 *   text             plain text of the article (the Newsroom debounces this)
 *   onSelectSentence (sentIdx, label) => void   — jump back to the prose
 *   NR, isMobile     theme + layout
 *   bar              show the reading-cursor bar (default true; false = compact rail)
 *
 * The engine is an ES module loaded by a deferred <script type="module">, so it
 * can arrive AFTER this mounts — we guard on window.EOReader4 and re-run on the
 * `eoreader4-ready` event. On file:// the module import fails and we say so.
 */
(function () {
  function GraphView({ text, onSelectSentence, NR, isMobile, bar }) {
    const hostRef = useRef(null);
    const apiRef = useRef(null);
    const [engineReady, setEngineReady] = useState(!!(window.EOReader4 && window.EOReader4.ready));
    const [status, setStatus] = useState("loading"); // loading | ready | empty | noengine | error
    const [errMsg, setErrMsg] = useState("");

    // wait for the deferred engine module
    useEffect(() => {
      if (engineReady) return;
      const onReady = () => setEngineReady(true);
      window.addEventListener("eoreader4-ready", onReady);
      const t = setTimeout(() => { if (window.EOReader4 && window.EOReader4.ready) setEngineReady(true); }, 400);
      return () => { window.removeEventListener("eoreader4-ready", onReady); clearTimeout(t); };
    }, [engineReady]);

    // (re)build the graph when the text or engine readiness changes
    useEffect(() => {
      let alive = true;
      if (!engineReady || !window.NpjPropGraph || !window.NpjGraphRender) { setStatus("noengine"); return; }
      const t = (text || "").trim();
      if (apiRef.current) { apiRef.current.destroy(); apiRef.current = null; }
      if (t.length < 40) { setStatus("empty"); return; }
      setStatus("loading");
      window.NpjPropGraph.docFor(text).then((doc) => {
        if (!alive) return;
        if (apiRef.current) { apiRef.current.destroy(); apiRef.current = null; }
        if (hostRef.current) {
          apiRef.current = window.NpjGraphRender.renderPropGraph(doc, hostRef.current, { onSelectSentence, bar });
          const g = doc.projectGraph({});
          setStatus(g.entities && g.entities.size ? "ready" : "empty");
        }
      }).catch((err) => {
        if (!alive) return;
        const m = String((err && err.message) || err);
        // a failed ES-module import (file://, or the engine never loaded)
        if (/not-loaded/.test(m)) { setStatus("noengine"); }
        else { setErrMsg(m); setStatus("error"); }
      });
      return () => { alive = false; };
    }, [text, engineReady, onSelectSentence, bar]);

    // teardown on unmount
    useEffect(() => () => { if (apiRef.current) { apiRef.current.destroy(); apiRef.current = null; } }, []);

    const muted = (NR && NR.muted) || "#8c8676";
    const soft = (NR && NR.soft) || "#b3ad9c";
    const banner = (txt, sub) => (
      <div className="np-mono" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center", padding: 24, color: muted, pointerEvents: "none" }}>
        <div style={{ fontSize: 12.5, color: soft }}>{txt}</div>
        {sub ? <div style={{ fontSize: 10.5, maxWidth: 360, lineHeight: 1.5 }}>{sub}</div> : null}
      </div>
    );

    return (
      <div className="graph-view" style={{ position: "relative", width: "100%", height: "100%", minHeight: isMobile ? 320 : 0, overflow: "hidden" }}>
        {status === "loading" && banner("Reading the document…", "Parsing prose into propositions.")}
        {status === "empty" && banner("Not enough to graph yet", "Write a few sentences — entities and the relations between them appear here as names and verbs recur.")}
        {status === "noengine" && banner("Reading engine unavailable", "The eoreader4 engine loads as an ES module and needs the app served over http(s). It is unavailable on file:// or before the module finishes loading.")}
        {status === "error" && banner("Couldn't build the graph", errMsg)}
        <div ref={hostRef} className="graph-host" style={{ width: "100%", height: "100%" }} />
      </div>
    );
  }

  window.GraphView = GraphView;
})();
