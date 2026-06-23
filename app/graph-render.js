/* graph-render.js — window.NpjGraphRender.renderPropGraph(doc, root, opts)
 *
 * A no-library SVG node-link renderer for eoreader4's proposition graph, ported
 * (and trimmed) from eoreader4 src/ui/graph-view.js. It draws the fold of the
 * event log — entities as nodes (sized by how often they're sighted), subject-
 * verb-object relations as edges (thickness by coupling weight) — and lays them
 * out with a small spring/charge simulation in a fixed 600x460 space the SVG
 * scales to fit.
 *
 * Trimmed for npj: the upstream reading-panel (existence/structure/significance
 * strips, LLM "deepening", next-line prediction) is DROPPED — those need the
 * perceiver/enact/model holons we deliberately did not vendor. What stays is the
 * graph, the hover/drag/click interaction, and the reading-cursor slider that
 * re-projects the graph with gamma-decay around a position (pure projection).
 *
 * Styling is by CSS class (.gedge/.gnode/.glabel/...) defined in app/styles.css
 * against the newsroom --nr-* theme. Click a node -> opts.onSelectSentence(idx).
 */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var W = 600, H = 460, CX = W / 2, CY = H / 2, CAP = 40, GAMMA = 0.7;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function noop() { return { destroy: function () {}, reheat: function () {}, setCursor: function () {} }; }

  function renderPropGraph(doc, root, opts) {
    opts = opts || {};
    var onSelectSentence = opts.onSelectSentence;
    var showBar = opts.bar !== false;
    var cap = opts.cap || CAP;
    root.innerHTML = "";
    if (!doc || typeof doc.projectGraph !== "function") {
      root.innerHTML = '<div class="graph-empty">No document yet — write some prose and its graph appears here.</div>';
      return noop();
    }

    var base = doc.projectGraph({});
    var ents = Array.from(base.entities.values()).sort(function (a, b) { return b.sightings - a.sightings; });
    if (ents.length === 0) {
      root.innerHTML = '<div class="graph-empty">No figures yet. The graph fills in as names and relations recur in the prose.</div>';
      return noop();
    }

    var keep = new Set(ents.slice(0, cap).map(function (e) { return e.id; }));
    var mentions = doc.mentions || new Map();
    var units = doc.units || doc.sentences || [];
    var S = units.length;

    var nodes = ents.filter(function (e) { return keep.has(e.id); }).map(function (e, i) {
      var a = (i / keep.size) * Math.PI * 2;
      return {
        id: e.id, label: e.label, sightings: e.sightings,
        first: (mentions.get(e.id) || [])[0] != null ? (mentions.get(e.id) || [])[0] : (e.firstSeen != null ? e.firstSeen : 0),
        x: CX + Math.cos(a) * 170, y: CY + Math.sin(a) * 150, vx: 0, vy: 0, fixed: false, deg: 0
      };
    });
    var nodeById = new Map(nodes.map(function (n) { return [n.id, n]; }));

    function aggregate(edges) {
      var m = new Map();
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (!keep.has(e.from) || !keep.has(e.to) || e.from === e.to) continue;
        var key = e.from + "|" + e.to;
        var L = m.get(key);
        if (!L) { L = { key: key, a: e.from, b: e.to, weight: 0, kind: e.kind, vias: new Map(), idxs: [] }; m.set(key, L); }
        L.weight += e.weight || 0;
        if (e.via) L.vias.set(e.via, (L.vias.get(e.via) || 0) + 1);
        if (e.sentIdx != null) L.idxs.push(e.sentIdx);
      }
      return m;
    }

    var baseLinks = aggregate(base.edges);
    var links = Array.from(baseLinks.values());
    var baseMax = links.reduce(function (m, l) { return Math.max(m, l.weight); }, 1e-6);
    links.forEach(function (l) { nodeById.get(l.a).deg++; nodeById.get(l.b).deg++; });

    // ---- dom ----
    var wrap = document.createElement("div");
    wrap.className = "graph-wrap";
    wrap.innerHTML =
      (showBar
        ? '<div class="graph-bar">' +
            '<button type="button" class="graph-step" data-d="-1" title="Step back">◀</button>' +
            '<input type="range" class="graph-cursor" min="0" max="' + S + '" value="' + S + '" step="1" title="Reading cursor" />' +
            '<button type="button" class="graph-step" data-d="1" title="Step forward">▶</button>' +
            '<span class="graph-readout">whole document</span>' +
            '<button type="button" class="graph-play" title="Play the reading">▷ Read</button>' +
            '<button type="button" class="graph-whole">Whole doc</button>' +
          "</div>"
        : "") +
      '<svg class="graph-svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet"></svg>' +
      '<div class="graph-tip" hidden></div>';
    root.appendChild(wrap);

    var svg = wrap.querySelector(".graph-svg");
    var slider = wrap.querySelector(".graph-cursor");
    var readout = wrap.querySelector(".graph-readout");
    var tip = wrap.querySelector(".graph-tip");
    var gEdges = document.createElementNS(NS, "g");
    var gNodes = document.createElementNS(NS, "g");
    svg.appendChild(gEdges); svg.appendChild(gNodes);

    links.forEach(function (l) {
      l.el = document.createElementNS(NS, "line");
      l.el.setAttribute("class", "gedge " + (l.kind || "con"));
      gEdges.appendChild(l.el);
    });
    nodes.forEach(function (n) {
      var g = document.createElementNS(NS, "g");
      g.setAttribute("class", "gnode");
      var r = 5 + 3.2 * Math.log(1 + n.sightings);
      n.r = r;
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("r", r);
      var t = document.createElementNS(NS, "text");
      t.setAttribute("class", "glabel");
      t.setAttribute("dy", -r - 3);
      t.textContent = n.label;
      g.appendChild(c); g.appendChild(t);
      gNodes.appendChild(g);
      n.el = g;
      wireNode(n, g);
    });

    // ---- layout simulation ----
    var alpha = 1, raf = 0, ticks = 0, destroyed = false;
    function step() {
      var i, j, n;
      for (i = 0; i < nodes.length; i++) { nodes[i].vx *= 0.85; nodes[i].vy *= 0.85; }
      for (i = 0; i < nodes.length; i++) {
        for (j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var d2 = dx * dx + dy * dy || 0.01;
          var f = (2400 / d2) * alpha;
          var d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f;
        }
      }
      links.forEach(function (l) {
        var a = nodeById.get(l.a), b = nodeById.get(l.b);
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var strength = Math.min(1, l.weight / baseMax);
        var rest = 120 - 55 * strength;
        var f = (d - rest) * (0.012 + 0.03 * strength) * alpha;
        var ux = dx / d, uy = dy / d;
        a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f;
      });
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.fixed) { n.vx = n.vy = 0; continue; }
        n.vx += (CX - n.x) * 0.004 * alpha;
        n.vy += (CY - n.y) * 0.004 * alpha;
        n.x = clamp(n.x + n.vx, 16, W - 16);
        n.y = clamp(n.y + n.vy, 16, H - 16);
      }
      draw();
      alpha *= 0.985;
      if (!destroyed && ++ticks < 600 && alpha > 0.02) raf = requestAnimationFrame(step); else raf = 0;
    }
    function draw() {
      links.forEach(function (l) {
        var a = nodeById.get(l.a), b = nodeById.get(l.b);
        l.el.setAttribute("x1", a.x); l.el.setAttribute("y1", a.y);
        l.el.setAttribute("x2", b.x); l.el.setAttribute("y2", b.y);
      });
      nodes.forEach(function (n) { n.el.setAttribute("transform", "translate(" + n.x + "," + n.y + ")"); });
    }
    function reheat() { alpha = Math.max(alpha, 0.4); if (!raf && !destroyed) raf = requestAnimationFrame(step); }

    // ---- reading cursor (gamma-decay re-projection; no reading panel) ----
    function styleLinks(weightOf) {
      links.forEach(function (l) {
        var w = weightOf ? ((weightOf.get(l.key) || {}).weight || 0) : l.weight;
        var rel = w / baseMax;
        l.el.style.strokeWidth = (0.5 + 2.4 * Math.sqrt(Math.max(rel, 0))).toFixed(2);
        l.el.style.opacity = (w <= 1e-6 ? 0.05 : Math.min(1, 0.18 + rel)).toFixed(3);
      });
    }
    function applyCursor(cur) {
      if (cur >= S) {
        if (readout) readout.textContent = "whole document";
        styleLinks(baseLinks);
        nodes.forEach(function (n) { n.el.style.opacity = "1"; });
        return;
      }
      if (readout) readout.textContent = "reading at s" + cur;
      var g = doc.projectGraph({ cursor: cur });
      styleLinks(aggregate(g.edges));
      nodes.forEach(function (n) {
        var ms = mentions.get(n.id) || [];
        var d = Infinity;
        for (var i = 0; i < ms.length; i++) d = Math.min(d, Math.abs(ms[i] - cur));
        var op = isFinite(d) ? Math.max(0.12, Math.pow(GAMMA, Math.min(d, 12))) : 0.1;
        n.el.style.opacity = op.toFixed(3);
      });
    }
    function setCursor(cur) { if (slider) slider.value = String(cur); applyCursor(cur); }

    // ---- play / step / whole ----
    var playTimer = null;
    function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } var pb = wrap.querySelector(".graph-play"); if (pb) pb.textContent = "▷ Read"; }
    function startPlay() {
      var pb = wrap.querySelector(".graph-play"); if (pb) pb.textContent = "❚❚ Pause";
      var v = parseInt(slider.value, 10); if (v >= S) { v = 0; setCursor(0); }
      playTimer = setInterval(function () {
        var cur = parseInt(slider.value, 10);
        if (cur >= S - 1) { stopPlay(); return; }
        setCursor(clamp(cur + 1, 0, S - 1));
      }, 1100);
    }
    if (showBar) {
      slider.addEventListener("input", function () { applyCursor(parseInt(slider.value, 10)); });
      wrap.querySelectorAll(".graph-step").forEach(function (b) {
        b.addEventListener("click", function () {
          var v = parseInt(slider.value, 10); if (v >= S) v = S;
          setCursor(clamp(v + parseInt(b.dataset.d, 10), 0, S));
        });
      });
      wrap.querySelector(".graph-play").addEventListener("click", function () { playTimer ? stopPlay() : startPlay(); });
      wrap.querySelector(".graph-whole").addEventListener("click", function () { stopPlay(); setCursor(S); });
    }

    // ---- hover / select / drag ----
    var dragging = null;
    function neighbours(n) { var s = new Set([n.id]); links.forEach(function (l) { if (l.a === n.id) s.add(l.b); if (l.b === n.id) s.add(l.a); }); return s; }
    function highlight(n, on) {
      svg.classList.toggle("focusing", on);
      if (!on) { nodes.forEach(function (m) { m.el.classList.remove("hl", "dim"); }); links.forEach(function (l) { l.el.classList.remove("hl", "dim"); }); return; }
      var near = neighbours(n);
      nodes.forEach(function (m) { m.el.classList.toggle("dim", !near.has(m.id)); m.el.classList.toggle("hl", near.has(m.id)); });
      links.forEach(function (l) { var inc = l.a === n.id || l.b === n.id; l.el.classList.toggle("hl", inc); l.el.classList.toggle("dim", !inc); });
    }
    function flashSelect(n) { nodes.forEach(function (m) { m.el.classList.remove("sel"); }); n.el.classList.add("sel"); }
    function showTip(n, e) {
      var rels = links.filter(function (l) { return l.a === n.id || l.b === n.id; })
        .sort(function (x, y) { return y.weight - x.weight; }).slice(0, 4)
        .map(function (l) {
          var other = l.a === n.id ? l.b : l.a;
          var via = Array.from(l.vias.keys())[0] || "related to";
          var dir = l.a === n.id ? (via + " →") : ("← " + via);
          return dir + " " + ((nodeById.get(other) || {}).label || other);
        });
      tip.innerHTML = "<strong>" + esc(n.label) + "</strong> · " + n.sightings + " mention" + (n.sightings === 1 ? "" : "s") +
        (rels.length ? "<br>" + rels.map(esc).join("<br>") : "");
      tip.hidden = false;
      var box = root.getBoundingClientRect();
      tip.style.left = (e.clientX - box.left + 12) + "px";
      tip.style.top = (e.clientY - box.top + 12) + "px";
    }
    function hideTip() { tip.hidden = true; }
    function toSvg(e) {
      var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      var m = svg.getScreenCTM();
      return m ? p.matrixTransform(m.inverse()) : { x: e.offsetX, y: e.offsetY };
    }
    function startDrag(n, e) {
      e.preventDefault(); dragging = n; n.fixed = true;
      function move(ev) { var pt = toSvg(ev); n.x = clamp(pt.x, 16, W - 16); n.y = clamp(pt.y, 16, H - 16); draw(); }
      function up() { dragging = null; n.fixed = false; reheat(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      reheat();
    }
    function wireNode(n, g) {
      g.addEventListener("mouseenter", function () { highlight(n, true); });
      g.addEventListener("mouseleave", function () { if (!dragging) highlight(n, false); hideTip(); });
      g.addEventListener("mousemove", function (e) { showTip(n, e); });
      g.addEventListener("pointerdown", function (e) { startDrag(n, e); });
      g.addEventListener("click", function () {
        if (n.first != null && onSelectSentence) {
          var st = ""; try { st = (window.NpjPropGraph && window.NpjPropGraph.sentenceText(doc, n.first)) || ""; } catch (e) {}
          onSelectSentence({ idx: n.first, label: n.label, text: st });
        }
        flashSelect(n);
      });
    }

    styleLinks(baseLinks);
    reheat();

    return {
      reheat: reheat,
      setCursor: setCursor,
      destroy: function () { destroyed = true; if (raf) cancelAnimationFrame(raf); stopPlay(); try { root.removeChild(wrap); } catch (e) {} }
    };
  }

  window.NpjGraphRender = { renderPropGraph: renderPropGraph };
})();
