"""
TowBook → Supabase Scheduled Calls Sync
Runs every 15 minutes via GitHub Actions.

Sync logic:
  - New call (in TowBook, not in DB)       → INSERT
  - Existing call (in both)                → UPDATE address/schedule fields, preserve yard/driver assignments
  - Jobs are NEVER deleted — kept for historical reporting in the History tab.

Calls that move from Scheduled → Active in TowBook drop off the scraped tab
but are intentionally kept in Supabase so dispatchers can still see in-progress
jobs for the current day, and so the History tab has a complete record.
"""

import os, re, uuid
from datetime import date, datetime, timezone
from playwright.sync_api import sync_playwright
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────────

TOWBOOK_USER     = os.environ["TOWBOOK_USER"]
TOWBOOK_PASS     = os.environ["TOWBOOK_PASS"]
SUPABASE_URL     = os.environ["SUPABASE_URL"]
SUPABASE_KEY     = os.environ["SUPABASE_SERVICE_KEY"]   # service role key — bypasses RLS

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


def sched_to_day(sched):
    """'4/8/26 7:00 AM' → '2026-04-08'. Falls back to today on parse failure."""
    for fmt in ['%m/%d/%y %I:%M %p', '%m/%d/%Y %I:%M %p', '%m/%d/%y', '%m/%d/%Y']:
        try:
            return datetime.strptime(sched.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return date.today().isoformat()

# ── TowBook scraping ───────────────────────────────────────────────────────────

def scrape_calls():
    """Log into TowBook, navigate to the dispatch page, and extract all visible scheduled calls."""
    calls = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page    = browser.new_context().new_page()

        # Login (same mechanism as sync_impounds.py)
        print("Logging into TowBook...")
        page.goto("https://app.towbook.com/Security/Login.aspx")
        page.wait_for_selector("#Username", timeout=30_000)
        page.evaluate(f'document.getElementById("Username").value = "{TOWBOOK_USER}"')
        page.evaluate(f'document.getElementById("Password").value = "{TOWBOOK_PASS}"')
        page.locator('button[name="bSignIn"]').click()
        page.wait_for_selector("ul.tab-list", timeout=45_000)

        # Navigate to dispatch/calls page
        print(f"Navigating to {DISPATCH_URL}...")
        page.goto(DISPATCH_URL)

        # Wait for the tab bar to be present, then click the Scheduled tab.
        # All call categories load on the same URL; clicking a tab filters the
        # visible rows via JavaScript without navigating away.
        try:
            page.wait_for_selector("#atScheduled", timeout=15_000)
        except Exception:
            print("Tab bar not found — DISPATCH_URL may need updating.")
            browser.close()
            return []

        # Click the Scheduled tab and wait for it to become the active selection.
        page.locator("#atScheduled").click()
        try:
            page.wait_for_selector("li.selected #atScheduled", timeout=10_000)
        except Exception:
            print("Warning: Scheduled tab did not become selected — scraping whatever is visible.")

        # Give the row list a moment to re-render after the tab switch.
        page.wait_for_timeout(1_500)

        # Collect only visible (non-hidden) entryRows — the tab filter hides
        # rows for other categories rather than removing them from the DOM.
        all_rows = page.locator("li.entryRow").all()
        rows = [r for r in all_rows if r.is_visible()]
        print(f"Found {len(rows)} scheduled calls")

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

            pickup = parse_addr(pickup)
            drop   = parse_addr(drop)
            day    = sched_to_day(sched) if sched else date.today().isoformat()

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
                    'driver':     driver,
                    'truck':      truck,
                    'day':        day,
                })

        browser.close()
    return calls

# ── Supabase sync ──────────────────────────────────────────────────────────────

def sync_to_supabase(tb_calls):
    now = datetime.now(timezone.utc).isoformat()

    # Load ALL existing jobs (no status filter) to preserve all fields
    resp = sb.from_("jobs") \
             .select("id, tb_call_num, tb_desc, tb_account, pickup_addr, drop_addr, "
                     "pickup_zip, drop_zip, tb_scheduled, tb_reason, tb_driver, day, "
                     "yard_id, driver_id, status, priority, notes, stops, added_at") \
             .execute()

    existing = {r["tb_call_num"]: r for r in (resp.data or []) if r.get("tb_call_num")}

    upserts = []

    for call in tb_calls:
        cn = call["call_num"]
        ex = existing.get(cn)

        def keep(new_val, field):
            """Use the scraped value if non-empty, otherwise keep what's already in Supabase."""
            return new_val if new_val else (ex.get(field) if ex else new_val)

        row = {
            "tb_call_num":  cn,
            "tb_desc":      keep(call["desc"],      "tb_desc"),
            "tb_account":   keep(call["account"],   "tb_account"),
            "pickup_addr":  keep(call["pickup"],    "pickup_addr"),
            "drop_addr":    keep(call["drop"],      "drop_addr"),
            "pickup_zip":   keep(call["pickup_zip"],"pickup_zip"),
            "drop_zip":     keep(call["drop_zip"],  "drop_zip"),
            "tb_scheduled": keep(call["scheduled"], "tb_scheduled"),
            "tb_reason":    keep(call["reason"],    "tb_reason"),
            "tb_driver":    keep(call["driver"],    "tb_driver"),
            "day":          keep(call["day"],       "day"),
            "updated_at":   now,
        }

        if ex:
            # Existing record — carry forward all dispatcher-managed fields
            row["id"]        = ex["id"]
            row["added_at"]  = ex["added_at"]
            row["yard_id"]   = ex["yard_id"]
            row["driver_id"] = ex["driver_id"]
            row["status"]    = ex["status"]
            row["priority"]  = ex["priority"]
            row["notes"]     = ex.get("notes")
            row["stops"]     = ex.get("stops") or []
        else:
            # New call — set defaults
            row["id"]       = str(uuid.uuid4())
            row["priority"] = "normal"
            row["status"]   = "scheduled"
            row["stops"]    = []
            row["added_at"] = now

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
    print(f"Scraped {len(tb_calls)} calls from TowBook")

    if not tb_calls:
        print("No calls to sync — exiting.")
        return

    sync_to_supabase(tb_calls)
    print("Sync complete.")


if __name__ == "__main__":
    main()
