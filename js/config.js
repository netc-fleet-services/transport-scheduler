/* ═══════════════════════════════════════════════
   NETC Transport Planner — App Configuration
   Yards, default drivers, color palette, shared
   inline style objects used throughout the UI.
   ═══════════════════════════════════════════════ */

// ── TowBook Bookmarklet ─────────────────────────
// Run on the TowBook dispatch page to copy jobs to clipboard.
// Drag the button in Settings → TowBook Import to your bookmarks bar.
window.NETC_BM = 'javascript:(function(){var rows=document.querySelectorAll(\'li.entryRow\');var jobs=[];rows.forEach(function(r){var lis=r.querySelectorAll(\'ul.details1>li\');var pickup=\'\',drop=\'\',desc=\'\',sched=\'\',reason=\'\',driver=\'\',truck=\'\';for(var i=0;i<lis.length;i++){var t=lis[i].textContent.replace(/\\s+/g,\' \').trim();if(t.indexOf(\'Tow Source\')===0)pickup=t.substring(10).trim();else if(t.indexOf(\'Reason\')===0)reason=t.substring(6).trim();else if(t.indexOf(\'Driver\')===0)driver=t.substring(6).trim();else if(t.indexOf(\'Truck\')===0)truck=t.substring(5).trim();else if(t.indexOf(\'Destination\')===0)drop=t.substring(11).trim();}var wide=r.querySelector(\'.col-wide\');if(wide){var a=wide.querySelector(\'a\');if(a)desc=a.textContent.trim();}var eta=r.querySelector(\'.scheduled-eta-container\');if(eta){var sp=eta.closest(\'span[title]\');if(sp){var title=sp.getAttribute(\'title\');var paren=title.indexOf(\'(\');sched=paren>-1?title.substring(0,paren).trim():title.trim();}}var pm=pickup.match(/\\d{5}/);var pz=pm?pm[0]:\'\';var dm=drop.match(/\\d{5}/);var dz=dm?dm[0]:\'\';var cn=r.getAttribute(\'data-call-number\')||\'\';if(pickup||drop)jobs.push({callNum:cn,desc:desc,pickup:pickup,drop:drop,pickupZip:pz,dropZip:dz,scheduled:sched,reason:reason,driver:driver,truck:truck});});var json=JSON.stringify(jobs);var ta=document.createElement(\'textarea\');ta.value=json;ta.style.position=\'fixed\';ta.style.left=\'-9999px\';document.body.appendChild(ta);ta.select();document.execCommand(\'copy\');document.body.removeChild(ta);var rt={};jobs.forEach(function(j){if(j.reason)rt[j.reason]=(rt[j.reason]||0)+1;});alert(\'Copied \'+jobs.length+\' jobs\\n\\nTypes: \'+Object.keys(rt).sort().map(function(k){return k+\': \'+rt[k]}).join(\', \')+\'\\n\\nOpen Planner > Import\');})()';
window.NETC_CC = "var r=document.querySelectorAll('li.entryRow'),j=[];r.forEach(function(r){var l=r.querySelectorAll('ul.details1>li'),p='',d='',desc='',s='',reason='',driver='',truck='';for(var i=0;i<l.length;i++){var t=l[i].textContent.replace(/\\s+/g,' ').trim();if(t.indexOf('Tow Source')===0)p=t.substring(10).trim();else if(t.indexOf('Reason')===0)reason=t.substring(6).trim();else if(t.indexOf('Driver')===0)driver=t.substring(6).trim();else if(t.indexOf('Truck')===0)truck=t.substring(5).trim();else if(t.indexOf('Destination')===0)d=t.substring(11).trim()}var w=r.querySelector('.col-wide');if(w){var a=w.querySelector('a');if(a)desc=a.textContent.trim()}var e=r.querySelector('.scheduled-eta-container');if(e){var sp=e.closest('span[title]');if(sp){var ti=sp.getAttribute('title');var pa=ti.indexOf('(');s=pa>-1?ti.substring(0,pa).trim():ti.trim()}}var pz=(p.match(/\\d{5}/)||[''])[0],dz=(d.match(/\\d{5}/)||[''])[0];if(p||d)j.push({callNum:r.getAttribute('data-call-number')||'',desc:desc,pickup:p,drop:d,pickupZip:pz,dropZip:dz,scheduled:s,reason:reason,driver:driver,truck:truck})});copy(JSON.stringify(j));var rt={};j.forEach(function(x){if(x.reason)rt[x.reason]=(rt[x.reason]||0)+1});alert('Copied '+j.length+' jobs\\n\\nTypes: '+Object.keys(rt).sort().map(function(k){return k+': '+rt[k]}).join(', '))";

