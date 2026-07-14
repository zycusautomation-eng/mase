import json, glob
records = []
for f in sorted(glob.glob('./dr_*.json')):
    d = json.load(open(f, encoding='utf-8'))
    for r in d:
        if isinstance(r.get('record'), dict):
            records.append(r['record'])
print('dict records', len(records))

def is_active(r):
    # try common closed markers
    hard = r.get('hard') or {}
    stage = (hard.get('stage') or r.get('stage') or '').lower()
    # closed stages contain 'closed'
    if 'closed' in stage:
        return False
    return True

active = [r for r in records if is_active(r)]
print('active records (stage not closed):', len(active))

def run(recs, label):
    total_items = null_items = 0
    recs_with_people = recs_all_null = 0
    nr_null = nr_total = zr_null = zr_total = 0
    for r in recs:
        ai = r.get('ai') or {}
        sm = ai.get('stakeholder_map') or {}
        items = sm.get('items') or []
        ppl = [it for it in items if isinstance(it, dict) and it.get('name')]
        if not ppl:
            continue
        recs_with_people += 1
        ec = r.get('evidence_coverage') or {}
        try: calls_read = int(ec.get('calls_read') or 0)
        except Exception: calls_read = 0
        rec_nulls = 0
        for it in ppl:
            total_items += 1
            lcd = it.get('last_contact_date')
            is_null = (lcd is None or lcd == '' or str(lcd).strip().lower() == 'null')
            if is_null:
                null_items += 1; rec_nulls += 1
            if calls_read > 0:
                nr_total += 1; nr_null += is_null
            else:
                zr_total += 1; zr_null += is_null
        if rec_nulls == len(ppl):
            recs_all_null += 1
    print(f'=== {label} ===')
    print('  records with >=1 named stakeholder:', recs_with_people)
    print('  total named stakeholder items:', total_items)
    print(f'  null last_contact_date: {null_items} ({100*null_items/max(1,total_items):.1f}%)')
    print('  records where EVERY stakeholder null:', recs_all_null)
    print(f'  calls_read>0: {nr_null}/{nr_total} null ({100*nr_null/max(1,nr_total):.1f}%)')
    print(f'  calls_read==0: {zr_null}/{zr_total} null ({100*zr_null/max(1,zr_total):.1f}%)')

run(records, 'ALL records')
run(active, 'ACTIVE records')
