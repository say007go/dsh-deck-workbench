"""Local, structure-first retrieval. Returns a small shortlist, never the corpus."""
from __future__ import annotations
import argparse, collections, html, json, math, os, re, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reference_root import resolve as resolve_reference

ROOT=Path(__file__).resolve().parents[1]
ALIASES={
 'mapping':['映射','承接','对应','牵引'], 'flow':['流程','步骤','路径','递进'],
 'matrix':['矩阵','交叉','任务成果','任务产出','全景'], 'hierarchy':['层级','分层','梯队'],
 'cycle':['闭环','循环','迭代'], 'comparison':['对照','对比','差异','双轨'],
 'parallel':['并列','多项','多个维度'], 'timeline':['阶段','排期','进度','时间轴'],
 'mechanism':['机制','控制点','保障','实施'], 'evidence':['案例','示例','实物','证据'],
 'outcomes':['成果','交付','产出'], 'model':['模型','体系','框架','能力结构'],
 'network':['协作','多方','协同','角色','职责'], 'hybrid':['组合','混合','复合结构'],
 'narrative':['段落','叙述','说明']}

def load():
    rows=[json.loads(s) for s in (ROOT/'references/index.jsonl').read_text(encoding='utf-8').splitlines() if s.strip()]
    corpus={r['page']:r['text'] for r in (json.loads(s) for s in (ROOT/'references/corpus.jsonl').read_text(encoding='utf-8').splitlines() if s.strip())}
    return rows,corpus

def grams(text):
    chunks=re.findall(r'[\u4e00-\u9fff]+|[a-z0-9]+',text.lower())
    return set(g for s in chunks for g in ([s] if len(s)<3 or s.isascii() else [s[i:i+2] for i in range(len(s)-1)]))

def relations(text):
    return {k for k,v in ALIASES.items() if k in text.lower().split() or any(t in text for t in v)}

def shortlist(rows,corpus,query,relation='',density=None,blocks=None,limit=8,used=()):
    wanted=relations(relation) if relation else relations(query)
    tokens=grams(query);used=set(used);ranked=[]
    for row in rows:
        tags=set(row.get('relations',[]));family=row['primary_family']
        body=corpus[row['page']];title=row.get('title','')
        common=tokens & grams(body);title_common=tokens & grams(title+' '+row.get('layout_note',''))
        # Relationships dominate business-topic matches. Source facts never become new copy.
        score=14*len(tags&wanted)+7*(family in wanted)+min(3,len(common)*.12)+min(2,len(title_common)*.3)
        if density:score+=3 if row['density']==density else -1
        if blocks is not None and row.get('group_count'):
            score+=max(-2,3-abs(row['group_count']-blocks))
        if row['page'] in used:score-=6
        ranked.append((score,row))
    ranked.sort(key=lambda x:(-x[0],x[1]['page']))
    selected=[];counts=collections.Counter();signatures=collections.Counter()
    # Soft diversity within plausible candidates; do not insert unrelated pages to meet a quota.
    floor=ranked[0][0]-24 if ranked else 0
    for score,row in ranked:
        if len(selected)>=limit:break
        family=row['primary_family']
        signature=(family,tuple(sorted(row.get('relations',[]))),row.get('group_count'))
        if counts[family]>=2 or signatures[signature]>=1:continue
        if wanted and not (set(row.get('relations',[]))&wanted):continue
        if score<floor and selected:continue
        selected.append((score,row));counts[family]+=1;signatures[signature]+=1
    if len(selected)<min(limit,3):
        seen={r['page'] for _,r in selected}
        for score,row in ranked:
            if row['page'] not in seen:selected.append((score,row));seen.add(row['page'])
            if len(selected)>=min(limit,3):break
    return selected

def gallery(selected,output):
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    font_path=os.environ.get('DECK_REFERENCE_FONT')
    font=None
    if font_path and Path(font_path).is_file():
        try:font=ImageFont.truetype(font_path,18)
        except Exception:font=None
    if font is None:font=ImageFont.load_default()
    sheet=Image.new('RGB',(1920,394*math.ceil(len(selected)/3)),'#E5E5E5');draw=ImageDraw.Draw(sheet)
    for i,(_,r) in enumerate(selected):
        x,y=i%3*640,i//3*394
        path=ROOT/(r.get('thumbnail') or r['image'])
        if not path.is_file():path=ROOT/r['image']
        with Image.open(path) as im:
            if im.size!=(640,360):im=im.convert('RGB').resize((640,360),Image.LANCZOS)
            sheet.paste(im,(x,y+34))
        draw.text((x+10,y+6),f"P{r['page']:03d}  {r['primary_family']}  {r['density']}",font=font,fill='#111111')
    sheet.save(output)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--query',default='');p.add_argument('--relation',default='')
    p.add_argument('--density',choices=['low','medium','high']);p.add_argument('--blocks',type=int)
    p.add_argument('--limit',type=int,default=8);p.add_argument('--used',type=int,nargs='*',default=[])
    p.add_argument('--pages',type=int,nargs='+');p.add_argument('--gallery');p.add_argument('--output')
    p.add_argument('--reference',help='Shared reference-library root; defaults to DECK_REFERENCE_ROOT or the plugin config')
    args=p.parse_args()
    global ROOT
    resolved=resolve_reference(args.reference,('references/index.jsonl','references/corpus.jsonl','assets/pages'))
    if resolved is None:
        print('未找到参考库：请设置 DECK_REFERENCE_ROOT、reference.json，或传 --reference <dir>',file=sys.stderr)
        raise SystemExit(2)
    ROOT=resolved
    rows,corpus=load()
    if args.pages:
        selected=[(0,next(r for r in rows if r['page']==n)) for n in args.pages]
    else:selected=shortlist(rows,corpus,args.query,args.relation,args.density,args.blocks,max(1,min(args.limit,24)),args.used)
    result=[]
    for score,row in selected:
        result.append({**{k:row.get(k) for k in ['page','title','primary_family','relations','layout_note','group_count','density','annotation_basis']},
                       'score':round(score,2),'image':str(ROOT/row['image']),
                       'detail':str(ROOT/'references/pages'/f"{row['page']:03d}.json")})
    if args.gallery:gallery(selected,args.gallery)
    payload={'wanted_relations':sorted(relations(args.relation or args.query)),'candidates':result,
             'next_step':'Inspect the gallery and open 2-4 promising page images. Tags aid retrieval; choose the layout from the new content first.'}
    rendered=json.dumps(payload,ensure_ascii=False,indent=2)
    if args.output:Path(args.output).write_text(rendered,encoding='utf-8')
    print(rendered)

if __name__=='__main__':
    try:sys.stdout.reconfigure(encoding='utf-8')
    except Exception:pass
    main()