// ── Yard Locations ──────────────────────────────
// DEFAULT_YARDS is used to seed the database on first run and as a local
// fallback if the DB is unreachable. Yards are managed through the Settings
// tab at runtime — you don't need to edit this file to add/change yards.
var DEFAULT_YARDS = [
  { id: "exeter",     short: "Exeter",       addr: "156 Epping Rd, Exeter NH",        zip: "03833" },
  { id: "pembroke",   short: "Pembroke",     addr: "107 Sheep Davis Rd, Pembroke NH", zip: "03275" },
  { id: "mattbrowns", short: "Matt Brown's", addr: "26 Thibeault Dr, Bow NH",         zip: "03304" },
  { id: "rays",       short: "Ray's Saco",   addr: "305 Bradley St, Saco ME",         zip: "04072" },
];

// YARDS is the live global used by geo.js and utils.js.
// It starts empty and is populated from Supabase at startup (see App useEffect).
// Updating this array in-place keeps geo/utils functions in sync without
// requiring them to accept yards as a parameter.
var YARDS = [];

// ── Default Driver Roster ───────────────────────
// Loaded on first run (before any drivers are saved to localStorage).
var defaultDrivers = [
  { id: 1, name: "Robert Welch",      truck: "3223", yard: "exeter" },
  { id: 2, name: "Trevor Tardif",     truck: "49",   yard: "exeter" },
  { id: 3, name: "Greg Rutherford",   truck: "2425", yard: "exeter" },
  { id: 4, name: "Matt Cashin",       truck: "5222", yard: "exeter" },
  { id: 5, name: "Kevin Curtis",      truck: "721",  yard: "pembroke" },
  { id: 6, name: "Robert Deleon",     truck: "2125", yard: "mattbrowns" },
  { id: 7, name: "Andrew Broughton",  truck: "2822", yard: "mattbrowns" },
  { id: 8, name: "Jonathan Wright",   truck: "52",   yard: "mattbrowns" },
];

// ── Color Palette ───────────────────────────────
// Single source of truth for all UI colors. Referenced throughout app.js.
var C = {
  bg:  "#0c0e14",  // page background
  sf:  "#151820",  // surface / input background
  cd:  "#1a1d27",  // card background
  ca:  "#1e2230",  // active card background
  bd:  "#252a36",  // border
  tx:  "#e4e4e7",  // primary text
  dm:  "#71717a",  // dimmed / muted text
  ac:  "#3b82f6",  // accent blue
  ad:  "#1d3461",  // accent blue dark
  gn:  "#22c55e",  // green (success / complete)
  gb:  "#132e1b",  // green background
  am:  "#f59e0b",  // amber (warning / active)
  ab:  "#2d2006",  // amber background
  rd:  "#ef4444",  // red (urgent / error)
  inp: "#10131b",  // input field background
  wh:  "#fff",     // white
  pu:  "#a78bfa",  // purple (TowBook data)
  pd:  "#2e1065",  // purple dark background
};

// ── Priority Colors ─────────────────────────────
var PRI_COLORS = { urgent: "#ef4444", normal: "#f59e0b", flexible: "#22c55e" };

// ── Shared Inline Style Objects ─────────────────
// Reused across many components to keep JSX concise.
var iS = { background: C.inp, border: "1px solid " + C.bd, borderRadius: 6, padding: "6px 8px", color: C.tx, fontSize: 12, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" };
var sS = { ...iS, cursor: "pointer", appearance: "none", paddingRight: 22 };
var bP = { background: C.ac, color: C.wh, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
var bSt = { background: "transparent", color: C.dm, border: "1px solid " + C.bd, borderRadius: 5, padding: "3px 7px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" };
var cB = { background: C.cd, border: "1px solid " + C.bd, borderRadius: 8, padding: 11, marginBottom: 6 };

// ── ID Generator ────────────────────────────────
var _id = Date.now();
var uid = function() { return _id++; };
