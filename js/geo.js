/* ═══════════════════════════════════════════════
   NETC Transport Planner — Geographic Data & Utilities

   - ZIP3: 3-digit ZIP prefix → lat/lon/label
   - CITY_ZIP: common city names → ZIP prefix
   - geoCache: full-address geocoding cache (also stored in localStorage)
   - geocode / batchGeo: Nominatim lookup for exact addresses
   - lz / cityLookup / crd: coordinate resolution helpers
   - hav / dMi: haversine distance math
   - closestYard: picks the nearest yard for a given pickup location
   ═══════════════════════════════════════════════ */

// ── 3-Digit ZIP → Approx Coordinates ───────────
// Covers New England. Key = first 3 digits of ZIP.
var ZIP3 = {
  "010":[42.10,-72.59,"Springfield MA"],"011":[42.10,-72.59,"Springfield MA"],
  "012":[42.45,-73.25,"Pittsfield MA"],"013":[42.58,-72.60,"Northampton MA"],
  "014":[42.47,-71.80,"Fitchburg MA"],"015":[42.27,-71.80,"Worcester MA"],
  "016":[42.20,-71.85,"Worcester MA"],"017":[42.30,-71.42,"Framingham MA"],
  "018":[42.50,-71.15,"Lowell MA"],"019":[42.47,-70.95,"Lynn MA"],
  "020":[42.08,-71.02,"Brockton MA"],"021":[42.36,-71.06,"Boston MA"],
  "022":[42.34,-71.05,"Boston MA"],"023":[42.08,-70.95,"South Shore MA"],
  "024":[42.45,-71.23,"Lexington MA"],"025":[41.74,-70.62,"Buzzards Bay MA"],
  "026":[41.65,-70.30,"Cape Cod MA"],"027":[41.64,-70.93,"New Bedford MA"],
  "028":[41.82,-71.41,"Providence RI"],"029":[41.75,-71.45,"S Providence RI"],
  "030":[42.99,-71.46,"Manchester NH"],"031":[43.00,-71.46,"Manchester NH"],
  "032":[43.21,-71.54,"Concord NH"],"033":[43.30,-71.67,"N Concord NH"],
  "034":[42.93,-72.28,"Keene NH"],"035":[44.30,-71.77,"Littleton NH"],
  "036":[43.37,-72.12,"Charlestown NH"],"037":[43.63,-72.25,"Lebanon NH"],
  "038":[43.07,-70.76,"Portsmouth NH"],"039":[43.20,-70.65,"Kittery ME"],
  "040":[43.66,-70.26,"Portland ME"],"041":[43.70,-70.30,"Portland ME"],
  "042":[44.10,-70.22,"Lewiston ME"],"043":[44.31,-69.78,"Augusta ME"],
  "044":[44.80,-68.77,"Bangor ME"],"045":[43.91,-69.82,"Bath ME"],
  "046":[44.54,-68.42,"Ellsworth ME"],"047":[46.13,-67.84,"Houlton ME"],
  "048":[44.10,-69.11,"Rockland ME"],"049":[44.55,-69.63,"Waterville ME"],
  "050":[43.65,-72.32,"White River Jct VT"],"051":[43.13,-72.44,"Bellows Falls VT"],
  "052":[42.88,-73.20,"Bennington VT"],"053":[42.85,-72.56,"Brattleboro VT"],
  "054":[44.48,-73.21,"Burlington VT"],"055":[42.66,-71.14,"Andover MA"],
  "056":[44.50,-73.15,"Burlington VT"],"057":[43.61,-72.97,"Rutland VT"],
  "058":[44.42,-72.02,"St Johnsbury VT"],"059":[44.81,-73.08,"St Albans VT"],
  "060":[41.76,-72.68,"Hartford CT"],"061":[41.77,-72.68,"Hartford CT"],
  "062":[41.71,-72.21,"Willimantic CT"],"063":[41.36,-72.10,"New London CT"],
  "064":[41.54,-72.81,"Meriden CT"],"065":[41.31,-72.92,"New Haven CT"],
  "066":[41.18,-73.19,"Bridgeport CT"],"067":[41.56,-73.04,"Waterbury CT"],
  "068":[41.05,-73.54,"Stamford CT"],"069":[41.40,-73.45,"Danbury CT"],
};

