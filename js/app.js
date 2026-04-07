/* ═══════════════════════════════════════════════
   NETC Transport Planner — React Components & App

   This file is loaded as type="text/babel" so JSX
   syntax is supported. It depends on globals defined
   in config.js, geo.js, utils.js, supabase.js, db.js.

   Component hierarchy:
     Root  ← checks auth; shows LoginScreen or App
     ├── LoginScreen
     └── App
         ├── (calendar strip, filter bar, tabs)
         ├── Schedule tab
         │   └── JobCard (one per job)
         ├── DriversTab
         ├── MetricsTab
         └── SettingsTab
   ═══════════════════════════════════════════════ */

const { useState, useMemo, useEffect, useCallback } = React;

// ── LoginScreen ─────────────────────────────────
// Shown when there is no active Supabase session.
// Bot protection is layered: Supabase Auth rate-limits
// server-side, and this component enforces a client-side
// progressive lockout tracked in localStorage.
function LoginScreen() {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [, setTick] = useState(0); // drives lockout countdown display

  // Refresh once per second so the countdown updates
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { attempts, lockUntil } = getAuthState();
  const now      = Date.now();
  const locked   = lockUntil > now;
  const secsLeft = locked ? Math.ceil((lockUntil - now) / 1000) : 0;
  const attemptsUntilNextLock = attempts < 3 ? 3 - attempts :
                                attempts < 6 ? 6 - attempts : 9 - attempts;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (locked || loading || !password) return;
    setLoading(true);
    setError('');
    try {
      await signIn(password);
      // Success — Root's onAuthStateChange listener will pick up the new session
    } catch (err) {
      const state = getAuthState();
      if (state.lockUntil > Date.now()) {
        const mins = Math.ceil((state.lockUntil - Date.now()) / 60000);
        setError(`Too many attempts. Locked for ${mins} minute${mins > 1 ? 's' : ''}.`);
      } else {
        setError(`Incorrect password. ${attemptsUntilNextLock} attempt${attemptsUntilNextLock > 1 ? 's' : ''} before temporary lockout.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 320, padding: '0 16px' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: C.dm }}>NETC Transport</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.tx }}>Capacity Planner</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.dm, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Site Password</div>
            <input
              type="password"
              style={{ ...iS, fontSize: 14, padding: '10px 12px' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={locked || loading}
              autoFocus
              placeholder="Enter password"
            />
          </div>

          {error && !locked && (
            <div style={{ fontSize: 11, color: C.rd, marginBottom: 10, padding: '6px 8px', background: '#1a0808', borderRadius: 5, border: '1px solid #3b1111' }}>
              {error}
            </div>
          )}

          {locked && (
            <div style={{ fontSize: 11, color: C.am, marginBottom: 10, padding: '6px 8px', background: C.ab, borderRadius: 5, border: '1px solid ' + C.am }}>
              Too many attempts — try again in {secsLeft >= 60 ? Math.ceil(secsLeft / 60) + ' min' : secsLeft + 's'}
            </div>
          )}

          <button
            type="submit"
            style={{ ...bP, width: '100%', padding: '10px', fontSize: 13, opacity: (locked || loading || !password) ? 0.4 : 1 }}
            disabled={locked || loading || !password}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── JobCard ─────────────────────────────────────
// Displays a single job: route legs, time/distance, driver assignment,
// priority, status controls, notes, and extra stop management.
function JobCard({ job, drivers, onUpdate, onRemove }) {
  const yard  = YARDS.find(y => y.id === job.yardId) || YARDS[0];
  const stops = job.stops || [];

  // Build full point list: Yard → Pickup → Stops → Drop → Yard
  const allPts = [];
  allPts.push({ label: yard.short + " (yard)",   addr: yard.addr, zip: yard.zip, color: C.dm });
  allPts.push({ label: "Pickup",                  addr: job.pickupAddr, zip: job.pickupZip, color: C.ac });
  stops.forEach((s, i) => allPts.push({ label: s.name || ("Stop " + (i + 1)), addr: s.addr || "", zip: s.zip || "", color: C.am }));
  allPts.push({ label: "Drop",                    addr: job.dropAddr, zip: job.dropZip, color: C.gn });
  allPts.push({ label: yard.short + " (return)",  addr: yard.addr, zip: yard.zip, color: C.dm });

  // Calculate each leg
  const legs = []; let totalMi = 0;
  for (let i = 0; i < allPts.length - 1; i++) {
    const c1 = crd(allPts[i].addr, allPts[i].zip);
    const c2 = crd(allPts[i + 1].addr, allPts[i + 1].zip);
    const mi = dMi(c1, c2);
    legs.push({ mi, hr: mi / 45 });
    totalMi += mi;
  }
  const luH    = Math.max(1, 0.5 * stops.length + 1);
  const totalH = totalMi / 45 + luH;

  const puN  = job.pickupAddr ? (geoCache[job.pickupAddr]?.name || cityFrom(job.pickupAddr)) : (lz(job.pickupZip)?.label || job.pickupZip || "?");
  const drN  = job.dropAddr   ? (geoCache[job.dropAddr]?.name   || cityFrom(job.dropAddr))   : (lz(job.dropZip)?.label   || job.dropZip   || "?");
  const bc   = job.status === "cancelled" ? C.dm : job.status === "complete" ? C.gn : job.status === "active" ? C.am : job.driverId ? C.ac : C.pu;
  const dim  = job.status === "complete" || job.status === "cancelled";
  const pri  = job.priority || "normal";

  const [showNotes, setShowNotes] = useState(false);
  const [showStops, setShowStops] = useState(false);
  const [newAddr,   setNewAddr]   = useState("");
  const [newZip,    setNewZip]    = useState("");
  const [newName,   setNewName]   = useState("");

  const ptNames = [yard.short, puN, ...stops.map((s, i) => s.name || cityFrom(s.addr) || (lz(s.zip)?.label) || ("Stop " + (i + 1))), drN, yard.short];

  const addStop = () => {
    if (!newZip.trim() && !newAddr.trim()) return;
    onUpdate({ stops: [...stops, { addr: newAddr.trim(), zip: newZip.trim(), name: newName.trim() }] });
    setNewAddr(""); setNewZip(""); setNewName("");
  };
  const rmStop   = (i) => { const s = [...stops]; s.splice(i, 1); onUpdate({ stops: s }); };
  const moveStop = (i, dir) => {
    if (i + dir < 0 || i + dir >= stops.length) return;
    const s = [...stops], tmp = s[i]; s[i] = s[i + dir]; s[i + dir] = tmp; onUpdate({ stops: s });
  };

  return <div style={{ ...cB, borderLeft: "3px solid " + bc, opacity: dim ? .4 : 1, padding: 10 }}>
    {/* Header row: call number, reason, status badges, time/miles, remove */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div className="pri" style={{ background: PRI_COLORS[pri] }} title={pri} />
        {job.tbCallNum && <span style={{ fontSize: 15, fontWeight: 800, color: C.pu }}>{job.tbCallNum}</span>}
        {job.tbReason  && <span style={{ fontSize: 9, color: C.dm, background: C.sf, padding: "1px 6px", borderRadius: 10 }}>{job.tbReason}</span>}
        {stops.length > 0 && <span style={{ fontSize: 8, color: C.am, background: C.ab, padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>{stops.length + 2} STOPS</span>}
        {job.status === "active"    && <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: C.ab, color: C.am, animation: "pulse 2s infinite" }}>ACTIVE</span>}
        {job.status === "complete"  && <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: C.gb, color: C.gn }}>DONE</span>}
        {job.status === "cancelled" && <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: "#3b1111", color: C.rd }}>CANCELLED</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: dim ? C.dm : C.ac }}>{fH(totalH)}</div>
          <div style={{ fontSize: 8, color: C.dm }}>{fMi(totalMi)}</div>
        </div>
        {!dim && <button style={bSt} onClick={onRemove}>✕</button>}
      </div>
    </div>

    {job.tbScheduled && <div style={{ fontSize: 12, fontWeight: 600, color: C.tx, marginBottom: 4 }}>{job.tbScheduled}</div>}

    {/* Yard / Driver / Priority selects */}
    <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
      <div style={{ flex: 1 }}><div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>YARD</div>
        <select style={{ ...sS, fontSize: 10, padding: "3px 5px" }} value={job.yardId} onChange={e => onUpdate({ yardId: e.target.value })}>
          {YARDS.map(y => <option key={y.id} value={y.id}>{y.short}</option>)}
        </select>
      </div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>DRIVER</div>
        <select style={{ ...sS, fontSize: 10, padding: "3px 5px" }} value={job.driverId || ""} onChange={e => onUpdate({ driverId: e.target.value ? parseInt(e.target.value) : 0 })}>
          <option value="">Unassigned</option>
          {drivers.map(d => <option key={d.id} value={d.id}>{dLb(d)}</option>)}
        </select>
      </div>
      <div style={{ width: 70 }}><div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>PRIORITY</div>
        <select style={{ ...sS, fontSize: 10, padding: "3px 5px" }} value={pri} onChange={e => onUpdate({ priority: e.target.value })}>
          <option value="urgent">Urgent</option>
          <option value="normal">Normal</option>
          <option value="flexible">Flex</option>
        </select>
      </div>
    </div>

    {job.tbDriver && <div style={{ fontSize: 10, color: C.dm, marginBottom: 4 }}>TB Driver: <strong style={{ color: C.am }}>{job.tbDriver}</strong></div>}

    {/* Route legs with per-leg time and distance */}
    <div style={{ padding: "0 0 0 2px" }}>
      {allPts.map((pt, i) => {
        const isLast = i === allPts.length - 1;
        const leg    = i < legs.length ? legs[i] : null;
        const name   = ptNames[i];
        const dot    = isLast ? "A" : String.fromCharCode(65 + (i > allPts.length - 2 ? 0 : i));
        return <React.Fragment key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid " + pt.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: pt.color, flexShrink: 0 }}>{dot}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.tx, flex: 1 }}>{name}</div>
            {!isLast && i > 0 && i < allPts.length - 2 && <div style={{ fontSize: 8, color: C.am }}>+30m</div>}
            {i === 1 && stops.length === 0 && <div style={{ fontSize: 8, color: C.am }}>+1h load</div>}
          </div>
          {!isLast && leg && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 14, display: "flex", justifyContent: "center" }}><div style={{ width: 2, height: 16, background: C.bd }} /></div>
            <span style={{ fontSize: 10, color: leg.hr > 0 ? C.ac : C.rd, fontWeight: 700 }}>{leg.hr > 0 ? fH(leg.hr) : "? no zip"}</span>
            {leg.mi > 0 && <span style={{ fontSize: 9, color: C.dm }}>{fMi(leg.mi)}</span>}
          </div>}
        </React.Fragment>;
      })}
      <div style={{ fontSize: 9, color: C.am, marginTop: 2 }}>Load/unload: {fH(luH)}</div>
    </div>

    {/* Extra stops editor */}
    <div style={{ marginTop: 5 }}>
      <button style={{ ...bSt, fontSize: 9, color: C.am, borderColor: C.am }} onClick={() => setShowStops(!showStops)}>
        {showStops ? "Hide stops" : "+ Add/Edit Stops"}{stops.length > 0 && " (" + stops.length + ")"}
      </button>
      {showStops && <div style={{ marginTop: 4, padding: 8, background: C.sf, borderRadius: 6, border: "1px solid " + C.bd }}>
        <div style={{ fontSize: 9, color: C.dm, marginBottom: 5 }}>Stops are inserted between Pickup and Drop. Add zip code for time calculation.</div>
        {stops.map((s, i) => <div key={i} style={{ display: "flex", gap: 3, alignItems: "center", marginBottom: 4, padding: 4, background: C.cd, borderRadius: 4 }}>
          <span style={{ fontSize: 11, color: C.am, fontWeight: 800, minWidth: 20 }}>S{i + 1}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.tx, fontWeight: 600 }}>{s.name || s.addr || "Stop " + (i + 1)}</div>
            <div style={{ fontSize: 9, color: C.dm }}>{s.addr} {s.zip && <span style={{ color: C.ac }}>({s.zip})</span>}</div>
          </div>
          <button style={{ ...bSt, padding: "1px 4px", fontSize: 8 }} onClick={() => moveStop(i, -1)} title="Move up">↑</button>
          <button style={{ ...bSt, padding: "1px 4px", fontSize: 8 }} onClick={() => moveStop(i,  1)} title="Move down">↓</button>
          <button style={{ ...bSt, padding: "1px 4px", color: C.rd, fontSize: 8 }} onClick={() => rmStop(i)}>✕</button>
        </div>)}
        <div style={{ display: "flex", gap: 3, marginTop: stops.length ? 5 : 0 }}>
          <input style={{ ...iS, flex: 2, fontSize: 10, padding: "4px 6px" }} placeholder="Address (for display)" value={newAddr} onChange={e => setNewAddr(e.target.value)} />
          <input style={{ ...iS, width: 60, fontSize: 10, padding: "4px 6px", borderColor: C.am }} placeholder="ZIP *" maxLength={5} value={newZip} onChange={e => setNewZip(e.target.value.replace(/\D/g, ""))} />
          <input style={{ ...iS, width: 70, fontSize: 10, padding: "4px 6px" }} placeholder="Label" value={newName} onChange={e => setNewName(e.target.value)} />
          <button style={{ ...bP, fontSize: 9, padding: "3px 8px" }} onClick={addStop}>Add</button>
        </div>
      </div>}
    </div>

    {/* Status controls */}
    {job.status !== "cancelled" && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5, paddingTop: 5, borderTop: "1px solid " + C.bd }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={{ ...bSt, fontSize: 9 }} onClick={() => setShowNotes(!showNotes)}>📝{job.notes ? " *" : ""}</button>
        {job.status === "scheduled" && job.driverId > 0 && <button style={{ ...bSt, color: C.am, borderColor: C.am }} onClick={() => onUpdate({ status: "active",   startedAt:   new Date().toISOString() })}>▶ Start</button>}
        {job.status === "active"    && <button style={{ ...bSt, color: C.gn, borderColor: C.gn }} onClick={() => onUpdate({ status: "complete", completedAt: new Date().toISOString() })}>✓ Done</button>}
        {job.status === "complete"  && <button style={{ ...bSt, color: C.am, borderColor: C.am }} onClick={() => onUpdate({ status: "scheduled", startedAt: null, completedAt: null })}>↩ Undo</button>}
      </div>
      <div style={{ fontSize: 9, color: C.dm }}>
        {job.startedAt   && <span style={{ color: C.am }}>Started {fT(job.startedAt)} </span>}
        {job.completedAt && <span style={{ color: C.gn }}>Done {fT(job.completedAt)}</span>}
      </div>
    </div>}
    {showNotes && <div style={{ marginTop: 4 }}><textarea style={{ ...iS, height: 45, fontSize: 10, resize: "vertical" }} placeholder="Notes..." value={job.notes || ""} onChange={e => onUpdate({ notes: e.target.value })} /></div>}
  </div>;
}

// ── DriversTab ──────────────────────────────────
function DriversTab({ jobs, drivers, viewDay, hpd }) {
  const dayJobs = jobs.filter(j => j.day === viewDay && j.status !== "cancelled");

  return <div>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{dayFull(viewDay)} - Driver Schedules</div>
    {drivers.map(d => {
      const dj      = dayJobs.filter(j => j.driverId === d.id);
      const totalH  = dj.reduce((s, j) => s + jobTotal(j), 0);
      const totalMi = dj.reduce((s, j) => s + jobMiles(j), 0);
      const pct     = hpd > 0 ? totalH / hpd * 100 : 0;
      const col     = pct >= 90 ? C.rd : pct >= 70 ? C.am : C.gn;
      const avail   = Math.max(hpd - totalH, 0);

      return <div key={d.id} style={{ ...cB, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{dLb(d)}</span>
            <span style={{ fontSize: 10, color: C.dm, marginLeft: 8 }}>{YARDS.find(y => y.id === d.yard)?.short}</span>
            {dj.some(j => j.status === "active") && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: C.ab, color: C.am, marginLeft: 6, animation: "pulse 2s infinite" }}>ON JOB</span>}
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: col }}>{fD(totalH)}</span>
            <span style={{ fontSize: 10, color: C.dm, marginLeft: 4 }}>/ {hpd}h</span>
          </div>
        </div>
        <div style={{ height: 8, background: C.sf, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
          <div style={{ height: "100%", width: Math.min(pct, 100) + "%", background: col, borderRadius: 4 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dm, marginBottom: 8 }}>
          <span>{dj.length} jobs · {fMi(totalMi)}</span>
          <span style={{ color: col }}>{fD(avail)} available</span>
        </div>
        {dj.length > 0 && <div style={{ position: "relative", height: 36 * dj.length, background: C.sf, borderRadius: 6, overflow: "hidden" }}>
          {dj.map((j, idx) => {
            const startPct = (dj.slice(0, idx).reduce((s, jj) => s + jobTotal(jj), 0) / hpd) * 100;
            const widthPct = Math.min((jobTotal(j) / hpd) * 100, 100 - startPct);
            const puN      = j.pickupAddr ? cityFrom(j.pickupAddr) : (lz(j.pickupZip)?.label || "?");
            const drNN     = j.dropAddr   ? cityFrom(j.dropAddr)   : (lz(j.dropZip)?.label   || "?");
            const barCol   = j.status === "active" ? C.am : j.status === "complete" ? C.gn : C.ac;
            return <div key={j.id} className="gantt-bar" style={{ top: idx * 36 + 4, left: startPct + "%", width: Math.max(widthPct, 8) + "%", background: barCol + "33", border: "1px solid " + barCol, color: C.tx }}>
              <span style={{ color: C.pu, fontWeight: 800, marginRight: 4 }}>{j.tbCallNum || "?"}</span>
              {puN} → {drNN}
              <span style={{ marginLeft: "auto", color: barCol, fontWeight: 700, paddingLeft: 4 }}>{fH(jobTotal(j))}</span>
            </div>;
          })}
        </div>}
        {dj.length === 0 && <div style={{ fontSize: 11, color: C.dm, textAlign: "center", padding: 10 }}>No jobs assigned</div>}
      </div>;
    })}
  </div>;
}

// ── MetricsTab ──────────────────────────────────
function MetricsTab({ jobs, drivers, viewDay, hpd, staffing }) {
  const week       = genDays(7);
  const activeJobs = jobs.filter(j => j.status !== "cancelled");

  const driverStats = drivers.map(d => {
    const dj        = activeJobs.filter(j => j.driverId === d.id);
    const weekJobs  = dj.filter(j => week.includes(j.day));
    const totalH    = weekJobs.reduce((s, j) => s + jobTotal(j), 0);
    const totalMi   = weekJobs.reduce((s, j) => s + jobMiles(j), 0);
    const completed = weekJobs.filter(j => j.status === "complete").length;
    return { ...d, weekJobs: weekJobs.length, weekH: totalH, weekMi: totalMi, completed, utilPct: hpd * 5 > 0 ? totalH / (hpd * 5) * 100 : 0 };
  }).sort((a, b) => b.weekH - a.weekH);

  const typeBreak   = {};
  activeJobs.filter(j => week.includes(j.day)).forEach(j => { const r = j.tbReason || "OTHER"; typeBreak[r] = (typeBreak[r] || 0) + 1; });
  const typeEntries = Object.entries(typeBreak).sort((a, b) => b[1] - a[1]);
  const typeTotal   = typeEntries.reduce((s, e) => s + e[1], 0);

  const weekStats = week.map(iso => {
    const dj     = activeJobs.filter(j => j.day === iso);
    const totalH = dj.reduce((s, j) => s + jobTotal(j), 0);
    const staff  = staffing[iso] != null ? staffing[iso] : drivers.length;
    const cap    = staff * hpd;
    return { iso, n: dj.length, totalH, cap, pct: cap > 0 ? totalH / cap * 100 : 0 };
  });

  const fleetWeekH   = driverStats.reduce((s, d) => s + d.weekH,  0);
  const fleetWeekMi  = driverStats.reduce((s, d) => s + d.weekMi, 0);
  const fleetCapH    = week.reduce((s, iso) => { const st = staffing[iso] != null ? staffing[iso] : drivers.length; return s + st * hpd; }, 0);
  const fleetUtil    = fleetCapH > 0 ? fleetWeekH / fleetCapH * 100 : 0;
  const weekJobCount = activeJobs.filter(j => week.includes(j.day)).length;
  const avgJobH      = weekJobCount > 0 ? fleetWeekH / weekJobCount : 0;

  return <div>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
      Fleet Metrics - This Week
      <span style={{ fontSize: 10, color: C.am, fontWeight: 600, background: C.ab, padding: "2px 8px", borderRadius: 4, marginLeft: 6 }}>WORK IN PROGRESS</span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
      <div className="dash-card" style={{ background: C.ad }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 3 }}>Fleet Utilization</div><div style={{ fontSize: 28, fontWeight: 800, color: fleetUtil > 80 ? C.am : C.gn }}>{Math.round(fleetUtil)}%</div></div>
      <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 3 }}>Total Hours</div><div style={{ fontSize: 28, fontWeight: 800, color: C.ac }}>{fD(fleetWeekH)}</div><div style={{ fontSize: 9, color: C.dm }}>of {fD(fleetCapH)} capacity</div></div>
      <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 3 }}>Total Miles</div><div style={{ fontSize: 28, fontWeight: 800, color: C.pu }}>{Math.round(fleetWeekMi).toLocaleString()}</div></div>
      <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 3 }}>Avg Job</div><div style={{ fontSize: 28, fontWeight: 800, color: C.am }}>{fH(avgJobH)}</div></div>
    </div>
    <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Weekly Capacity</div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 100 }}>
        {weekStats.map(s => {
          const h   = Math.max(s.pct, 3);
          const col = s.pct >= 90 ? C.rd : s.pct >= 70 ? C.am : C.gn;
          return <div key={s.iso} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: col, marginBottom: 2 }}>{s.n}</div>
            <div style={{ height: 80, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <div style={{ height: Math.min(h, 100) + "%", background: col + "44", border: "1px solid " + col, borderRadius: 3, minHeight: 4 }} />
            </div>
            <div style={{ fontSize: 9, color: s.iso === viewDay ? C.ac : C.dm, fontWeight: s.iso === viewDay ? 700 : 400, marginTop: 3 }}>{dayNm(s.iso)}</div>
            <div style={{ fontSize: 8, color: C.dm }}>{fD(s.totalH)}</div>
          </div>;
        })}
      </div>
    </div>
    <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Job Types This Week</div>
      {typeEntries.map(([type, count]) => {
        const pct = typeTotal > 0 ? count / typeTotal * 100 : 0;
        return <div key={type} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}><span>{type}</span><span style={{ color: C.ac, fontWeight: 700 }}>{count} ({Math.round(pct)}%)</span></div>
          <div style={{ height: 6, background: C.sf, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: pct + "%", background: C.ac, borderRadius: 3 }} /></div>
        </div>;
      })}
    </div>
    <div style={{ ...cB, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Driver Scorecards - This Week</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px 80px 60px", gap: 4, fontSize: 10 }}>
        <div style={{ fontWeight: 700, color: C.dm }}>Driver</div>
        <div style={{ fontWeight: 700, color: C.dm, textAlign: "right" }}>Hours</div>
        <div style={{ fontWeight: 700, color: C.dm, textAlign: "right" }}>Miles</div>
        <div style={{ fontWeight: 700, color: C.dm, textAlign: "right" }}>Jobs</div>
        <div style={{ fontWeight: 700, color: C.dm, textAlign: "right" }}>Done</div>
        <div style={{ fontWeight: 700, color: C.dm, textAlign: "right" }}>Util%</div>
        {driverStats.map(d => {
          const col = d.utilPct >= 80 ? C.am : d.utilPct >= 50 ? C.gn : C.dm;
          return <React.Fragment key={d.id}>
            <div style={{ fontWeight: 600 }}>{dLb(d)}</div>
            <div style={{ textAlign: "right", color: C.ac }}>{fD(d.weekH)}</div>
            <div style={{ textAlign: "right", color: C.pu }}>{Math.round(d.weekMi)}</div>
            <div style={{ textAlign: "right" }}>{d.weekJobs}</div>
            <div style={{ textAlign: "right", color: C.gn }}>{d.completed}</div>
            <div style={{ textAlign: "right", color: col, fontWeight: 700 }}>{Math.round(d.utilPct)}%</div>
          </React.Fragment>;
        })}
      </div>
    </div>
  </div>;
}

// ── SettingsTab ─────────────────────────────────
// Props changed from generic setDrivers/setHpd to explicit callbacks
// so each operation can write to Supabase immediately.
function SettingsTab({ yards, onAddYard, onUpdateYard, onDeleteYard, newYard, setNewYard,
                        drivers, onAddDriver, onUpdateDriver, onDeleteDriver, hpd, onSetHpd, newDr, setNewDr }) {
  // Generate a stable slug ID from the yard's short name
  const toYardId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);

  const addYd = () => {
    if (!newYard.short.trim() || !newYard.addr.trim() || !newYard.zip.trim()) return;
    const id = toYardId(newYard.short);
    if (yards.find(y => y.id === id)) return alert(`A yard with id "${id}" already exists.`);
    onAddYard({ id, short: newYard.short.trim(), addr: newYard.addr.trim(), zip: newYard.zip.trim() });
    setNewYard({ short: "", addr: "", zip: "" });
  };

  const addDr = () => {
    if (!newDr.name.trim()) return;
    onAddDriver({ id: uid(), name: newDr.name.trim(), truck: newDr.truck.trim(), yard: newDr.yard });
    setNewDr({ name: "", truck: "", yard: "exeter" });
  };

  return <div>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Settings</div>

    <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.pu, marginBottom: 6 }}>TowBook Import</div>
      <div style={{ fontSize: 11, color: C.dm, lineHeight: 1.7, marginBottom: 8 }}>Drag button to bookmarks (one-time). Then: TowBook → click bookmark → here → Import.</div>
      <div style={{ background: C.sf, borderRadius: 8, padding: 12, textAlign: "center", border: "1px solid " + C.bd, marginBottom: 8 }}>
        <a href={window.NETC_BM} onClick={e => e.preventDefault()} style={{ display: "inline-block", background: C.pu, color: C.wh, padding: "10px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none", cursor: "grab" }}>📋 Pull TowBook</a>
        <div style={{ fontSize: 9, color: C.dm, marginTop: 5 }}>↑ Drag to bookmarks bar</div>
      </div>
      <div style={{ fontSize: 10, color: C.dm, padding: 6, background: C.inp, borderRadius: 5, border: "1px solid " + C.bd }}>
        <strong style={{ color: C.am }}>Console backup:</strong> F12 → Console → <code style={{ color: C.tx }}>allow pasting</code> → Enter → paste → Enter
        <button style={{ ...bP, background: C.am, fontSize: 9, padding: "2px 8px", marginLeft: 6 }} onClick={() => { navigator.clipboard.writeText(window.NETC_CC); alert("Copied!"); }}>Copy Code</button>
      </div>
    </div>

    {/* Yard Locations */}
    <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Yard Locations</div>
      <div style={{ fontSize: 10, color: C.dm, marginBottom: 8 }}>Changes apply immediately for all users. Jobs reference yards by ID — don't delete a yard that has jobs assigned to it.</div>

      {/* Add new yard form */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <input style={{ ...iS, flex: 1 }} placeholder="Name (e.g. Portsmouth)" value={newYard.short} onChange={e => setNewYard({ ...newYard, short: e.target.value })} onKeyDown={e => { if (e.key === "Enter") addYd(); }} />
        <input style={{ ...iS, flex: 2 }} placeholder="Full address" value={newYard.addr} onChange={e => setNewYard({ ...newYard, addr: e.target.value })} />
        <input style={{ ...iS, width: 60 }} placeholder="ZIP" maxLength={5} value={newYard.zip} onChange={e => setNewYard({ ...newYard, zip: e.target.value.replace(/\D/g, "") })} />
        <button style={{ ...bP, padding: "5px 10px" }} onClick={addYd}>+</button>
      </div>

      {/* Existing yards — editable in place */}
      {yards.map(y => <div key={y.id} style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 6px", marginBottom: 3, background: C.sf, borderRadius: 6, border: "1px solid " + C.bd }}>
        <span style={{ fontSize: 9, color: C.dm, minWidth: 70, fontFamily: "monospace" }}>{y.id}</span>
        <input style={{ ...iS, width: 90, padding: "2px 5px", fontSize: 11, fontWeight: 600, background: "transparent", border: "none" }} value={y.short} onChange={e => onUpdateYard(y.id, { short: e.target.value })} />
        <input style={{ ...iS, flex: 1, padding: "2px 5px", fontSize: 10, background: "transparent", border: "none" }} value={y.addr} onChange={e => onUpdateYard(y.id, { addr: e.target.value })} />
        <input style={{ ...iS, width: 55, padding: "2px 4px", fontSize: 10, background: "transparent", border: "1px solid " + C.bd }} value={y.zip} onChange={e => onUpdateYard(y.id, { zip: e.target.value.replace(/\D/g, "") })} maxLength={5} />
        <button style={{ ...bSt, padding: "1px 3px", color: C.rd }} onClick={() => { if (confirm(`Delete yard "${y.short}"? Jobs assigned to it will lose their yard.`)) onDeleteYard(y.id); }}>✕</button>
      </div>)}
    </div>

    <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Working Hours</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: C.dm }}>Default hours per driver per day:</span>
        <select style={{ ...sS, width: 60, fontSize: 12 }} value={hpd} onChange={e => onSetHpd(parseInt(e.target.value))}>
          {[6, 7, 8, 9, 10, 11, 12, 13, 14].map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
    </div>

    <div style={{ ...cB, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Driver Roster</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <input style={{ ...iS, flex: 1 }} placeholder="Name" value={newDr.name} onChange={e => setNewDr({ ...newDr, name: e.target.value })} onKeyDown={e => { if (e.key === "Enter") addDr(); }} />
        <input style={{ ...iS, width: 55 }} placeholder="Truck#" value={newDr.truck} onChange={e => setNewDr({ ...newDr, truck: e.target.value })} />
        <select style={{ ...sS, width: 110, fontSize: 11 }} value={newDr.yard} onChange={e => setNewDr({ ...newDr, yard: e.target.value })}>
          {yards.map(y => <option key={y.id} value={y.id}>{y.short}</option>)}
        </select>
        <button style={{ ...bP, padding: "5px 10px" }} onClick={addDr}>+</button>
      </div>
      {yards.map(y => {
        const yd = drivers.filter(d => d.yard === y.id);
        if (!yd.length) return null;
        return <div key={y.id} style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.ac, marginBottom: 2 }}>{y.short} ({yd.length})</div>
          {yd.map(d => <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 5px", marginBottom: 1, background: C.sf, borderRadius: 4, border: "1px solid " + C.bd }}>
            <input style={{ ...iS, flex: 1, padding: "2px 5px", fontSize: 11, fontWeight: 600, background: "transparent", border: "none" }} value={d.name} onChange={e => onUpdateDriver(d.id, { name: e.target.value })} />
            <input style={{ ...iS, width: 40, padding: "2px 4px", fontSize: 10, background: "transparent", border: "1px solid " + C.bd }} value={d.truck || ""} onChange={e => onUpdateDriver(d.id, { truck: e.target.value })} />
            <select style={{ ...sS, width: 90, padding: "2px 4px", fontSize: 10 }} value={d.yard} onChange={e => onUpdateDriver(d.id, { yard: e.target.value })}>
              {yards.map(v => <option key={v.id} value={v.id}>{v.short}</option>)}
            </select>
            <button style={{ ...bSt, padding: "1px 3px", color: C.rd }} onClick={() => onDeleteDriver(d.id)}>✕</button>
          </div>)}
        </div>;
      })}
    </div>
  </div>;
}

// ── App ─────────────────────────────────────────
// Root component. Fetches all data from Supabase on mount,
// then manages state + orchestrates the four tabs.
function App() {
  const [loaded,       setLoaded]       = useState(false);
  const [tab,          setTab]          = useState("schedule");
  const [yards,        setYards]        = useState([]);
  const [drivers,      setDrivers]      = useState([]);
  const [hpd,          setHpd]          = useState(8);
  const [staffing,     setStaffing]     = useState({});
  const [jobs,         setJobs]         = useState([]);
  const [viewDay,      setViewDay]      = useState(todayISO());
  const [showForm,     setShowForm]     = useState(false);
  const [showImport,   setShowImport]   = useState(false);
  const [impData,      setImpData]      = useState(null);
  const [geoProg,      setGeoProg]      = useState(null);
  const [now,          setNow]          = useState(new Date());
  const [fp,           setFp]           = useState("");
  const [fd,           setFd]           = useState("");
  const [newDr,        setNewDr]        = useState({ name: "", truck: "", yard: "exeter" });
  const [newYard,      setNewYard]      = useState({ short: "", addr: "", zip: "" });
  const [reasonFilter, setReasonFilter] = useState(() => LS.get('filter', "EQUIPMENT TRANSPORT"));

  // ── Initial data load from Supabase ────────────
  useEffect(() => {
    (async () => {
      const [fetchedJobs, fetchedYards, fetchedDrivers, fetchedHpd, fetchedStaffing] = await Promise.all([
        db.loadAllJobs(),
        db.loadYards(),
        db.loadDrivers(),
        db.loadSetting('hpd', 8),
        db.loadSetting('staffing', {}),
      ]);
      setJobs(fetchedJobs);
      setHpd(fetchedHpd);
      setStaffing(fetchedStaffing);

      // Yards: seed from DEFAULT_YARDS on first run, then keep the global in sync
      const yardsToUse = fetchedYards.length > 0 ? fetchedYards : DEFAULT_YARDS;
      YARDS.splice(0, YARDS.length, ...yardsToUse);
      setYards(yardsToUse);
      if (!fetchedYards.length) {
        await Promise.all(DEFAULT_YARDS.map(y => db.upsertYard(y)));
      }

      // Drivers: seed from defaultDrivers on first run
      if (fetchedDrivers.length > 0) {
        setDrivers(fetchedDrivers);
      } else {
        setDrivers(defaultDrivers);
        await Promise.all(defaultDrivers.map(d => db.upsertDriver(d)));
      }
      setLoaded(true);
    })();
  }, []);

  // Persist filter preference locally (it's per-user, not shared)
  useEffect(() => LS.set('filter', reasonFilter), [reasonFilter]);

  // Clock tick for the header timestamp
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── Job operations ──────────────────────────────
  // Each operation updates local state immediately (for snappy UI)
  // and writes to Supabase in the background.

  const addJob = (did) => {
    if (!formYard || !formCalc) return;
    const newJob = {
      id: uid(), yardId: formYard.id, driverId: did || 0,
      pickupZip: fp, dropZip: fd, pickupAddr: "", dropAddr: "",
      tbReason: "MANUAL", priority: "normal", status: "scheduled",
      addedAt: new Date().toISOString(), day: viewDay, stops: [],
    };
    setJobs(prev => [...prev, newJob]);
    db.upsertJob(newJob);
    setFp(""); setFd(""); setShowForm(false);
  };

  // Uses functional updater so we always have the latest job object for the DB write
  const updJob = (id, upd) => {
    setJobs(prev => {
      const next    = prev.map(j => j.id === id ? { ...j, ...upd } : j);
      const updated = next.find(j => j.id === id);
      if (updated) db.upsertJob(updated);
      return next;
    });
  };

  const rmJob = (id) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    db.deleteJob(id);
  };

  // ── Driver operations ───────────────────────────

  const addDriver = (newDriver) => {
    setDrivers(prev => { db.upsertDriver(newDriver); return [...prev, newDriver]; });
  };

  const updateDriver = (id, fields) => {
    setDrivers(prev => {
      const next    = prev.map(x => x.id === id ? { ...x, ...fields } : x);
      const updated = next.find(x => x.id === id);
      if (updated) db.upsertDriver(updated);
      return next;
    });
  };

  const removeDriver = (id) => {
    setDrivers(prev => { db.deleteDriver(id); return prev.filter(x => x.id !== id); });
  };

  // ── Yard operations ─────────────────────────────
  // Each operation updates React state, the YARDS global (used by geo/utils),
  // and Supabase — all in one go via the functional updater pattern.

  const addYard = (newY) => {
    setYards(prev => {
      const next = [...prev, newY];
      YARDS.splice(0, YARDS.length, ...next);
      db.upsertYard(newY);
      return next;
    });
  };

  const updateYard = (id, fields) => {
    setYards(prev => {
      const next    = prev.map(y => y.id === id ? { ...y, ...fields } : y);
      const updated = next.find(y => y.id === id);
      if (updated) db.upsertYard(updated);
      YARDS.splice(0, YARDS.length, ...next);
      return next;
    });
  };

  const removeYard = (id) => {
    setYards(prev => {
      const next = prev.filter(y => y.id !== id);
      YARDS.splice(0, YARDS.length, ...next);
      db.deleteYard(id);
      return next;
    });
  };

  // ── Settings operations ─────────────────────────

  const updateHpd = (n) => {
    setHpd(n);
    db.saveSetting('hpd', n);
  };

  const updateStaff = (day, n) => {
    setStaffing(prev => {
      const next = { ...prev, [day]: Math.max(0, Math.min(n, 50)) };
      db.saveSetting('staffing', next);
      return next;
    });
  };

  // ── TowBook import ──────────────────────────────

  const existCN    = useMemo(() => { const m = {}; jobs.forEach(j => { if (j.tbCallNum) m[j.tbCallNum] = j; }); return m; }, [jobs]);
  const allReasons = useMemo(() => { const s = new Set(); jobs.forEach(j => { if (j.tbReason) s.add(j.tbReason); }); return ["ALL", ...[...s].sort()]; }, [jobs]);

  const doImport = useCallback(async () => {
    try {
      const t    = await navigator.clipboard.readText();
      const data = JSON.parse(t);
      if (!Array.isArray(data) || !data.length) return alert("No jobs on clipboard.");

      const geoA     = [];
      data.forEach(d => { if (d.pickup) geoA.push(d.pickup); if (d.drop) geoA.push(d.drop); });
      const uncached = geoA.filter(a => !geoCache[a]);
      if (uncached.length > 0) {
        setGeoProg({ done: 0, total: uncached.length });
        setShowImport(true);
        await batchGeo(geoA, (d, t) => setGeoProg({ done: d, total: t }));
        setGeoProg(null);
      } else {
        setShowImport(true);
      }

      const enr = data.map(d => {
        const existing = existCN[d.callNum];
        const yard     = closestYard(d.pickup, d.pickupZip);
        const jt       = jCalc(yard.addr, yard.zip, d.pickup, d.pickupZip, d.drop, d.dropZip);
        const day      = tbToISO(d.scheduled) || todayISO();
        let mid = 0;
        if (d.driver) {
          const dn    = d.driver.toLowerCase();
          const match = drivers.find(dr => dn.indexOf(dr.name.split(' ')[1]?.toLowerCase()) > -1);
          if (match) mid = match.id;
        }
        return { ...d, dup: !!existing, yard, jt, day, include: !existing, matchedDriverId: mid,
          puName: d.pickup ? (geoCache[d.pickup]?.name || cityFrom(d.pickup)) : (lz(d.pickupZip)?.label || ""),
          drName: d.drop   ? (geoCache[d.drop]?.name   || cityFrom(d.drop))   : (lz(d.dropZip)?.label   || "") };
      });
      setImpData(enr);
    } catch(e) { alert("Clipboard error: " + e.message); setGeoProg(null); }
  }, [existCN, drivers]);

  const commitImport = () => {
    if (!impData) return;
    const add     = impData.filter(d => d.include && !d.dup && (d.pickupZip || d.dropZip));
    const newCNs  = new Set(impData.map(d => d.callNum).filter(Boolean));
    const impDays = new Set(impData.map(d => d.day));

    const newJobs = add.map(d => ({
      id: uid(), yardId: d.yard.id, driverId: d.matchedDriverId || 0,
      pickupZip: d.pickupZip, dropZip: d.dropZip, pickupAddr: d.pickup || "",
      dropAddr: d.drop || "", tbCallNum: d.callNum, tbDesc: d.desc,
      tbScheduled: d.scheduled, tbReason: d.reason || "", tbDriver: d.driver || "",
      priority: "normal", status: "scheduled", stops: [],
      addedAt: new Date().toISOString(), day: d.day,
    }));

    // IDs of currently-scheduled jobs that are missing from this import (will be cancelled)
    const cancelIds = jobs
      .filter(j => j.tbCallNum && j.status === "scheduled" && impDays.has(j.day) && !newCNs.has(j.tbCallNum))
      .map(j => j.id);

    // Update local state
    setJobs(prev => {
      const up = prev.map(j => cancelIds.includes(j.id) ? { ...j, status: "cancelled" } : j);
      return [...up, ...newJobs];
    });

    // Write to Supabase (fire and forget)
    db.batchUpsertJobs(newJobs);
    db.cancelJobs(cancelIds);

    // Jump to the day with the most new jobs
    const dc  = {}; add.forEach(d => { dc[d.day] = (dc[d.day] || 0) + 1; });
    const top = Object.entries(dc).sort((a, b) => b[1] - a[1])[0];
    if (top) setViewDay(top[0]);
    setImpData(null); setShowImport(false);
  };

  // ── Derived state ───────────────────────────────

  const calDays   = useMemo(() => genDays(21), []);
  const filt      = (arr) => reasonFilter === "ALL" ? arr : arr.filter(j => (j.tbReason || "") === reasonFilter);
  const getStaff  = (d) => staffing[d] != null ? staffing[d] : drivers.length;

  const formYard  = useMemo(() => lz(fp) ? closestYard("", fp) : null, [fp]);
  const formCalc  = useMemo(() => { if (!formYard || !lz(fp) || !lz(fd)) return null; return jCalc(formYard.addr, formYard.zip, "", fp, "", fd); }, [formYard, fp, fd]);

  const dayJobMap = useMemo(() => {
    const m = {};
    jobs.forEach(j => { if (j.status !== "cancelled") { const k = j.day || todayISO(); if (!m[k]) m[k] = []; m[k].push(j); } });
    return m;
  }, [jobs]);

  function daySt(iso) {
    const djAll  = dayJobMap[iso] || [];
    const dj     = filt(djAll);
    const totalH = dj.reduce((s, j) => s + jobTotal(j), 0);
    const staff  = getStaff(iso);
    const cap    = staff * hpd;
    return { n: dj.length, totalH, staff, cap, pct: cap > 0 ? totalH / cap * 100 : 0,
      need: Math.ceil(totalH / hpd), assigned: dj.filter(j => j.driverId).length,
      active: dj.filter(j => j.status === "active").length,
      sched:  dj.filter(j => j.status === "scheduled").length,
      done:   dj.filter(j => j.status === "complete").length };
  }

  const impByDay = useMemo(() => { if (!impData) return {}; const m = {}; impData.forEach((d, i) => { const k = d.day; if (!m[k]) m[k] = []; m[k].push({ ...d, oi: i }); }); return m; }, [impData]);
  const impStats = useMemo(() => { if (!impData) return null; const nw = impData.filter(d => d.include && !d.dup); return { n: nw.length, dp: impData.filter(d => d.dup).length, h: nw.reduce((s, d) => s + d.jt.total, 0) }; }, [impData]);

  const vs    = daySt(viewDay);
  const vJobs = filt(dayJobMap[viewDay] || []);
  const vAct  = vJobs.filter(j => j.status === "active");
  const vSch  = vJobs.filter(j => j.status === "scheduled");
  const vDon  = vJobs.filter(j => j.status === "complete");
  const stCol = vs.pct >= 90 ? C.rd : vs.pct >= 75 ? C.am : C.gn;

  // ── Loading state ───────────────────────────────
  if (!loaded) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.dm, fontSize: 13 }}>Loading schedule…</div>
    </div>
  );

  // ── Render ──────────────────────────────────────
  return <div style={{ background: C.bg, minHeight: "100vh", padding: "12px 16px", maxWidth: 980, margin: "0 auto" }}>

    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.dm }}>NETC Transport</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Capacity Planner</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>{fT(now)}</span>
        <button style={{ ...bSt, fontSize: 9, color: C.rd, borderColor: "#3b1111" }} onClick={() => {
          if (confirm("Clear ALL jobs? This affects all users.")) {
            db.clearAllJobs().then(() => setJobs([]));
          }
        }}>🗑 Reset</button>
        <button style={{ ...bSt, fontSize: 9 }} onClick={() => signOut()}>Sign Out</button>
      </div>
    </div>

    {/* Tabs */}
    <div className="tabs">
      {[["schedule", "📋 Schedule"], ["drivers", "👥 Drivers"], ["metrics", "📊 Metrics (WIP)"], ["settings", "⚙ Settings"]].map(([k, l]) =>
        <div key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</div>
      )}
    </div>

    {/* Reason filter */}
    {(tab === "schedule" || tab === "drivers") && allReasons.length > 1 && <div className="fb">
      <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: "center", marginRight: 2 }}>SHOW:</span>
      {allReasons.map(r => <button key={r} className={"fbtn" + (reasonFilter === r ? " on" : "")} onClick={() => setReasonFilter(r)}>
        {r === "ALL" ? "All" : r} ({r === "ALL" ? jobs.filter(j => j.status !== "cancelled").length : jobs.filter(j => j.tbReason === r && j.status !== "cancelled").length})
      </button>)}
    </div>}

    {/* Calendar strip */}
    {(tab === "schedule" || tab === "drivers") && <div className="cal">
      {calDays.map(iso => {
        const st  = daySt(iso);
        const sel = iso === viewDay;
        const col = st.n === 0 ? C.dm : st.pct >= 90 ? C.rd : st.pct >= 75 ? C.am : C.gn;
        return <div key={iso} className={"dc" + (sel ? " sel" : "")} style={{ background: sel ? C.ad : C.cd }} onClick={() => setViewDay(iso)}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: iso === todayISO() ? C.ac : C.tx }}>{dayNm(iso)}</div>
              <div style={{ fontSize: 9, color: C.dm }}>{daySh(iso)}</div>
            </div>
            {st.n > 0 && <div style={{ fontSize: 15, fontWeight: 800, color: col }}>{st.n}</div>}
          </div>
          <div style={{ height: 3, background: C.sf, borderRadius: 2, overflow: "hidden", marginBottom: 3 }}>
            <div style={{ height: "100%", width: Math.min(st.pct, 100) + "%", background: col, borderRadius: 2 }} />
          </div>
          {st.n > 0
            ? <div style={{ fontSize: 8, color: C.dm }}>{fD(st.totalH)} need {st.need}{st.need > st.staff && <span style={{ color: C.rd, fontWeight: 700 }}> -{st.need - st.staff}</span>}</div>
            : <div style={{ fontSize: 8, color: C.dm }}>Empty</div>
          }
          <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 3 }} onClick={e => e.stopPropagation()}>
            <button style={{ background: C.sf, border: "1px solid " + C.bd, borderRadius: 3, color: C.tx, width: 14, height: 14, fontSize: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { e.stopPropagation(); updateStaff(iso, getStaff(iso) - 1); }}>−</button>
            <span style={{ fontSize: 10, fontWeight: 700, minWidth: 12, textAlign: "center" }}>{st.staff}</span>
            <button style={{ background: C.sf, border: "1px solid " + C.bd, borderRadius: 3, color: C.tx, width: 14, height: 14, fontSize: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { e.stopPropagation(); updateStaff(iso, getStaff(iso) + 1); }}>+</button>
          </div>
        </div>;
      })}
    </div>}

    {/* ═══ SCHEDULE TAB ═══ */}
    {tab === "schedule" && <>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, marginBottom: 8 }}>{dayFull(viewDay)}</div>
      <div className="dash">
        <div className="dash-card" style={{ background: vs.n > 0 ? C.ad : C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 2 }}>Calls</div><div style={{ fontSize: 30, fontWeight: 800, color: C.ac }}>{vs.n}</div><div style={{ fontSize: 9, color: C.dm, marginTop: 2 }}>{vs.active}a · {vs.sched}s · {vs.done}d</div></div>
        <div className="dash-card" style={{ background: vs.totalH > 0 ? "#1a1a0d" : C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 2 }}>Hours</div><div style={{ fontSize: 30, fontWeight: 800, color: C.am }}>{fD(vs.totalH)}</div><div style={{ fontSize: 9, color: C.dm, marginTop: 2 }}>of {fD(vs.cap)}</div></div>
        <div className="dash-card" style={{ background: vs.need > vs.staff ? "#1a0d0d" : vs.n > 0 ? "#0d1a0d" : C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 2 }}>Need</div><div style={{ fontSize: 30, fontWeight: 800, color: vs.need > vs.staff ? C.rd : C.gn }}>{vs.need}</div><div style={{ fontSize: 9, color: vs.need > vs.staff ? C.rd : C.dm, fontWeight: vs.need > vs.staff ? 700 : 400, marginTop: 2 }}>{vs.need > vs.staff ? "SHORT " + (vs.need - vs.staff) : vs.staff + " staffed"}</div></div>
        <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: "uppercase", marginBottom: 2 }}>Assigned</div><div style={{ fontSize: 30, fontWeight: 800, color: vs.assigned ? C.pu : C.dm }}>{vs.assigned}</div><div style={{ fontSize: 9, color: C.dm, marginTop: 2 }}>of {vs.n}</div></div>
      </div>

      {vs.n > 0 && <div style={{ marginBottom: 8 }}>
        <div style={{ height: 6, background: C.sf, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: Math.min(vs.pct, 100) + "%", background: stCol, borderRadius: 3 }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.dm, marginTop: 2 }}>
          <span>{fD(vs.totalH)} committed</span>
          <span style={{ color: stCol }}>{fD(Math.max(vs.cap - vs.totalH, 0))} available</span>
        </div>
      </div>}

      {geoProg && <div style={{ ...cB, background: C.pd, borderColor: C.pu }}><div style={{ fontSize: 11, fontWeight: 700, color: C.pu }}>Geocoding… {geoProg.done}/{geoProg.total}</div></div>}

      {showImport && impData && <div style={{ ...cB, background: "#1a1428", borderColor: C.pu, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.pu }}>TowBook Import</div>
            <div style={{ fontSize: 10, color: C.dm }}><span style={{ color: C.gn }}>{impStats?.n} new</span>{impStats?.dp > 0 && <span style={{ marginLeft: 6 }}>{impStats.dp} exist</span>} · {fD(impStats?.h || 0)}</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button style={{ ...bP, background: C.pu }} onClick={commitImport}>Import {impStats?.n}</button>
            <button style={bSt} onClick={() => { setShowImport(false); setImpData(null); }}>Cancel</button>
          </div>
        </div>
        <div style={{ fontSize: 9, color: C.am, marginBottom: 4 }}>Missing calls auto-cancelled on import.</div>
        {Object.entries(impByDay).sort().map(([day, items]) => {
          const nw = items.filter(d => d.include && !d.dup);
          return <div key={day} style={{ marginBottom: 5 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.ac, marginBottom: 2 }}>{dayFull(day)} - {nw.length} new</div>
            {items.slice(0, 8).map(d => <div key={d.oi} style={{ background: d.dup ? "transparent" : C.cd, border: "1px solid " + (d.dup ? "transparent" : C.bd), borderRadius: 4, padding: "3px 7px", marginBottom: 1, opacity: d.dup ? .3 : 1, display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
              <span style={{ color: C.pu, fontWeight: 700, minWidth: 50 }}>{d.callNum}</span>
              <span style={{ flex: 1, color: C.dm }}>{d.puName}→{d.drName}</span>
              {d.reason && <span style={{ color: C.dm, background: C.sf, padding: "0 4px", borderRadius: 6, fontSize: 8 }}>{d.reason}</span>}
              {d.driver && <span style={{ color: C.am, fontSize: 8 }}>{d.driver}</span>}
              <span style={{ color: C.pu, fontWeight: 700 }}>{fH(d.jt.total)}</span>
            </div>)}
            {items.length > 8 && <div style={{ fontSize: 9, color: C.dm, padding: 2 }}>+{items.length - 8} more</div>}
          </div>;
        })}
      </div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <button style={{ ...bSt, color: C.pu, borderColor: C.pu }} onClick={doImport}>📋 Import TowBook</button>
        <button style={bP} onClick={() => setShowForm(!showForm)}>{showForm ? "Cancel" : "+ Add Job"}</button>
      </div>

      {showForm && <div style={{ ...cB, background: C.ca, borderColor: C.ac }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.ac, marginBottom: 4 }}>NEW JOB - {dayFull(viewDay)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 5 }}>
          <div><div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>PICKUP ZIP</div>
            <input style={iS} placeholder="04101" maxLength={5} value={fp} onChange={e => setFp(e.target.value.replace(/\D/g, ""))} />
            {fp.length >= 3 && lz(fp) && <div style={{ fontSize: 8, color: C.dm }}>{lz(fp).label}</div>}
          </div>
          <div><div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>DROP ZIP</div>
            <input style={iS} placeholder="03101" maxLength={5} value={fd} onChange={e => setFd(e.target.value.replace(/\D/g, ""))} />
            {fd.length >= 3 && lz(fd) && <div style={{ fontSize: 8, color: C.dm }}>{lz(fd).label}</div>}
          </div>
        </div>
        {formCalc && <div style={{ background: C.sf, borderRadius: 5, padding: 7, marginBottom: 5, fontSize: 12, fontWeight: 700, color: C.wh }}>Total: {fH(formCalc.total)} · {fMi(formCalc.m1 + formCalc.m2 + formCalc.m3)}</div>}
        <div style={{ display: "flex", gap: 4 }}>
          <select style={{ ...sS, flex: 1 }} value="" onChange={e => { if (e.target.value) addJob(parseInt(e.target.value)); }}>
            <option value="">With driver…</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{dLb(d)}</option>)}
          </select>
          <button style={{ ...bP, opacity: formCalc ? 1 : .4 }} onClick={() => addJob(0)}>Unassigned</button>
        </div>
      </div>}

      {vAct.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: C.am, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, animation: "pulse 2s infinite" }}>Active ({vAct.length})</div>}
      {vAct.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => rmJob(j.id)} />)}
      {vSch.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: C.ac, textTransform: "uppercase", letterSpacing: 1, marginTop: vAct.length ? 5 : 0, marginBottom: 3 }}>Scheduled ({vSch.length})</div>}
      {vSch.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => rmJob(j.id)} />)}
      {vDon.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: C.gn, textTransform: "uppercase", letterSpacing: 1, marginTop: 5, marginBottom: 3 }}>Done ({vDon.length})</div>}
      {vDon.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => rmJob(j.id)} />)}
      {vJobs.length === 0 && !showForm && !showImport && <div style={{ ...cB, textAlign: "center", padding: 20, color: C.dm, fontSize: 11 }}>
        {reasonFilter !== "ALL" ? "No " + reasonFilter + " jobs" : "No jobs"} for {dayFull(viewDay).toLowerCase()}
      </div>}
    </>}

    {tab === "drivers"  && <DriversTab jobs={filt(jobs.filter(j => j.status !== "cancelled"))} drivers={drivers} viewDay={viewDay} hpd={hpd} />}
    {tab === "metrics"  && <MetricsTab jobs={jobs} drivers={drivers} viewDay={viewDay} hpd={hpd} staffing={staffing} />}
    {tab === "settings" && <SettingsTab
      yards={yards}
      onAddYard={addYard} onUpdateYard={updateYard} onDeleteYard={removeYard}
      newYard={newYard} setNewYard={setNewYard}
      drivers={drivers}
      onAddDriver={addDriver} onUpdateDriver={updateDriver} onDeleteDriver={removeDriver}
      hpd={hpd} onSetHpd={updateHpd}
      newDr={newDr} setNewDr={setNewDr}
    />}

    <div style={{ marginTop: 12, padding: "5px 0", borderTop: "1px solid " + C.bd, fontSize: 8, color: C.dm, display: "flex", justifyContent: "space-between" }}>
      <span>Truck calibrated 1.25× road · 45 mph · +1h load · Shared via Supabase</span>
      <span>v4.0</span>
    </div>
  </div>;
}

// ── Root ─────────────────────────────────────────
// Checks for an active Supabase session.
// Shows LoginScreen if unauthenticated, App if authenticated.
function Root() {
  const [session,  setSession]  = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Restore any existing session from localStorage
    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setChecking(false);
    });
    // Listen for sign-in / sign-out events
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      setSession(session);
      setChecking(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (checking) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.dm, fontSize: 13 }}>Connecting…</div>
    </div>
  );

  return session ? <App /> : <LoginScreen />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
