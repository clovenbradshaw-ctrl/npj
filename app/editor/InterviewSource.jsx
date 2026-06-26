/* ============================================================
   InterviewSource.jsx — attribute a claim to a CONVERSATION. NO MODEL.

   Not every source is a document or a web page. A lot of reporting stands on
   what a person TOLD the reporter — an interview, a phone call, a tip on
   background. This makes that a first-class source kind alongside web links and
   uploaded files, so a claim can cite "what they said" and the cited words pin
   the same way a quote from a PDF does.

   Two shapes, the way newsrooms actually attribute:
     • CITED   — a named person, optionally with a role ("Jane Doe, city
                 council member"). Published as the name.
     • ANONYMOUS — published only as a DESCRIPTOR ("a person familiar with the
                 negotiations"), on whatever terms were agreed (on background /
                 not for attribution), optionally with the reason anonymity was
                 granted — the context good outlets print.

   SOURCE PROTECTION is structural here, not a promise:
     • We never capture or store an anonymous source's real identity. There is no
       field for it — so it cannot be in the draft, cannot sync, cannot leak.
     • The reporter's private notes (rec.text) make the conversation CITABLE in
       the editor, but they are stripped from the PUBLISHED record (see
       NpjArticles.publishableSource): only the exact words you pinned go public,
       never the full transcript.

   Publishes window.NpjInterview (pure helpers + record builder) and
   window.InterviewComposer (the capture modal). Plain best-effort throughout.
   ============================================================ */