// ── City Name → ZIP Prefix ──────────────────────
// Fallback when no ZIP is available. Covers common New England cities.
var CITY_ZIP = {
  "andover":"018","assonet":"027","auburn":"030","auburn me":"042","augusta":"043",
  "baileyville":"046","bangor":"044","bar harbor":"046","bartlett":"038","bath":"045",
  "bedford":"030","belmont":"032","bennington":"052","berwick":"039","beverly":"019",
  "biddeford":"040","boston":"021","bow":"032","bradford":"032","brattleboro":"053",
  "brentwood":"038","brewer":"044","bridgeport":"066","brockton":"023","brunswick":"040",
  "burlington":"054","cambridge":"021","camden":"048","canterbury":"032","caribou":"047",
  "charlestown":"036","chelmsford":"018","chelsea":"021","chichester":"032","chicopee":"010",
  "claremont":"036","concord":"032","conway":"038","cranston":"028","derry":"030",
  "dover":"038","dracut":"018","durham":"038","east boston":"021","ellsworth":"046",
  "enfield":"037","epping":"038","epsom":"032","exeter":"038","exeter ri":"028",
  "fall river":"027","fitchburg":"014","framingham":"017","franconia":"035","freeport":"040",
  "gardiner":"043","gilford":"032","goffstown":"030","groveland":"018","hampstead":"038",
  "hampton":"038","hanover":"037","hartford":"061","hartford vt":"050","haverhill":"018",
  "henniker":"032","holyoke":"010","hooksett":"032","hopkinton":"032","hopkinton ma":"017",
  "houlton":"047","hudson":"030","jackson":"038","jaffrey":"034","keene":"034",
  "kennebunk":"040","kingston":"038","kittery":"039","laconia":"032","lawrence":"018",
  "lebanon":"037","leominster":"014","lewiston":"042","lincoln":"035","littleton":"035",
  "londonderry":"030","loudon":"032","lowell":"018","lynn":"019","malden":"021",
  "manchester":"030","marblehead":"019","marlborough":"017","medford":"021","meredith":"032",
  "merrimack":"030","methuen":"018","milford":"017","montpelier":"056","nashua":"030",
  "natick":"017","new bedford":"027","new haven":"065","newmarket":"038","newport":"036",
  "north andover":"018","north conway":"038","northwood":"032","norwich":"050",
  "old orchard beach":"040","orono":"044","peabody":"019","pembroke":"032",
  "peterborough":"034","plaistow":"038","portland":"041","portsmouth":"038",
  "presque isle":"047","providence":"028","quincy":"021","revere":"021","rochester":"038",
  "rockland":"048","rutland":"057","saco":"040","salem":"019","salisbury":"032",
  "sanford":"040","scarborough":"040","seabrook":"038","somersworth":"038","somerville":"021",
  "south portland":"041","springfield":"011","st albans":"059","st johnsbury":"058",
  "stamford":"068","swanzey":"034","taunton":"027","tewksbury":"018","tilton":"032",
  "topsham":"040","warner":"032","warwick":"028","waterville":"049","wellesley":"017",
  "wells":"040","west greenwich":"028","westbrook":"041","westfield":"010","weymouth":"021",
  "white river junction":"050","windham":"030","woodstock":"035","worcester":"016",
  "york":"039","knox":"048","etna":"037","west springfield":"010","agawam":"010","sturbridge":"015",
};

