#!/usr/bin/env python3
"""Per-account logo enrichment (one-off, runs locally).
Distinct accounts from Supabase opportunity_cache -> name->domain (Clearbit
autocomplete) -> domain->image (DuckDuckGo icons) -> upload to Supabase Storage
bucket `account-logos` at `<slug(account_name)>.ico` (deterministic, so the
frontend can derive the URL) + a manifest.json. Separate from the deal sweep.
Usage: python logo_enrich.py [limit]"""
import json, ssl, re, sys, time, urllib.request, urllib.parse, urllib.error, concurrent.futures

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 0

env = {}
for line in open(".env.local", encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"')
SB = env["NEXT_PUBLIC_SUPABASE_URL"]; KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
SBH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
UA_H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# Tracked book = in-scope owners (the OWNER_VP keys in lib/engine/helpers.ts). Only enrich
# logos for accounts we actually show — NOT every account in the raw opportunity_cache.
TRACKED_OWNERS = {
    "Anthony Gray", "Claire Hudson", "Casper Hoeholt", "John Woodcock", "Caroline Lacocque",
    "Dirk Fischbach", "Pierre Meraud", "Monika Mutscher", "Carl Kimball", "Mohamad Alhakim",
    "Dan Quinn", "Adam Hasan", "George John", "Guillaume Pasquet", "Luke Dougherty",
    "Tanmay Srivastava", "Alexa Bradley", "Karson Keogh", "Mario Castro", "Rick Taranek",
    "Kevin Cipollaro", "Edward Dlugosz", "Marc Quessenberry", "Richard Hunsinger",
    "Mike Flowers", "Arthur Raguette", "Michael McCarthy", "Bailey Erazo", "Grace Kim",
    "Justin Ajmo", "Steve Ovadje",
}

def req(url, method="GET", data=None, headers=None, timeout=20):
    r = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items(): r.add_header(k, v)
    return urllib.request.urlopen(r, context=CTX, timeout=timeout)

def slug(s):
    x = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return re.sub(r"^-+|-+$", "", x)[:60]

LEGAL = re.compile(r"\b(inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|company|group|groupe|holdings?|plc|sa|ag|nv|bv|gmbh|pvt|private|pte|sas|srl|spa|technologies|technology|solutions|systems|software|services|international|global|the)\b\.?", re.I)
def clean_name(nm):
    x = re.sub(r"[,.()/]", " ", nm)
    x = LEGAL.sub(" ", x)
    return re.sub(r"\s+", " ", x).strip() or nm

# 1) distinct accounts — TRACKED only (in-scope owners + open deals), not the whole cache.
accounts = {}
offset = 0
while True:
    u = f"{SB}/rest/v1/opportunity_cache?select=account_id,account_name,owner_name,is_closed&order=account_name&limit=1000&offset={offset}"
    rows = json.load(req(u, headers=SBH))
    if not rows: break
    for r in rows:
        if r.get("owner_name") not in TRACKED_OWNERS or r.get("is_closed"): continue
        nm = (r.get("account_name") or "").strip()
        sg = slug(nm)
        if nm and sg and sg not in accounts:
            accounts[sg] = {"slug": sg, "account_name": nm, "account_id": r.get("account_id")}
    offset += len(rows)
    if len(rows) < 1000: break
items = list(accounts.values())
if LIMIT: items = items[:LIMIT]
print(f"distinct accounts: {len(accounts)} (processing {len(items)})", flush=True)

# 2) bucket (idempotent, PRIVATE — the manifest holds the customer account list, so
#    it must NOT be world-readable; the frontend will fetch via backend signed URLs).
try:
    req(f"{SB}/storage/v1/bucket", "POST",
        json.dumps({"id": "account-logos", "name": "account-logos", "public": False}).encode(),
        {**SBH, "Content-Type": "application/json"})
    print("bucket created (private)", flush=True)
except urllib.error.HTTPError as e:
    print("bucket:", e.code, e.read()[:120].decode(errors="ignore"), flush=True)

def autocomplete(name, retry=1):
    """Clearbit autocomplete -> (suggested_name, domain) for the top hit."""
    try:
        u = "https://autocomplete.clearbit.com/v1/companies/suggest?query=" + urllib.parse.quote(name)
        data = json.load(req(u, headers=UA_H, timeout=15))
        if data: return (data[0].get("name") or "", data[0].get("domain") or "")
    except Exception:
        if retry > 0: return autocomplete(name, retry - 1)
    return None

def norm(s): return re.sub(r"[^a-z0-9]", "", clean_name(s).lower())
def core(domain): return re.sub(r"[^a-z0-9]", "", domain.split(".")[0])
def good_match(acct, sugg, domain):
    """Reject wrong autocomplete hits (e.g. 'A.R.M.'->army.mil) by requiring the
    account name to actually relate to the suggestion name / domain core."""
    a, d, s = norm(acct), core(domain), norm(sugg)
    if not a or not d: return False
    if a == d or a == s: return True
    if len(a) >= 4 and (d.startswith(a) or a.startswith(d) or s.startswith(a) or a.startswith(s)): return True
    toks = [t for t in re.split(r"\s+", clean_name(acct).lower()) if len(t) >= 4]
    return bool(toks and (toks[0] in d or toks[0] in s))

def iconhorse(domain, retry=2):
    """icon.horse -> (bytes, content_type); much better favicon coverage than DDG.
    Retries since icon.horse rate-limits under concurrency."""
    try:
        resp = req(f"https://icon.horse/icon/{domain}", headers=UA_H, timeout=20)
        if resp.status == 200:
            b = resp.read(); ct = resp.headers.get("content-type", "")
            if b and len(b) >= 200 and "image" in ct: return (b, ct)
    except Exception:
        if retry > 0:
            time.sleep(0.7); return iconhorse(domain, retry - 1)
    return None

def upload(path, content, ctype):
    try:
        req(f"{SB}/storage/v1/object/account-logos/{path}", "POST", content,
            {**SBH, "Content-Type": ctype, "x-upsert": "true"})
        return True
    except Exception:
        return False

def work(a):
    nm = a["account_name"]
    cn = clean_name(nm)
    res = autocomplete(cn) or (autocomplete(nm) if cn != nm else None)
    if not res: return {**a, "domain": None, "logo": False, "path": None}
    sugg, dom = res
    if not dom or not good_match(nm, sugg, dom):
        return {**a, "domain": dom, "logo": False, "path": None}
    img = iconhorse(dom)
    if not img: return {**a, "domain": dom, "logo": False, "path": None}
    body, ct = img
    ok = upload(f"{a['slug']}.png", body, ct or "image/png")
    return {**a, "domain": dom, "logo": ok, "path": f"{a['slug']}.png" if ok else None}

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    for i, res in enumerate(ex.map(work, items)):
        results.append(res)
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(items)} ({sum(1 for r in results if r['logo'])} logos)", flush=True)

