/* NPJ shared UI — icons, badges, source card. Exports to window.
   Hooks (useState/useRef/useCallback/useMemo/useEffect) are exposed as globals
   in the host HTML so every babel file can use them bare. */

/* ---------- minimal stroke icons ---------- */
const I = {
  archive: (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M9 12h6"/></svg>),
  lock:    (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>),
  check:   (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M5 12l4 4 10-10"/></svg>),
  x:       (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>),
  ext:     (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M14 5h5v5M19 5l-9 9M12 5H5v14h14v-7"/></svg>),
  up:      (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 19V6M6 11l6-6 6 6"/></svg>),
  chat:    (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M4 5h16v11H9l-5 4z"/></svg>),
  eye:     (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>),
  eyeoff:  (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M4 4l16 16M9.5 5.4A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6 7.5C3.5 9.2 2 12 2 12s4 7 10 7c1 0 2-.2 2.9-.5"/></svg>),
  filter:  (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>),
  doc:     (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>),
  data:    (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/></svg>),
  mic:     (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>),
  search:  (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/></svg>),
  plus:    (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 5v14M5 12h14"/></svg>),
  arrow:   (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>),
  shield:  (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/></svg>),
  clock:   (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>),
  /* the "bottom" / ground glyph (⊥): a claim standing on its source */
  source:  (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M12 4v15M4 19h16"/></svg>),
  folder:  (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M3 6h6l2 3h10v11H3z"/></svg>),
  sun:     (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"/></svg>),
  moon:    (p) => (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M20.4 13.2A8.5 8.5 0 1 1 10.8 3.6a7 7 0 0 0 9.6 9.6z"/></svg>)
};

const SRC_TYPE = {
  primary:   { label: "Primary",   icon: I.doc,  color: "var(--ink)" },
  data:      { label: "Data",      icon: I.data, color: "var(--data)" },
  reporting: { label: "Reporting", icon: I.mic,  color: "var(--review)" }
};

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- MXID handle ---------- */
function Handle({ mxid, showName = false, size = 18 }) {
  const p = (window.NPJ.PEOPLE[mxid]) || { name: mxid, trust: "open", color: "#6b6b6b" };
  const initial = (p.name || mxid).replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ width: size, height: size, borderRadius: "50%", background: p.color, color: "#fff",
        fontFamily: "var(--cond)", fontWeight: 700, fontSize: size * 0.56, display: "inline-flex",
        alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{initial}</span>
      <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
        {showName ? p.name : mxid}
      </span>
    </span>
  );
}

/* ---------- source type badge ---------- */
function SourceTag({ type }) {
  const t = SRC_TYPE[type] || SRC_TYPE.primary;
  const Icon = t.icon;
  return (
    <span className="np-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: t.color }}>
      <Icon style={{ fontSize: 13 }} /> {t.label}
    </span>
  );
}

/* ---------- the source hover/click card ---------- */
function SourceCard({ srcKey, onClose, pinned }) {
  const s = window.NPJ.SOURCES[srcKey];
  if (!s) return null;
  return (
    <div style={{ fontFamily: "var(--serif)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 12px", borderBottom: "1.5px solid var(--ink)", background: "var(--paper-2)" }}>
        <SourceTag type={s.type} />
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--verified)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I.archive style={{ fontSize: 13 }} /> ARCHIVED
        </span>
        {pinned && onClose && (
          <button onClick={onClose} className="np-mono" style={{ border: 0, background: "none", fontSize: 14, lineHeight: 1, color: "var(--ink-soft)" }}><I.x /></button>
        )}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginBottom: 4 }}>{s.id}</div>
        <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 16, lineHeight: 1.12, marginBottom: 3 }}>{s.title}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 9 }}>{s.outlet}</div>
        {s.pull_quote && (
          <div style={{ borderLeft: "3px solid var(--yellow-deep)", paddingLeft: 9, fontStyle: "italic",
            fontSize: 13.5, lineHeight: 1.34, marginBottom: 10, color: "var(--ink)" }}>{s.pull_quote}</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11,
          fontFamily: "var(--mono)", color: "var(--ink-soft)", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><I.clock style={{ fontSize: 12 }} /> retrieved {s.retrieved}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          <a href={s.archive_url} target="_blank" rel="noopener" className="btn btn-primary btn-sm" style={{ flex: 1, textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <I.archive style={{ fontSize: 13 }} /> Snapshot
          </a>
          <a href={s.original_url} target="_blank" rel="noopener" className="btn btn-ghost btn-sm" style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <I.ext style={{ fontSize: 13 }} /> Live
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------- share bar: archive.org permalink + basic socials ---------- */
function ShareBar({ url, title, archiveUrl, dark = false }) {
  const [copied, setCopied] = useState(null);
  const u = encodeURIComponent(url || "");
  const au = encodeURIComponent(archiveUrl || url || "");
  const t = encodeURIComponent(title || "");
  const links = [
    ["X", `https://twitter.com/intent/tweet?url=${u}&text=${t}`],
    ["Bluesky", `https://bsky.app/intent/compose?text=${t}%20${u}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["Reddit", `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ["Email", `mailto:?subject=${t}&body=${au}`]
  ];
  const fg = dark ? "#d8d3c4" : "var(--ink)";
  const line = dark ? "rgba(255,255,255,.18)" : "var(--ink)";
  const copy = (text, key) => { navigator.clipboard && navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1400); };
  const pill = { fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em",
    border: "1.5px solid " + line, color: fg, background: "transparent", padding: "5px 11px", textDecoration: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: dark ? "rgba(216,211,196,.7)" : "var(--ink-soft)" }}>Permanent link</span>
        <button onClick={() => copy(archiveUrl, "arc")} title="Copy archive.org permalink" style={{ ...pill, background: dark ? "rgba(255,236,1,.12)" : "var(--yellow)", borderColor: dark ? "var(--yellow)" : "var(--ink)", color: dark ? "var(--yellow)" : "var(--ink)" }}>
          <I.archive style={{ fontSize: 14 }} /> {copied === "arc" ? "Copied!" : "archive.org snapshot"}
        </button>
        <button onClick={() => copy(url, "url")} style={pill}>{copied === "url" ? "Copied!" : <React.Fragment><I.ext style={{ fontSize: 13 }} /> Copy link</React.Fragment>}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: dark ? "rgba(216,211,196,.7)" : "var(--ink-soft)" }}>Share</span>
        {links.map(([label, href]) => (
          <a key={label} href={href} target="_blank" rel="noopener" style={pill}
            onMouseEnter={(e) => { e.currentTarget.style.background = dark ? "rgba(255,255,255,.1)" : "var(--ink)"; e.currentTarget.style.color = dark ? "#fff" : "var(--yellow)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = fg; }}>{label}</a>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { I, SRC_TYPE, fmtDate, shortDate, Handle, SourceTag, SourceCard, ShareBar });