// ── Geocoding Cache ─────────────────────────────
// Keyed by full address string. Pre-seeded with yard addresses to avoid API calls.
// Populated from Supabase at startup (see App useEffect) so lookups are shared
// across all users — each address is only fetched from Nominatim once.
var geoCache = {};
geoCache["156 Epping Rd, Exeter NH"]        = { lat: 42.9814, lon: -70.9319, name: "Exeter, NH" };
geoCache["107 Sheep Davis Rd, Pembroke NH"] = { lat: 43.1473, lon: -71.4579, name: "Pembroke, NH" };
geoCache["26 Thibeault Dr, Bow NH"]         = { lat: 43.1379, lon: -71.4792, name: "Bow, NH" };
geoCache["305 Bradley St, Saco ME"]         = { lat: 43.5084, lon: -70.4618, name: "Saco, ME" };

// ── Nominatim Geocoding ─────────────────────────
// Resolves a full address string to { lat, lon, name }.
// Results are saved to Supabase (shared across users) via db.saveGeocode().
// db is defined in db.js which loads after geo.js, but geocode() is only
// ever called at runtime (not parse-time), so db will always be defined.
async function geocode(addr) {
  if (!addr || geoCache[addr]) return geoCache[addr] || null;

  // Extract ZIP and state abbreviation from the address string for result verification.
  // Nominatim does fuzzy matching and can return wrong-state results for ambiguous addresses.
  // ZIP gives the tightest constraint (3-digit prefix = ~county level).
  // State is the fallback verifier when no ZIP is present.
  var zipM    = addr.match(/\b[A-Za-z]{2}\s*(\d{5})\b/);
  var zip     = zipM ? zipM[1] : ((addr.match(/\b(\d{5})\b/) || [])[1] || null);
  var stateM  = addr.match(/\b([A-Za-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/);
  var addrSt  = stateM ? stateM[1].toUpperCase() : null;

  try {
    var r = await fetch(
      "https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(addr) +
      "&format=json&limit=1&countrycodes=us&addressdetails=1",
      { headers: { "User-Agent": "NETC-Planner" } }
    );
    var d = await r.json();
    var res = null;

    if (d && d[0]) {
      var ad         = d[0].address || {};
      var returnedSt = ((ad["ISO3166-2-lvl4"] || "").split("-")[1] || "").toUpperCase();
      var regionOk   = true;

      if (zip) {
        // ZIP prefix check — most precise. "030" vs "040" = NH vs ME.
        var returnedZip = (ad.postcode || "").replace(/\D/g, "");
        if (returnedZip && returnedZip.substring(0, 3) !== zip.substring(0, 3)) regionOk = false;
      } else if (addrSt && returnedSt) {
        // No ZIP — at minimum verify the state matches.
        if (returnedSt !== addrSt) regionOk = false;
      }

      if (regionOk) {
        var city   = ad.city || ad.town || ad.village || ad.hamlet || ad.suburb || ad.county || "";
        var stCode = returnedSt || (ad.state || "").substring(0, 2).toUpperCase();
        var nm     = city && stCode ? city + ", " + stCode : d[0].display_name.split(",")[0].trim();
        res = { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon), name: nm };
      }
    }

    // Fallback chain when Nominatim returned nothing or the wrong region:
    //   1. ZIP3 table — correct region, ~5-10 mile precision (requires ZIP)
    //   2. cityLookup — parses city name from address, uses CITY_ZIP table (no ZIP needed)
    if (!res && zip) {
      var z = lz(zip);
      if (z) res = { lat: z.lat, lon: z.lon, name: z.label };
    }
    if (!res) {
      var cl = cityLookup(addr);
      if (cl) res = { lat: cl.lat, lon: cl.lon, name: cityFrom(addr) || addr };
    }

    if (res) {
      geoCache[addr] = res;
      db.saveGeocode(addr, res); // fire-and-forget — persist for all users
      return res;
    }
  } catch(e) {}
  return null;
}

// Geocodes a list of addresses with ~1.1s delay between requests (Nominatim rate limit).
async function batchGeo(addrs, onP) {
  var u = [...new Set(addrs.filter(Boolean))].filter(function(a) { return !geoCache[a]; });
  var d = 0;
  for (var a of u) {
    await geocode(a);
    d++;
    if (onP) onP(d, u.length);
    if (d < u.length) await new Promise(function(r) { setTimeout(r, 1100); });
  }
}

// ── Coordinate Resolution ───────────────────────
// lz: resolve a 5-digit ZIP to approx lat/lon using ZIP3 table
function lz(z) {
  var s = (z || "").replace(/\D/g, "");
  if (s.length < 3) return null;
  var d = ZIP3[s.substring(0, 3)];
  return d ? { lat: d[0], lon: d[1], label: d[2] } : null;
}

// cityLookup: extract city + state from an address string and look up via CITY_ZIP
function cityLookup(addr) {
  if (!addr) return null;
  var a = addr.toLowerCase().replace(/[^a-z\s,]/g, '').trim();
  var m = a.match(/([a-z\s]+),?\s*(ma|me|nh|vt|ri|ct)\b/);
  if (!m) return null;
  var words = m[1].trim().split(/\s+/);
  var st = m[2];
  for (var n = 1; n <= Math.min(3, words.length); n++) {
    var city = words.slice(-n).join(' ');
    if (CITY_ZIP[city]) return lz(CITY_ZIP[city] + "00");
    if (CITY_ZIP[city + ' ' + st]) return lz(CITY_ZIP[city + ' ' + st] + "00");
  }
  return null;
}

// crd: get coordinates for a job stop. Prefers geoCache (exact), then ZIP3, then city name.
// Used as a fallback when a job has no stored lat/lon (e.g. historical rows or
// manually-added jobs before the Nominatim-backed sync landed).
function crd(addr, zip) {
  if (addr && geoCache[addr]) return geoCache[addr];
  var z = lz(zip);
  if (z) return { lat: z.lat, lon: z.lon, name: z.label };
  var cl = cityLookup(addr);
  if (cl) return cl;
  return null;
}

// jobCrd: get coordinates for a specific job stop ('pickup' or 'drop').
// Prefers the lat/lon stored on the job row (populated by sync_calls.py via
// Nominatim) — street-accurate — and falls back to the coarse crd() lookup.
function jobCrd(j, which) {
  var lat = which === 'pickup' ? j.pickupLat : j.dropLat;
  var lon = which === 'pickup' ? j.pickupLon : j.dropLon;
  if (lat != null && lon != null) return { lat: lat, lon: lon, name: '' };
  var addr = which === 'pickup' ? j.pickupAddr : j.dropAddr;
  var zip  = which === 'pickup' ? j.pickupZip  : j.dropZip;
  return crd(addr, zip);
}

// ── Distance Math ───────────────────────────────
// hav: haversine great-circle distance in miles between two lat/lon points
function hav(a, b, c, d) {
  var R = 3958.8;
  var x = (c - a) * Math.PI / 180;
  var y = (d - b) * Math.PI / 180;
  var s = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// dMi: road-adjusted distance in miles (1.25× straight-line) between two coordinate objects
function dMi(c1, c2) {
  if (!c1 || !c2) return 0;
  return hav(c1.lat, c1.lon, c2.lat, c2.lon) * 1.25;
}

// ── Yard Helpers ────────────────────────────────
function yCrd(y) { return crd(y.addr, y.zip); }

// closestYard: given a pickup address + ZIP, returns the nearest yard from YARDS
function closestYard(pa, pz) {
  var pc = crd(pa, pz);
  if (!pc) {
    var addr = (pa || "").toUpperCase();
    if (addr.indexOf(", ME") > -1 || addr.indexOf(" ME ") > -1 || addr.indexOf(" MAINE") > -1)
      return YARDS.find(function(y) { return y.id === "rays"; });
    if (addr.indexOf("BOW") > -1 || addr.indexOf("CONCORD") > -1)
      return YARDS.find(function(y) { return y.id === "mattbrowns"; });
    return YARDS[0];
  }
  var b = YARDS[0], bd = Infinity;
  YARDS.forEach(function(y) {
    var yc = yCrd(y);
    if (yc) {
      var d = hav(pc.lat, pc.lon, yc.lat, yc.lon);
      if (d < bd) { bd = d; b = y; }
    }
  });
  return b;
}