got = [r for r in results if r["logo"]]
print(f"RESOLVED {len(got)}/{len(items)} logos", flush=True)
if LIMIT and LIMIT <= 40:
    for r in results:
        print(f"   {'OK' if r['logo'] else '--'} {r['account_name'][:32]:32} {r.get('domain') or '(no domain)'}", flush=True)

# 3) manifest (account_name slug -> public url) for the backend join / reference
manifest = {r["slug"]: {"account_name": r["account_name"], "account_id": r.get("account_id"),
                        "domain": r.get("domain"), "path": r.get("path"),
                        "source": "duckduckgo" if r["logo"] else None} for r in results}
try:
    req(f"{SB}/storage/v1/object/account-logos/manifest.json", "POST",
        json.dumps({"resolved": len(got), "total": len(items), "logos": manifest}).encode(),
        {**SBH, "Content-Type": "application/json", "x-upsert": "true"})
    print("manifest.json uploaded", flush=True)
except Exception as e:
    print("manifest err", e, flush=True)

# verify one object is stored + is an image (authenticated read; bucket is private)
if got:
    try:
        v = req(f"{SB}/storage/v1/object/account-logos/{got[0]['path']}", headers=SBH, timeout=15)
        print(f"verify {got[0]['path']}: {v.status} {v.headers.get('content-type')} {len(v.read())}b", flush=True)
    except Exception as e:
        print("verify err", e, flush=True)
for r in got[:6]:
    print("  ->", r["account_name"], "|", r["domain"], "|", r["path"], flush=True)
