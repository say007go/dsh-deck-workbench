"""Check source ranges and exact deletion/extraction provenance, not semantics."""
from __future__ import annotations
import argparse, hashlib, json, re, sys
from pathlib import Path

PROTECT=re.compile(r'\d+(?:[.,]\d+)*(?:%|％)?|不得|不能|不应|不超过|不少于|不低于|不高于|不含|仅限|至少|至多|部分|可选|拟|必须|应当|建议')

def read_source(path):
    # Keep CRLF intact: every offset is a Python Unicode code-point offset in the saved source.
    with open(path,'r',encoding='utf-8-sig',newline='') as f:return f.read()

def check(source,plan):
    errors=[];warnings=[];rendered={};coverage=set();shown=set()
    digest=hashlib.sha256(source.encode('utf-8')).hexdigest()
    if plan.get('source_sha256')!=digest:errors.append('source_sha256 mismatch: source must be captured before arranging copy')
    def span(value,label):
        if not isinstance(value,list) or len(value)!=2 or any(type(n)is not int for n in value):
            errors.append(f'{label}: expected [start,end] integer code-point offsets');return None
        a,b=value
        if not 0<=a<b<=len(source):errors.append(f'{label}: out-of-range span {value}');return None
        return a,b
    for item in plan.get('items',[]):
        ident=item.get('id','');mode=item.get('mode','keep')
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*',ident):errors.append(f'Invalid item id: {ident}')
        if ident in rendered:errors.append(f'Duplicate id: {ident}')
        origin=span(item.get('origin'),ident+'.origin')
        if not origin:continue
        ranges=item.get('keep',[list(origin)]);valid=[];last=origin[0]
        for i,value in enumerate(ranges):
            ab=span(value,f'{ident}.keep[{i}]')
            if not ab:continue
            a,b=ab
            if a<last or a<origin[0] or b>origin[1]:errors.append(f'{ident}: ranges must be ordered, nonoverlapping, and inside origin')
            last=b;valid.append(ab)
        if not valid:errors.append(f'{ident}: empty copy');continue
        if mode not in ('keep','delete','extract'):errors.append(f'{ident}: unknown mode {mode}')
        if mode=='keep' and valid!=[origin]:errors.append(f'{ident}: keep mode must retain the entire origin')
        if mode=='extract' and valid!=[origin]:errors.append(f'{ident}: extract origin must equal its single contiguous phrase; account for the surrounding source separately')
        if mode=='delete' and valid!=[origin] and not item.get('deletion_reason'):
            errors.append(f'{ident}: deletion_reason is required')
        retained={i for a,b in valid for i in range(a,b)}
        if mode=='delete':
            # A deletion chain cannot invent a sentence by joining separate original sentences.
            sentence_ids=[]
            for a,b in valid:
                sentence_ids.append(sum(source[origin[0]:a].count(c) for c in '。！？!?'))
            if len(set(sentence_ids))>1 and valid!=[origin]:
                warnings.append(f'{ident}: spans touch multiple sentences; review that sentence boundaries and subjects remain intact')
        text=''.join(source[a:b] for a,b in valid)
        if 'text' in item and item['text']!=text:errors.append(f'{ident}: supplied text differs from exact source slices')
        rendered[ident]=text;coverage.update(range(*origin));shown.update(retained)
        if mode=='delete':
            for m in PROTECT.finditer(source,*origin):
                if any(i not in retained for i in range(m.start(),m.end())):errors.append(f'{ident}: deleted protected token {m.group()}')
    omissions=plan.get('omissions',[])
    for i,item in enumerate(omissions):
        ab=span(item.get('range'),f'omissions[{i}]')
        if not item.get('reason'):errors.append(f'omissions[{i}]: reason required')
        if ab:
            coverage.update(range(*ab))
            if PROTECT.search(source,*ab):errors.append(f'omissions[{i}]: contains protected numbers/qualifiers')
    missing=[i for i,c in enumerate(source) if not c.isspace() and i not in coverage]
    if missing:errors.append(f'Unaccounted source characters: {len(missing)}, first offsets {missing[:12]}')
    for i,ab in enumerate(plan.get('protected_ranges',[])):
        ab=span(ab,f'protected_ranges[{i}]')
        if ab and any(i not in shown for i in range(*ab)):errors.append(f'protected_ranges[{i}]: not fully displayed')
    if not rendered:errors.append('No copy items')
    return {'ok':not errors,'errors':errors,'warnings':warnings,'source_sha256':digest,'text_by_id':rendered,
            'deleted':[{'id':i['id'],'original':source[slice(*i['origin'])],
                        'displayed':rendered.get(i['id'],''),'reason':i.get('deletion_reason')}
                       for i in plan.get('items',[]) if i.get('mode')=='delete'],
            'omitted':[{'text':source[slice(*o['range'])],'reason':o.get('reason')} for o in omissions if isinstance(o.get('range'),list)],
            'limits':'Passing proves exact source provenance, ordering, coverage and token checks; semantic preservation still requires reading.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True);p.add_argument('--plan',required=True);p.add_argument('--report')
    a=p.parse_args();r=check(read_source(a.source),json.loads(Path(a.plan).read_text(encoding='utf-8-sig')))
    if a.report:Path(a.report).write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(r,ensure_ascii=False,indent=2));raise SystemExit(0 if r['ok'] else 1)

if __name__=='__main__':
    try:sys.stdout.reconfigure(encoding='utf-8')
    except Exception:pass
    main()
