import json, glob
records = []
for f in sorted(glob.glob('./dr_*.json')):
    d = json.load(open(f, encoding='utf-8'))
    for r in d:
        if isinstance(r.get('record'), dict):
            records.append(r['record'])

# Find records that read calls but have EB/DM with null last_contact_date.
# These are the "second-order residue" the candidate flags as the real bug.
def opp_id(r):
    h = r.get('hard') or {}
    return h.get('opportunity_id') or h.get('opp_id') or r.get('opportunity_id') or r.get('id')

hits = []
for r in records:
    ai = r.get('ai') or {}
    sm = (ai.get('stakeholder_map') or {}).get('items') or []
    ec = r.get('evidence_coverage') or {}
    try: cr = int(ec.get('calls_read') or 0)
    except Exception: cr = 0
    if cr <= 0: continue
    for it in sm:
        if not isinstance(it, dict): continue
        role = str(it.get('role') or '').lower()
        lcd = it.get('last_contact_date')
        is_null = (lcd is None or lcd=='' or str(lcd).strip().lower()=='null')
        if is_null and ('buyer' in role or 'decision' in role):
            h = r.get('hard') or {}
            hits.append((opp_id(r), h.get('account') or h.get('account_name'), it.get('name'), it.get('role'), cr, ec.get('avoma_attendees')))
            break

print('records with calls_read>0 AND an EB/DM stakeholder null:', len(hits))
for x in hits[:25]:
    att = x[5]
    natt = len(att) if isinstance(att, list) else 0
    print(f'  opp={x[0]} acct={x[1]!r} {x[3]}={x[2]!r} calls_read={x[4]} avoma_attendees_listed={natt}')
