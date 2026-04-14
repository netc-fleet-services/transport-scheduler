"""
One-shot backfill: geocode every job in Supabase whose pickup_lat or drop_lat
is NULL, and persist the coordinates. Run locally after migration 005.

Requires the same env vars as sync_calls.py (SUPABASE_URL, SUPABASE_SERVICE_KEY).
Reuses sync_calls.geocode() so rate-limiting / User-Agent / caching behave
identically to the scheduled sync.
"""

import os
from supabase import create_client
from sync_calls import geocode

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def main():
    # Pull every row missing at least one side's coords.
    resp = sb.from_("jobs") \
             .select("id, tb_call_num, pickup_addr, drop_addr, "
                     "pickup_lat, pickup_lon, drop_lat, drop_lon") \
             .or_("pickup_lat.is.null,drop_lat.is.null") \
             .execute()

    rows = resp.data or []
    print(f"Found {len(rows)} jobs needing backfill")

    ok, fail, skip = 0, 0, 0
    for i, r in enumerate(rows, 1):
        update = {}

        if r.get("pickup_lat") is None and r.get("pickup_addr"):
            lat, lon = geocode(r["pickup_addr"])
            if lat is not None:
                update["pickup_lat"] = lat
                update["pickup_lon"] = lon

        if r.get("drop_lat") is None and r.get("drop_addr"):
            lat, lon = geocode(r["drop_addr"])
            if lat is not None:
                update["drop_lat"] = lat
                update["drop_lon"] = lon

        if not update:
            skip += 1
            print(f"  [{i}/{len(rows)}] {r.get('tb_call_num') or r['id']}: skip (no addrs or all failed)")
            continue

        try:
            sb.from_("jobs").update(update).eq("id", r["id"]).execute()
            ok += 1
            print(f"  [{i}/{len(rows)}] {r.get('tb_call_num') or r['id']}: updated {list(update.keys())}")
        except Exception as e:
            fail += 1
            print(f"  [{i}/{len(rows)}] {r.get('tb_call_num') or r['id']}: FAIL {e}")

    print(f"\nDone. {ok} updated, {fail} failed, {skip} skipped.")


if __name__ == "__main__":
    main()
