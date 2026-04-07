/* ═══════════════════════════════════════════════
   NETC Transport Planner — Utility Functions

   - LS: localStorage persistence wrapper
   - Date/time formatting helpers
   - Job time & distance calculation (jCalc, jobTotal, jobMiles)
   ═══════════════════════════════════════════════ */

// ── LocalStorage Persistence ────────────────────
// All keys are namespaced with 'netc_' to avoid collisions.
var LS = {
  get: function(k, d) {
    try {
      var v = localStorage.getItem('netc_' + k);
      return v ? JSON.parse(v) : d;
    } catch(e) { return d; }
  },
  set: function(k, v) {
    try { localStorage.setItem('netc_' + k, JSON.stringify(v)); } catch(e) {}
  },
};

// ── Date / Time Helpers ─────────────────────────
// fH: format decimal hours → "2h 30m" or "45m"
function fH(h) {
  if (!h && h !== 0) return "--";
  if (h < 0) return "0m";
  var hr = Math.floor(h), m = Math.round((h - hr) * 60);
  return hr > 0 ? hr + "h " + String(m).padStart(2, "0") + "m" : m + "m";
}
// fD: format hours as "2.5h"
function fD(h) { return (h || 0).toFixed(1) + "h"; }
// fT: format a Date/string to "9:30 AM"
function fT(d) { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
// fMi: format miles as "42 mi"
function fMi(m) { return Math.round(m || 0) + " mi"; }
// dLb: display label for a driver object
function dLb(d) { return d.truck ? d.name + " #" + d.truck : d.name; }

// isoD: convert a Date to "YYYY-MM-DD"
function isoD(d) {
  var x = new Date(d);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
function todayISO() { return isoD(new Date()); }
function tmrwISO()  { var d = new Date(); d.setDate(d.getDate() + 1); return isoD(d); }

// dayNm: short day label ("Today", "Tmrw", or "Mon")
function dayNm(iso) {
  if (iso === todayISO()) return "Today";
  if (iso === tmrwISO()) return "Tmrw";
  return new Date(iso + "T12:00:00").toLocaleDateString('en-US', { weekday: 'short' });
}
// dayFull: full label ("Today", "Tomorrow", or "Monday, Apr 7")
function dayFull(iso) {
  if (iso === todayISO()) return "Today";
  if (iso === tmrwISO()) return "Tomorrow";
  return new Date(iso + "T12:00:00").toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
// daySh: short numeric date "4/7"
function daySh(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}
// genDays: returns an array of n ISO date strings starting from today
function genDays(n) {
  var o = [];
  for (var i = 0; i < n; i++) {
    var d = new Date();
    d.setDate(d.getDate() + i);
    o.push(isoD(d));
  }
  return o;
}
// tbToISO: parse a TowBook date string "MM/DD/YYYY" → "YYYY-MM-DD"
function tbToISO(s) {
  if (!s) return null;
  var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  var y = parseInt(m[3]);
  if (y < 100) y += 2000;
  return y + "-" + String(parseInt(m[1])).padStart(2, "0") + "-" + String(parseInt(m[2])).padStart(2, "0");
}
// cityFrom: extract "City, ST" from a full address string
function cityFrom(addr) {
  if (!addr) return "";
  var m = addr.match(/([A-Za-z\s.'-]+),\s*([A-Z]{2})\s*\d{0,5}/);
  if (m) return m[1].trim() + ", " + m[2];
  return addr.length > 30 ? addr.substring(addr.length - 30) : addr;
}
// sameZip: true if two ZIPs share the same 3-digit prefix (same region)
function sameZip(a, b) { return a && b && a.substring(0, 3) === b.substring(0, 3); }

// ── Job Time / Distance Calculation ────────────
// jCalc: compute leg-by-leg hours & miles for a job route.
// Route: Yard → Pickup → [optional stops] → Drop → Yard
// Speed assumption: 45 mph × 1.25 road factor (see geo.js dMi)
function jCalc(ya, yz, pa, pz, da, dz, stops) {
  var yc = crd(ya, yz), pc = crd(pa, pz), dc = crd(da, dz);

  if (!stops || stops.length === 0) {
    var m1 = dMi(yc, pc), m2 = dMi(pc, dc), m3 = dMi(dc, yc);
    return { h1: m1/45, h2: m2/45, h3: m3/45, m1, m2, m3, total: m1/45 + m2/45 + m3/45 + 1, totalMi: m1 + m2 + m3, legs: null, luH: 1 };
  }

  // Multi-leg: build full point list
  var pts = [{ c: yc, label: "Yard", addr: ya }, { c: pc, label: "Pickup", addr: pa }];
  stops.forEach(function(s, i) {
    var sc = crd(s.addr, s.zip);
    pts.push({ c: sc, label: s.label || ("Stop " + (i + 1)), addr: s.addr || "" });
  });
  pts.push({ c: dc, label: "Drop", addr: da }, { c: yc, label: "Yard", addr: ya });

  var legs = [], tm = 0;
  for (var i = 0; i < pts.length - 1; i++) {
    var mi = dMi(pts[i].c, pts[i + 1].c);
    legs.push({ from: pts[i].label, to: pts[i + 1].label, mi, hr: mi / 45, fromAddr: pts[i].addr, toAddr: pts[i + 1].addr });
    tm += mi;
  }
  var luH = Math.max(1, 0.5 * (pts.length - 2)); // 30 min per stop, min 1h
  var m1b = legs[0]?.mi || 0;
  var m2b = legs.length > 2 ? legs.slice(1, -1).reduce(function(s, l) { return s + l.mi; }, 0) : 0;
  var m3b = legs[legs.length - 1]?.mi || 0;
  return { h1: m1b/45, h2: m2b/45, h3: m3b/45, m1: m1b, m2: m2b, m3: m3b, total: tm/45 + luH, totalMi: tm, legs, luH, multiLeg: true };
}

// jobTotal: total hours for a job (handles multi-stop routes)
function jobTotal(j) {
  var yd = YARDS.find(function(y) { return y.id === j.yardId; }) || YARDS[0];
  var stops = j.stops || [];
  if (stops.length === 0) return jCalc(yd.addr, yd.zip, j.pickupAddr, j.pickupZip, j.dropAddr, j.dropZip).total;
  var pts = [crd(yd.addr, yd.zip), crd(j.pickupAddr, j.pickupZip)];
  stops.forEach(function(s) { pts.push(crd(s.addr, s.zip)); });
  pts.push(crd(j.dropAddr, j.dropZip), crd(yd.addr, yd.zip));
  var tm = 0;
  for (var i = 0; i < pts.length - 1; i++) tm += dMi(pts[i], pts[i + 1]);
  return tm / 45 + Math.max(1, 0.5 * stops.length + 1);
}

// jobMiles: total driving miles for a job
function jobMiles(j) {
  var yd = YARDS.find(function(y) { return y.id === j.yardId; }) || YARDS[0];
  var stops = j.stops || [];
  if (stops.length === 0) {
    var jt = jCalc(yd.addr, yd.zip, j.pickupAddr, j.pickupZip, j.dropAddr, j.dropZip);
    return jt.m1 + jt.m2 + jt.m3;
  }
  var pts = [crd(yd.addr, yd.zip), crd(j.pickupAddr, j.pickupZip)];
  stops.forEach(function(s) { pts.push(crd(s.addr, s.zip)); });
  pts.push(crd(j.dropAddr, j.dropZip), crd(yd.addr, yd.zip));
  var tm = 0;
  for (var i = 0; i < pts.length - 1; i++) tm += dMi(pts[i], pts[i + 1]);
  return tm;
}