(function (root) {
  "use strict";

  var MEDIA = [
    ["in-person", "In person"],
    ["phone", "Phone"],
    ["video", "Video call"],
    ["email", "Email"],
    ["message", "Messaging / Signal"],
    ["other", "Other"]
  ];
  var ATTRIB = [
    ["on-record", "On the record"],
    ["background", "On background"],
    ["not-for-attribution", "Not for attribution"],
    ["off-record", "Off the record"]
  ];

  function today() { return new Date().toISOString().slice(0, 10); }
  function pick(list, key, dflt) { for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return dflt || ""; }
  function mediumLabel(k) { return pick(MEDIA, k, ""); }
  function attributionLabel(k) { return pick(ATTRIB, k, "On the record"); }

  function isInterview(rec) { return !!(rec && rec.type === "interview"); }

  // The published name/label for the source. Named → "Name, role"; anonymous →
  // the agreed descriptor (never a real identity, which we don't hold).
  function displayTitle(t) {
    t = t || {};
    if (t.anonymous) return String(t.descriptor || "").trim() || "An anonymous source";
    var name = String(t.sourceName || "").trim();
    var role = String(t.sourceRole || "").trim();
    return [name, role].filter(Boolean).join(", ") || "Interview source";
  }

  // The small meta line ("outlet" slot): how the conversation happened + the
  // terms, when they're anything other than plain on-the-record.
  function outletLine(t) {
    t = t || {};
    var med = mediumLabel(t.medium);
    var base = med ? med + " interview" : "Interview";
    if (t.attribution && t.attribution !== "on-record") base += " · " + attributionLabel(t.attribution).toLowerCase();
    return base;
  }
  // A fuller line for cards: adds the date and (internal) reporter credit.
  function metaLine(rec) {
    var t = (rec && rec.talk) || {};
    var bits = [outletLine(t)];
    var d = t.date || (rec && rec.retrieved);
    if (d) bits.push(humanDate(d));
    return bits.join(" · ");
  }
  function humanDate(d) {
    try { var dt = new Date(d); if (!isNaN(dt)) return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) {}
    return String(d || "");
  }

  function newKey() { return "talk-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36); }

  // Build the citable source record from the composer's form. ONLY
  // publication-safe fields are stored — there is deliberately no slot for an
  // anonymous source's identity.
  function buildRecord(form) {
    form = form || {};
    var anon = !!form.anonymous;
    var talk = {
      anonymous: anon,
      sourceName: anon ? "" : String(form.sourceName || "").trim(),
      sourceRole: anon ? "" : String(form.sourceRole || "").trim(),
      descriptor: anon ? String(form.descriptor || "").trim() : "",
      reason: anon ? String(form.reason || "").trim() : "",
      reporter: String(form.reporter || "").trim(),
      medium: form.medium || "",
      date: form.date || today(),
      attribution: form.attribution || (anon ? "background" : "on-record")
    };
    return {
      id: newKey(),
      type: "interview",
      outlet: outletLine(talk),
      title: displayTitle(talk),
      text: String(form.notes || "").trim(),   // private notes — citable here, stripped at publish
      retrieved: talk.date,
      talk: talk
    };
  }

  // The publication-safe projection of an interview record: drop the raw notes
  // (only the pinned quotes belong in the public log) and any stray private
  // field. NpjArticles.publishableSource calls this on the publish path.
  function redactForPublish(rec) {
    if (!isInterview(rec)) return rec;
    var out = {};
    for (var k in rec) if (Object.prototype.hasOwnProperty.call(rec, k) && k !== "text") out[k] = rec[k];
    out.text = "";   // explicit: no transcript in the public record
    return out;
  }

  root.NpjInterview = {
    MEDIA: MEDIA, ATTRIB: ATTRIB, today: today,
    isInterview: isInterview, displayTitle: displayTitle, outletLine: outletLine,
    metaLine: metaLine, humanDate: humanDate, mediumLabel: mediumLabel, attributionLabel: attributionLabel,
    buildRecord: buildRecord, redactForPublish: redactForPublish
  };

  /* ---------------- the capture modal ----------------
     Mounts inside the (dark) newsroom, so colors are pinned to the light card
     the same way CiteyRedact / Archive modals are. */
  function InterviewComposer(props) {
    var onSave = props.onSave, onClose = props.onClose;
    var I = root.I || {};
    var x = useState(false), anonymous = x[0], setAnon = x[1];
    var a = useState(""), sourceName = a[0], setName = a[1];
    var b = useState(""), sourceRole = b[0], setRole = b[1];
    var c = useState(""), descriptor = c[0], setDescriptor = c[1];
    var d = useState(""), reason = d[0], setReason = d[1];
    var e = useState(props.reporter || ""), reporter = e[0], setReporter = e[1];
    var f = useState("phone"), medium = f[0], setMedium = f[1];
    var g = useState(today()), date = g[0], setDate = g[1];
    var h = useState(anonymous ? "background" : "on-record"), attribution = h[0], setAttribution = h[1];
    var n = useState(""), notes = n[0], setNotes = n[1];

    // when the source flips named↔anonymous, move the attribution default with it
    var setMode = function (toAnon) {
      setAnon(toAnon);
      setAttribution(toAnon ? "background" : "on-record");
    };

    var nameOk = anonymous ? !!descriptor.trim() : !!sourceName.trim();
    var ready = nameOk;

    var save = function () {
      if (!ready) return;
      var rec = buildRecord({ anonymous: anonymous, sourceName: sourceName, sourceRole: sourceRole, descriptor: descriptor, reason: reason, reporter: reporter, medium: medium, date: date, attribution: attribution, notes: notes });
      onSave && onSave(rec);
    };

    var lbl = { display: "block", marginBottom: 5 };
    var field = { width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 13.5, padding: "8px 9px", outline: "none", boxSizing: "border-box" };
    var seg = function (on) { return { flex: 1, padding: "9px 8px", border: "1.5px solid var(--ink)", background: on ? "var(--ink)" : "transparent", color: on ? "var(--paper)" : "var(--ink)", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }; };

    return (
      <div onClick={onClose} className="fade-in" style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.74)", zIndex: 5200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={function (ev) { ev.stopPropagation(); }} className="np-scroll" style={{ width: "min(620px,96vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--card)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 18px", borderBottom: "2px solid var(--ink)", background: "var(--yellow)", position: "sticky", top: 0, zIndex: 1 }}>
            {I.chat ? <I.chat style={{ fontSize: 22 }} /> : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 20, lineHeight: 1 }}>Cite a conversation</div>
              <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 2 }}>Attribute a claim to what a source told you — named, or anonymous.</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>{I.x ? <I.x /> : "×"}</button>
          </div>

          <div style={{ padding: "14px 18px 4px" }}>
            {/* named ↔ anonymous */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", ...lbl }}>The source</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={function () { setMode(false); }} style={seg(!anonymous)}>Named (cited)</button>
              <button onClick={function () { setMode(true); }} style={seg(anonymous)}>Anonymous</button>
            </div>

            {anonymous ? (
              <div style={{ marginBottom: 12 }}>
                <label className="np-eyebrow" htmlFor="iv-desc" style={{ color: "var(--ink-soft)", ...lbl }}>How we'll refer to them <span style={{ color: "var(--reject)" }}>*</span></label>
                <input id="iv-desc" autoFocus value={descriptor} onChange={function (ev) { setDescriptor(ev.target.value); }} placeholder="a person familiar with the negotiations" style={field} />
                <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 5, lineHeight: 1.5 }}>This is what readers see. People's Journalism never stores an anonymous source's real identity — there's no field for it, so it can't sync or leak. Keep their identity in your own secure records.</div>
                <label className="np-eyebrow" htmlFor="iv-reason" style={{ color: "var(--ink-soft)", ...lbl, marginTop: 11 }}>Why anonymity was granted <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional — printed as context)</span></label>
                <input id="iv-reason" value={reason} onChange={function (ev) { setReason(ev.target.value); }} placeholder="they were not authorized to discuss the matter" style={field} />
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <label className="np-eyebrow" htmlFor="iv-name" style={{ color: "var(--ink-soft)", ...lbl }}>Name <span style={{ color: "var(--reject)" }}>*</span></label>
                  <input id="iv-name" autoFocus value={sourceName} onChange={function (ev) { setName(ev.target.value); }} placeholder="Jane Doe" style={field} />
                </div>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <label className="np-eyebrow" htmlFor="iv-role" style={{ color: "var(--ink-soft)", ...lbl }}>Role / affiliation <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
                  <input id="iv-role" value={sourceRole} onChange={function (ev) { setRole(ev.target.value); }} placeholder="city council member" style={field} />
                </div>
              </div>
            )}

            {/* terms + how + when */}
            <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <label className="np-eyebrow" htmlFor="iv-attr" style={{ color: "var(--ink-soft)", ...lbl }}>Attribution</label>
                <select id="iv-attr" value={attribution} onChange={function (ev) { setAttribution(ev.target.value); }} style={{ ...field, cursor: "pointer" }}>
                  {ATTRIB.map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option>; })}
                </select>
              </div>
              <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                <label className="np-eyebrow" htmlFor="iv-med" style={{ color: "var(--ink-soft)", ...lbl }}>How</label>
                <select id="iv-med" value={medium} onChange={function (ev) { setMedium(ev.target.value); }} style={{ ...field, cursor: "pointer" }}>
                  {MEDIA.map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option>; })}
                </select>
              </div>
              <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                <label className="np-eyebrow" htmlFor="iv-date" style={{ color: "var(--ink-soft)", ...lbl }}>When</label>
                <input id="iv-date" type="date" value={date} onChange={function (ev) { setDate(ev.target.value); }} style={{ ...field, cursor: "pointer" }} />
              </div>
            </div>

            {attribution === "off-record" && (
              <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", lineHeight: 1.5, border: "1px solid var(--reject)", padding: "7px 9px", marginBottom: 12 }}>
                Off-the-record material is not for publication. Cite it only if the terms change — otherwise it should inform your reporting, not be quoted.
              </div>
            )}

            <label className="np-eyebrow" htmlFor="iv-rep" style={{ color: "var(--ink-soft)", ...lbl }}>Reporter <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(who had the conversation)</span></label>
            <input id="iv-rep" value={reporter} onChange={function (ev) { setReporter(ev.target.value); }} placeholder="@you:server" className="np-mono" style={{ ...field, marginBottom: 12, fontFamily: "var(--mono)", fontSize: 12.5 }} />

            <label className="np-eyebrow" htmlFor="iv-notes" style={{ color: "var(--ink-soft)", ...lbl }}>What was said <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(notes or transcript)</span></label>
            <textarea id="iv-notes" value={notes} onChange={function (ev) { setNotes(ev.target.value); }} rows={6} placeholder="Type or paste your notes. Later you'll highlight the exact words that back each claim — only those pinned words are published, never these full notes."
              style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
            <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.5 }}>
              Your notes stay in the draft so the conversation is citable. When you publish, only the exact words you pin are committed to the public record — the transcript is stripped.
            </div>
          </div>

          {/* footer */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderTop: "1.5px solid var(--rule)", position: "sticky", bottom: 0, background: "var(--card)" }}>
            <span className="np-mono" style={{ flex: 1, fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.4 }}>
              {anonymous ? "Published as “" + (descriptor.trim() || "an anonymous source") + "”" : (sourceName.trim() ? "Published as “" + displayTitle({ anonymous: false, sourceName: sourceName, sourceRole: sourceRole }) + "”" : "Add a name to continue")}
            </span>
            <button onClick={onClose} className="np-cond" style={{ background: "transparent", border: "1.5px solid var(--ink)", color: "var(--ink)", padding: "8px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={!ready} className="np-cond" style={{ background: ready ? "var(--yellow)" : "var(--rule)", border: "1.5px solid var(--ink)", color: "var(--ink)", padding: "8px 15px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : .6, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {I.source ? <I.source style={{ fontSize: 13 }} /> : null} Add conversation
            </button>
          </div>
        </div>
      </div>
    );
  }

  root.InterviewComposer = InterviewComposer;
})(typeof window !== "undefined" ? window : this);
