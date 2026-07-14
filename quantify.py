import json, glob, re
records = []
for f in sorted(glob.glob('./dr_*.json')):
    d = json.load(open(f, encoding='utf-8'))
    for r in d:
        if isinstance(r.get('record'), dict):
            records.append(r['record'])

def norm(s):
    return re.sub(r'[^a-z ]','', (s or '').lower()).strip()

def tokens(s):
    return set(t for t in norm(s).split() if len(t) >= 3)

# For records that read calls: how many NULL stakeholders are named people who
# also appear in avoma_attendees (so a date demonstrably exists) -> true loss.
true_loss = 0
null_named_total = 0
null_unnamed = 0  # name contains 'unknown/unnamed/unmapped' or role-placeholder
considered = 0
examples = []
UNNAMED = ('unknown','unnamed','unmapped','name unknown','(','tbd')
for r in records:
    ec = r.get('evidence_coverage') or {}
    try: cr = int(ec.get('calls_read') or 0)
    except Exception: cr = 0
    if cr <= 0: continue
    att = ec.get('avoma_attendees') or []
    if not isinstance(att, list): att = []
    att_tokens = [tokens(a) for a in att if isinstance(a,str)]
    sm = (r.get('ai') or {}).get('stakeholder_map') or {}
    for it in sm.get('items') or []:
        if not isinstance(it, dict): continue
        nm = it.get('name') or ''
        lcd = it.get('last_contact_date')
        is_null = (lcd is None or lcd=='' or str(lcd).strip().lower()=='null')
        if not is_null: continue
        considered += 1
        low = nm.lower()
        if any(u in low for u in UNNAMED) or len(tokens(nm))==0:
            null_unnamed += 1
            continue
        null_named_total += 1
        nt = tokens(nm)
        # match if all name tokens (or the surname) appear in an attendee
        matched = False
        for at in att_tokens:
            if nt and (nt <= at or (nt & at) and len(nt & at) >= max(1,len(nt)-0)):
                matched = True; break
        # looser: any shared token of len>=4
        if not matched:
            big = {t for t in nt if len(t)>=4}
            for at in att_tokens:
                if big & at:
                    matched = True; break
        if matched:
            true_loss += 1
            if len(examples) < 15:
                h = r.get('hard') or {}
                examples.append((h.get('opportunity_id'), nm, it.get('role')))

print('NULL stakeholders in calls_read>0 records:', considered)
print('  unnamed/placeholder (null is arguably correct):', null_unnamed)
print('  NAMED people with null lcd:', null_named_total)
print('  ...of which the named person ALSO appears in avoma_attendees (date demonstrably exists -> TRUE LOSS):', true_loss)
print('examples of true loss:')
for e in examples:
    print('  ', e)
