"""
TowBook → Supabase Calls Sync
Runs every 15 minutes via GitHub Actions.

Sync logic:
  - New call (in TowBook, not in DB)       → INSERT
  - Existing call (in both)                → UPDATE address/schedule fields, preserve yard/driver assignments
  - Jobs are NEVER deleted — kept for historical reporting in the History tab.

Scrapes three tabs in precedence order: Scheduled → Current → Active.
If the same call number appears in multiple tabs, the higher-precedence tab wins.
Active has final authority since it reflects the most current in-progress state.
"""

import os, re, uuid, time, json
import urllib.request, urllib.parse
from datetime import date, datetime, timezone
from playwright.sync_api import sync_playwright
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────────

TOWBOOK_USER     = os.environ["TOWBOOK_USER"]
TOWBOOK_PASS     = os.environ["TOWBOOK_PASS"]
SUPABASE_URL     = os.environ["SUPABASE_URL"]
SUPABASE_KEY     = os.environ["SUPABASE_SERVICE_KEY"]   # service role key — bypasses RLS
GEOCODIO_KEY     = os.environ.get("GEOCODIO_KEY", "")   # optional — improves address quality

# TowBook dispatch page. All call categories are shown on the same URL;
# the tab filter is applied via JavaScript without a URL change.
DISPATCH_URL = "https://app.towbook.com/DS4"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Address helpers (mirrors the bookmarklet xz / xc / xa functions) ──────────

def extract_zip(addr):
    """Extract 5-digit ZIP. Prefers state+ZIP pattern; falls back to last standalone 5-digit number."""
    if not addr:
        return ''
    m = re.search(r'\b[A-Za-z]{2}\s*(\d{5})\b', addr)
    if m:
        return m.group(1)
    matches = re.findall(r'\b(\d{5})\b', addr)
    return matches[-1] if matches else ''


def clean_addr(s):
    """Strip trailing (Business Name) and ', USA' that TowBook appends to addresses."""
    if not s:
        return ''
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = re.sub(r',?\s*USA\s*$', '', s, flags=re.IGNORECASE)
    return s.strip()


_ROAD_PREFIX = re.compile(
    r'^(I[-\s]\d|RT\.?\s*\d|RTE\.?\s*\d|ROUTE\s+\d|HWY\s+\d|SR\s*\d|'
    r'US\s*\d|NH\s*\d|ME\s*\d|VT\s*\d|MA\s*\d|RI\s*\d|CT\s*\d)',
    re.IGNORECASE,
)

def strip_biz_name(s):
    """Strip a leading business name by finding where the street number starts.
    Never strips highway/route prefixes like 'Rt 101', 'I-95', 'Route 3A'."""
    if not s or s[0].isdigit():
        return s
    if _ROAD_PREFIX.match(s):
        return s                        # already a road reference — leave it alone
    m = re.search(r'\d+\s+[A-Za-z]', s)
    return s[m.start():] if m else s


def parse_addr(raw):
    return strip_biz_name(clean_addr(raw or ''))


def split_drivers(raw):
    """Split a TowBook driver string that may contain multiple names.

    Tries unambiguous delimiters first (comma, semicolon, tab), then falls
    back to 2+ consecutive spaces as a last resort.  Returns a list of 1 or
    2 non-empty stripped name strings — never more than 2.

    Space-only separation ("John Smith Jane Doe") is intentionally not
    attempted because driver names contain spaces and we cannot reliably
    split them without matching against the roster.  Two or more consecutive
    spaces are treated as a separator since they almost never appear inside
    a single name.
    """
    if not raw or not raw.strip():
        return []
    raw = raw.strip()

    # Comma, semicolon, or tab — unambiguous
    for pattern in (r'\s*[,;]\s*', r'\t+'):
        parts = [p.strip() for p in re.split(pattern, raw) if p.strip()]
        if len(parts) > 1:
            return parts[:2]

    # Two or more consecutive spaces
    parts = [p.strip() for p in re.split(r' {2,}', raw) if p.strip()]
    if len(parts) > 1:
        return parts[:2]

    return [raw]


