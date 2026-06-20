#!/usr/bin/env python3
"""Seed logos for recognizable tracked accounts via known domains (icon.horse), with
retries to push past intermittent Zscaler 403/504 on the Supabase upload."""
import json, ssl, time, urllib.request

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA_H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
env = {}
for line in open(".env.local", encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"')
SB = env["NEXT_PUBLIC_SUPABASE_URL"]; KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
SBH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def req(url, method="GET", data=None, headers=None, timeout=25):
    r = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items(): r.add_header(k, v)
    return urllib.request.urlopen(r, context=CTX, timeout=timeout)

def fetch(dom, retry=4):
    try:
        resp = req(f"https://icon.horse/icon/{dom}", headers=UA_H)
        if resp.status == 200:
            b = resp.read(); ct = resp.headers.get("content-type", "")
            if len(b) >= 200 and "image" in ct: return b, ct
    except Exception:
        if retry > 0: time.sleep(1.3); return fetch(dom, retry - 1)
    return None, None

def put(slug, b, ct, retry=6):
    try:
        req(f"{SB}/storage/v1/object/account-logos/{slug}.png", "POST", b, {**SBH, "Content-Type": ct, "x-upsert": "true"})
        return True
    except Exception:
        if retry > 0: time.sleep(1.6); return put(slug, b, ct, retry - 1)
    return False

KNOWN = {
    "greencore-group": "greencore.com",
    "cadence-design-systems-inc": "cadence.com",
    "publicis-groupe": "publicisgroupe.com",
    "consumer-cellular-inc": "consumercellular.com",
    "engie": "engie.com",
    "intuit-inc": "intuit.com",
    "mair-group": "mairgroup.com",
}
ok = 0
for slug, dom in KNOWN.items():
    b, ct = fetch(dom)
    if not b: print(f"  no-fetch {slug} ({dom})"); continue
    if put(slug, b, ct): print(f"  OK   {slug} ({dom}) {len(b)}b"); ok += 1
    else: print(f"  no-upload {slug} ({dom})")
print(f"uploaded {ok}")
