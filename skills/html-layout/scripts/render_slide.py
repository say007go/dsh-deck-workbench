"""Render a 1920x1080 local HTML diagram with source-bound copy to a 4K PNG.

Uses Playwright's bundled Chromium when present; otherwise falls back to the
installed Microsoft Edge (channel="msedge"). It never downloads a browser.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from check_copy import check, read_source

def render(args):
    source=read_source(args.source);plan=json.loads(Path(args.plan).read_text(encoding='utf-8-sig'))
    audit=check(source,plan)
    if not audit['ok']:raise ValueError(json.dumps(audit['errors'],ensure_ascii=False))
    out=Path(args.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        try:
            browser=p.chromium.launch(headless=True)
        except Exception:
            # Bundled Chromium missing: reuse the installed Edge, do not download.
            browser=p.chromium.launch(channel='msedge',headless=True)
        page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=args.scale)
        page.route('http://**/*',lambda r:r.abort());page.route('https://**/*',lambda r:r.abort())
        page.goto(Path(args.html).resolve().as_uri(),wait_until='load')
        page.evaluate('document.fonts.ready')
        report=page.evaluate('''({copy})=>{
          const errors=[], nodes=[...document.querySelectorAll('[data-copy]')], seen={};
          const root=document.querySelector('#slide');
          if(!root)return {errors:['Missing #slide']};
          for(const el of nodes){
            const id=el.dataset.copy;
            if(!(id in copy)){errors.push('Unknown data-copy '+id);continue;}
            el.textContent=copy[id];seen[id]=(seen[id]||0)+1;
          }
          for(const id of Object.keys(copy))if(!seen[id])errors.push('Missing visible copy item '+id);
          const r=root.getBoundingClientRect();
          if(Math.abs(r.width-1920)>.5||Math.abs(r.height-1080)>.5)errors.push('Slide must be 1920x1080 CSS pixels');
          const boxes=[], glyphGroups=[];
          for(const el of nodes){
            const b=el.getBoundingClientRect(),s=getComputedStyle(el),id=el.dataset.copy;
            if(!b.width||!b.height||s.visibility==='hidden'||Number(s.opacity)===0||s.display==='none')errors.push('Invisible copy '+id);
            if(el.checkVisibility&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))errors.push('Invisible copy '+id);
            if(b.left<r.left-.5||b.top<r.top-.5||b.right>r.right+.5||b.bottom>r.bottom+.5)errors.push('Copy outside slide '+id);
            if(el.clientHeight && el.scrollHeight>el.clientHeight+1)errors.push('Vertical text overflow '+id);
            if(el.clientWidth && el.scrollWidth>el.clientWidth+1)errors.push('Horizontal text overflow '+id);
            const range=document.createRange();range.selectNodeContents(el);
            const rects=[...range.getClientRects()];
            for(const line of rects)if(line.left<r.left-.5||line.right>r.right+.5||line.top<r.top-.5||line.bottom>r.bottom+.5)errors.push('Glyph outside slide '+id);
            glyphGroups.push({id,el,rects});
            boxes.push({id,x:b.x,y:b.y,width:b.width,height:b.height,font:s.fontSize,color:s.color});
          }
          for(let i=0;i<glyphGroups.length;i++)for(let j=i+1;j<glyphGroups.length;j++){
            const a=glyphGroups[i],b=glyphGroups[j];
            if(a.el.contains(b.el)||b.el.contains(a.el))continue;
            if(a.rects.some(x=>b.rects.some(y=>Math.min(x.right,y.right)-Math.max(x.left,y.left)>3&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>3)))errors.push('Text overlap '+a.id+'/'+b.id);
          }
          // Visible words may come only from exact registered source slices.
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
          while(walker.nextNode()){
            const n=walker.currentNode,par=n.parentElement;
            if(!n.textContent.trim()||par.closest('style,script,[data-copy]'))continue;
            if(par.getClientRects().length&&getComputedStyle(par).visibility!=='hidden')errors.push('Unbound visible text: '+n.textContent.slice(0,50));
          }
          for(const el of [root,...root.querySelectorAll('*')])for(const pseudo of ['::before','::after']){
            const c=getComputedStyle(el,pseudo).content;
            if(c&&!['none','normal','""',"''"].includes(c))errors.push('Generated text in CSS '+pseudo);
          }
          for(const el of root.querySelectorAll('li'))if(getComputedStyle(el).listStyleType!=='none')errors.push('Use source-bound list labels; automatic list markers are not audited');
          return {errors:[...new Set(errors)],boxes,canvas:{width:r.width,height:r.height}};
        }''',{'copy':audit['text_by_id']})
        if report['errors']:
            browser.close();raise ValueError(json.dumps(report,ensure_ascii=False,indent=2))
        page.locator('#slide').screenshot(path=str(out),animations='disabled')
        browser.close()
    if args.preview:
        from PIL import Image
        with Image.open(out) as image:
            image.resize((1920,1080),Image.Resampling.LANCZOS).save(args.preview)
    report.update({'copy_audit':audit,'output':str(out),'output_size':[1920*args.scale,1080*args.scale],
                   'limitations':'No automatic claim of semantic fidelity, balanced composition or PowerPoint quality; inspect the actual image.'})
    report_path=out.with_suffix('.audit.json');report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'ok':True,'output':str(out),'audit':str(report_path),'copy_items':len(audit['text_by_id'])},ensure_ascii=False))

if __name__=='__main__':
    try:sys.stdout.reconfigure(encoding='utf-8')
    except Exception:pass
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['html','source','plan','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--scale',type=int,choices=[1,2],default=2);p.add_argument('--preview')
    render(p.parse_args())
