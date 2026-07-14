import json, glob, sys
target = sys.argv[1]
records = []
for f in sorted(glob.glob('./dr_*.json')):
    d = json.load(open(f, encoding='utf-8'))
    for r in d:
        if isinstance(r.get('record'), dict):
            records.append(r['record'])
for r in records:
    h = r.get('hard') or {}
    oid = h.get('opportunity_id') or h.get('opp_id')
    if oid and oid.startswith(target):
        print('opp', oid, 'account', h.get('account'))
        ec = r.get('evidence_coverage') or {}
        print('calls_discovered', ec.get('calls_discovered'), 'calls_read', ec.get('calls_read'))
        print('avoma_attendees', json.dumps(ec.get('avoma_attendees')))
        sm = (r.get('ai') or {}).get('stakeholder_map') or {}
        for it in sm.get('items') or []:
            print('  STK', it.get('role'), '|', it.get('name'), '| lcd=', it.get('last_contact_date'), '| src=', (it.get('source') or '')[:80])
        break