def sched_to_day(sched):
    """'4/8/26 7:00 AM' → '2026-04-08'. Falls back to today on parse failure."""
    for fmt in ['%m/%d/%y %I:%M %p', '%m/%d/%Y %I:%M %p', '%m/%d/%y', '%m/%d/%Y']:
        try:
            return datetime.strptime(sched.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return date.today().isoformat()

# ── Address Standardization (geocod.io) ───────────────────────────────────────
# Called before Nominatim for proper street addresses. Returns a USPS-standardized
# address string + rooftop-accurate lat/lon, or (None, None, None) so the caller
# falls through to Nominatim unchanged.
#
# Safety gates — all must pass before the standardized result is accepted:
#   1. Address starts with a street number (skips highway/road references)
#   2. geocod.io confidence ≥ 0.8 and type is rooftop/interpolated/point
#   3. Street number in response matches street number in original input
#   4. ZIP3 prefix matches (same county-level region — blocks cross-state misfires)

def standardize_addr(raw):
    if not GEOCODIO_KEY or not raw:
        return None, None, None

    # Skip highway/road references — geocod.io won't have mile markers
    if _ROAD_PREFIX.match(raw.strip()):
        return None, None, None

    # Must start with a street number to be worth standardizing
    if not re.match(r'^\d+\s', raw.strip()):
        return None, None, None

    try:
        url = "https://api.geocod.io/v1.7/geocode?" + urllib.parse.urlencode({
            "q": raw, "api_key": GEOCODIO_KEY, "limit": 1,
        })
        req = urllib.request.Request(url, headers={
            "User-Agent": "transport-scheduler-sync/1.0 (ops@netruckcenter.com)",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        results = data.get("results") or []
        if not results:
            return None, None, None

        r        = results[0]
        acc      = r.get("accuracy", 0)
        acc_type = r.get("accuracy_type", "")
        comp     = r.get("address_components", {})
        loc      = r.get("location", {})

        # Require rooftop or street-level accuracy
        if acc < 0.8 or acc_type not in ("rooftop", "range_interpolation", "point"):
            return None, None, None

        # Street number must match — prevents 123 Main → 321 Main substitution
        orig_num = (re.match(r'^(\d+)', raw.strip()) or [None, ''])[1]
        std_num  = str(comp.get("number", ""))
        if orig_num and std_num and orig_num != std_num:
            print(f"  geocodio: number mismatch {orig_num!r}→{std_num!r}, skipping for {raw!r}")
            return None, None, None

        # ZIP3 region check — blocks cross-state wrong matches
        orig_zip = extract_zip(raw)
        std_zip  = str(comp.get("zip", ""))
        if orig_zip and std_zip and orig_zip[:3] != std_zip[:3]:
            print(f"  geocodio: ZIP region mismatch {orig_zip}→{std_zip}, skipping for {raw!r}")
            return None, None, None

        lat = loc.get("lat")
        lon = loc.get("lng")
        if lat is None or lon is None:
            return None, None, None

        # Build clean standardized address string
        parts = [comp.get("number", ""),
                 comp.get("predirectional", ""),
                 comp.get("street", ""),
                 comp.get("suffix", ""),
                 comp.get("postdirectional", "")]
        street_line = " ".join(p for p in parts if p)
        city  = comp.get("city", "")
        state = comp.get("state", "")
        zipcode = comp.get("zip", "")
        std_addr = f"{street_line}, {city} {state} {zipcode}".strip().rstrip(",")

        print(f"  geocodio: {raw!r} → {std_addr!r} ({lat:.5f}, {lon:.5f})")
        return std_addr, float(lat), float(lon)

    except Exception as e:
        print(f"  geocodio fail for {raw!r}: {e}")
        return None, None, None


# ── Geocoding (Nominatim / OpenStreetMap) ──────────────────────────────────────
# Free, 1 req/sec limit per their TOS. Requires a descriptive User-Agent.
# Results are cached in-process so each distinct address is fetched at most once
# per run, and in Supabase forever (the lat/lon columns on jobs).

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_geo_cache_mem = {}
_geo_last_req  = [0.0]

def geocode(addr):
    """Return (lat, lon) for an address, or (None, None) on failure. Rate-limited."""
    if not addr:
        return None, None
    if addr in _geo_cache_mem:
        return _geo_cache_mem[addr]

    # Enforce ≥1.1s between requests (Nominatim TOS: 1/sec)
    elapsed = time.time() - _geo_last_req[0]
    if elapsed < 1.1:
        time.sleep(1.1 - elapsed)

    try:
        url = NOMINATIM_URL + "?" + urllib.parse.urlencode({
            "q": addr, "format": "json", "limit": "1",
            "countrycodes": "us",
        })
        req = urllib.request.Request(url, headers={
            "User-Agent": "transport-scheduler-sync/1.0 (ops@netruckcenter.com)",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        _geo_last_req[0] = time.time()
        if data:
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            _geo_cache_mem[addr] = (lat, lon)
            return lat, lon
    except Exception as e:
        print(f"  geocode fail for {addr!r}: {e}")

    _geo_cache_mem[addr] = (None, None)
    return None, None

# ── TowBook scraping ───────────────────────────────────────────────────────────

# Tabs to scrape, in ascending precedence order — later tabs overwrite earlier
# ones when the same call number appears in multiple tabs.
TABS = [
    ("Scheduled",  "#atScheduled"),
    ("Current",    "#atCurrent"),
    ("Active",     "#atActive"),
    ("Completed",  "#atCompleted"),  # highest precedence — overwrites active if job is done
]

def scrape_tab(page, tab_id, tab_name):
    """Click a dispatch tab and extract all visible call rows. Returns a list of call dicts."""
    calls = []

    page.locator(tab_id).click()
    try:
        page.wait_for_selector(f"li.selected {tab_id}", timeout=10_000)
    except Exception:
        print(f"  Warning: {tab_name} tab did not become selected — scraping whatever is visible.")

    page.wait_for_timeout(1_500)

    # Completed tab lazy-loads rows as you scroll. Scroll the entry list
    # container repeatedly until no new rows appear (max 10 passes).
    if tab_name == "Completed":
        for _ in range(10):
            prev = page.locator("li.entryRow").count()
            page.evaluate("""
                const el = document.querySelector('.entryListContainer, .dispatch-list, #entryList, .entryList')
                        || document.querySelector('[class*="entryList"], [id*="entryList"]')
                        || document.body;
                el.scrollTop = el.scrollHeight;
                window.scrollTo(0, document.body.scrollHeight);
            """)
            page.wait_for_timeout(800)
            curr = page.locator("li.entryRow").count()
            if curr == prev:
                break
        print(f"  Scrolled Completed tab — {page.locator('li.entryRow').count()} total rows loaded")

    all_rows = page.locator("li.entryRow").all()
    rows = [r for r in all_rows if r.is_visible()]
    print(f"  Found {len(rows)} rows in {tab_name} tab")

    for row in rows:
        call_num = row.get_attribute("data-call-number") or ''
        if not call_num:
            continue

        # Vehicle description from .big-text header
        desc = ''
        desc_el = row.locator(".big-text")
        if desc_el.count():
            desc = (desc_el.first.get_attribute("title") or
                    desc_el.first.text_content() or '').strip()

        # Scheduled time — walk up from .scheduled-eta-container to its span[title]
        sched = ''
        eta_el = row.locator(".scheduled-eta-container")
        if eta_el.count():
            raw = eta_el.first.evaluate(
                "el => { const sp = el.closest('span[title]'); return sp ? sp.getAttribute('title') : ''; }"
            )
            if raw:
                paren = raw.find('(')
                sched = raw[:paren].strip() if paren > -1 else raw.strip()

        # Field values from div.title / div.text pairs inside ul.details1
        pickup = drop = reason = driver = truck = account = ''
        for li in row.locator("ul.details1 > li").all():
            title_el = li.locator(".title")
            text_el  = li.locator(".text")
            if not title_el.count() or not text_el.count():
                continue
            lbl = (title_el.first.text_content() or '').strip()
            val = (text_el.first.get_attribute("title") or
                   text_el.first.text_content() or '').strip()
            val = re.sub(r'\s+', ' ', val).strip()

            if   lbl == 'Tow Source':    pickup  = val
            elif lbl == 'Reason':        reason  = val
            elif lbl == 'Driver':        driver  = val
            elif lbl == 'Truck':         truck   = val
            elif lbl == 'Destination':   drop    = val
            elif lbl == 'Account':       account = val

        # Equipment lives in a standalone .text[columnid='6'] (not inside ul.details1).
        if not truck:
            eq_el = row.locator(".text[columnid='6']")
            if eq_el.count():
                truck = (eq_el.first.get_attribute("title") or
                         eq_el.first.text_content() or '').strip()
                truck = re.sub(r'\s+', ' ', truck).strip()

        pickup = parse_addr(pickup)
        drop   = parse_addr(drop)
        day    = sched_to_day(sched) if sched else date.today().isoformat()

        driver_parts = split_drivers(driver)
        driver1 = driver_parts[0] if len(driver_parts) > 0 else ''
        driver2 = driver_parts[1] if len(driver_parts) > 1 else ''
        if len(driver_parts) > 1:
            print(f"  Split drivers for {call_num}: {driver_parts}")

        if pickup or drop:
            calls.append({
                'call_num':   call_num,
                'desc':       desc,
                'account':    account,
                'pickup':     pickup,
                'drop':       drop,
                'pickup_zip': extract_zip(pickup),
                'drop_zip':   extract_zip(drop),
                'scheduled':  sched,
                'reason':     reason,
                'driver':     driver1,
                'driver2':    driver2,
                'truck':      truck,
                'day':        day,
                'source_tab': tab_name,
            })

    return calls


def scrape_calls():
    """Log into TowBook and scrape Scheduled, Current, and Active tabs.

    Tabs are scraped in ascending precedence order. When the same call number
    appears in multiple tabs, the later tab's data overwrites the earlier one,
    so Active always has the final say.
    """
    # Keyed by call_num — later tabs overwrite earlier ones for the same key.
    merged = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page    = browser.new_context().new_page()

        print("Logging into TowBook...")
        page.goto("https://app.towbook.com/Security/Login.aspx")
        # Wait for the login form to be present rather than networkidle —
        # TowBook keeps persistent connections open so networkidle never fires.
        page.wait_for_selector("#Username", timeout=20_000)
        page.evaluate(f'document.getElementById("Username").value = "{TOWBOOK_USER}"')
        page.evaluate(f'document.getElementById("Password").value = "{TOWBOOK_PASS}"')
        page.locator('button[name="bSignIn"]').click()
        # Wait for redirect away from the login page (any non-login URL)
        page.wait_for_url(lambda url: "Login" not in url, timeout=30_000)

        print(f"Navigating to {DISPATCH_URL}...")
        page.goto(DISPATCH_URL)
        # Wait for load then a short settle — TowBook JS populates the tab bar async
        page.wait_for_load_state("load", timeout=30_000)

        try:
            page.wait_for_selector("#atScheduled", timeout=15_000)
        except Exception:
            print("Tab bar not found — DISPATCH_URL may need updating.")
            browser.close()
            return []

        for tab_name, tab_id in TABS:
            try:
                tab_calls = scrape_tab(page, tab_id, tab_name)
                print(f"  {tab_name}: {len(tab_calls)} calls parsed (of visible rows above)")
                for call in tab_calls:
                    merged[call["call_num"]] = call
            except Exception as e:
                print(f"  Warning: failed to scrape {tab_name} tab — {e}")

        browser.close()

    calls = list(merged.values())
    print(f"Total unique calls after merge: {len(calls)}")
    return calls

# ── Supabase sync ──────────────────────────────────────────────────────────────

def sync_to_supabase(tb_calls):
    now = datetime.now(timezone.utc).isoformat()

    # Load ALL existing jobs (no status filter) to preserve all fields
    resp = sb.from_("jobs") \
             .select("id, tb_call_num, tb_desc, tb_account, pickup_addr, drop_addr, "
                     "pickup_zip, drop_zip, pickup_lat, pickup_lon, drop_lat, drop_lon, "
                     "tb_scheduled, tb_reason, tb_driver, tb_driver_2, truck_and_equipment, day, "
                     "yard_id, driver_id, driver_id_2, status, priority, notes, stops, added_at") \
             .execute()

    existing = {r["tb_call_num"]: r for r in (resp.data or []) if r.get("tb_call_num")}

    upserts = []

    for call in tb_calls:
        cn = call["call_num"]
        ex = existing.get(cn)

        def keep(new_val, field):
            """Use the scraped value if non-empty, otherwise keep what's already in Supabase."""
            return new_val if new_val else (ex.get(field) if ex else new_val)

        # Geocode pickup/drop.
        # Priority: reuse stored coords (address unchanged) → geocod.io → Nominatim.
        # geocod.io may also return a cleaner standardized address string; if it does
        # we update call["pickup"]/call["drop"] so the improved address is stored too.
        p_addr = call["pickup"]
        d_addr = call["drop"]

        if ex and ex.get("pickup_addr") == p_addr and ex.get("pickup_lat") is not None:
            p_lat, p_lon = ex.get("pickup_lat"), ex.get("pickup_lon")
        else:
            std_p, p_lat, p_lon = standardize_addr(p_addr)
            if std_p:
                call["pickup"]     = std_p
                call["pickup_zip"] = extract_zip(std_p)
            elif p_addr:
                p_lat, p_lon = geocode(p_addr)

        if ex and ex.get("drop_addr") == d_addr and ex.get("drop_lat") is not None:
            d_lat, d_lon = ex.get("drop_lat"), ex.get("drop_lon")
        else:
            std_d, d_lat, d_lon = standardize_addr(d_addr)
            if std_d:
                call["drop"]     = std_d
                call["drop_zip"] = extract_zip(std_d)
            elif d_addr:
                d_lat, d_lon = geocode(d_addr)

        row = {
            "tb_call_num":  cn,
            "tb_desc":      keep(call["desc"],      "tb_desc"),
            "tb_account":   keep(call["account"],   "tb_account"),
            "pickup_addr":  keep(call["pickup"],    "pickup_addr"),
            "drop_addr":    keep(call["drop"],      "drop_addr"),
            "pickup_zip":   keep(call["pickup_zip"],"pickup_zip"),
            "drop_zip":     keep(call["drop_zip"],  "drop_zip"),
            "pickup_lat":   p_lat,
            "pickup_lon":   p_lon,
            "drop_lat":     d_lat,
            "drop_lon":     d_lon,
            "tb_scheduled": keep(call["scheduled"], "tb_scheduled"),
            "tb_reason":    keep(call["reason"],    "tb_reason"),
            "tb_driver":    keep(call["driver"],    "tb_driver"),
            "tb_driver_2":  keep(call["driver2"],   "tb_driver_2"),
            "truck_and_equipment": keep(call["truck"], "truck_and_equipment"),
            "day":          keep(call["day"],       "day"),
            "updated_at":   now,
        }

        # Determine status from source tab. Completed has highest authority,
        # then Active, then existing DB status, then default to scheduled.
        src          = call.get("source_tab")
        is_complete  = src == "Completed"
        is_active    = src == "Active"

        # Skip completed calls that are already marked complete in the DB —
        # we only care about the active/scheduled → complete transition.
        if is_complete and ex and ex.get("status") == "complete":
            continue

        if ex:
            # Existing record — carry forward all dispatcher-managed fields
            row["id"]          = ex["id"]
            row["added_at"]    = ex["added_at"]
            row["yard_id"]     = ex["yard_id"]
            row["driver_id"]   = ex["driver_id"]
            row["driver_id_2"] = ex.get("driver_id_2")
            row["priority"]    = ex["priority"]
            row["notes"]       = ex.get("notes")
            row["stops"]       = ex.get("stops") or []
            if is_complete:
                row["status"] = "complete"
            elif is_active:
                row["status"] = "active"
            else:
                row["status"] = ex["status"]
        else:
            # New call — set defaults
            row["id"]       = str(uuid.uuid4())
            row["priority"] = "normal"
            row["stops"]    = []
            row["added_at"] = now
            row["status"]   = "complete" if is_complete else ("active" if is_active else "scheduled")

        upserts.append(row)

    if upserts:
        sb.from_("jobs").upsert(upserts, on_conflict="tb_call_num").execute()
        new_count = len([u for u in upserts if "added_at" in u])
        upd_count = len(upserts) - new_count
        print(f"  Inserted {new_count} new jobs, updated {upd_count} existing jobs")
    else:
        print("  No calls to sync.")

    # Record sync timestamp for the UI "Last synced X min ago" display
    sb.from_("settings").upsert(
        {"key": "last_synced", "value": datetime.now(timezone.utc).isoformat()},
        on_conflict="key"
    ).execute()

# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}Z] Starting TowBook → Supabase sync")

    tb_calls = scrape_calls()
    print(f"Scraped {len(tb_calls)} unique calls across all tabs")

    if not tb_calls:
        print("No calls to sync — exiting.")
        return

    sync_to_supabase(tb_calls)
    print("Sync complete.")


if __name__ == "__main__":
    main()
