"""Bind exact source copy and package an offline, responsive, single-file HTML slide."""
from __future__ import annotations
import argparse,base64,html,json,mimetypes,re,sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote,urlparse
from check_copy import check,read_source

VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

def data_url(value,base):
    value=html.unescape(value.strip())
    if not value or value.startswith(('data:','#')):return value
    parsed=urlparse(value)
    if parsed.scheme in ('http','https') or value.startswith('//'):
        raise ValueError('Offline HTML cannot depend on a remote asset: '+value)
    if parsed.scheme=='file':path=Path(unquote(parsed.path.lstrip('/') if re.match(r'^/[A-Za-z]:',parsed.path) else parsed.path))
    elif parsed.scheme and not re.match(r'^[A-Za-z]:[\\/]',value):raise ValueError('Unsupported asset URI: '+value)
    else:path=base/unquote(value.split('#',1)[0].split('?',1)[0])
    path=path.resolve()
    if not path.is_file():raise FileNotFoundError(path)
    mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,'+base64.b64encode(path.read_bytes()).decode('ascii')

def bundle_css(css,base):
    if re.search(r'@import\b',css,re.I):raise ValueError('Inline CSS imports before exporting the standalone page')
    return re.sub(r'url\(\s*([\'"]?)(.*?)\1\s*\)',lambda m:'url("'+data_url(m.group(2),base)+'")',css,flags=re.I)

class Binder(HTMLParser):
    def __init__(self,copy,base):
        super().__init__(convert_charrefs=False)
        self.copy=copy;self.base=base;self.parts=[];self.skip=0;self.style=False;self.seen=set()
    def handle_decl(self,data):self.parts.append('<!'+data+'>')
    def handle_comment(self,data):
        if not self.skip:self.parts.append('<!--'+data+'-->')
    def handle_starttag(self,tag,attrs):
        if self.skip:
            if tag not in VOID:self.skip+=1
            return
        attr=dict(attrs)
        if tag=='script':raise ValueError('Author the static slide without custom scripts; the exporter adds offline viewport scaling')
        if tag=='base':raise ValueError('Remove base href from the standalone slide')
        if tag=='link' and 'stylesheet' in (attr.get('rel') or ''):
            href=attr.get('href','')
            if urlparse(href).scheme or href.startswith('//'):raise ValueError('Stylesheets must be local before export')
            path=(self.base/unquote(href)).resolve()
            self.parts.append('<style>'+bundle_css(path.read_text(encoding='utf-8'),path.parent)+'</style>');return
        if tag=='link' and attr.get('href'):raise ValueError('Inline or remove auxiliary link resources before export')
        new=[]
        for key,value in attrs:
            if value is None:new.append(key);continue
            if key.startswith('on'):raise ValueError('Remove inline event handlers from the static slide')
            if key in ('src','poster') or (tag=='image' and key in ('href','xlink:href')):value=data_url(value,self.base)
            if key=='srcset':raise ValueError('Use a single embedded image source for this fixed-canvas slide')
            if key=='style':value=bundle_css(value,self.base)
            new.append(key+'="'+html.escape(value,quote=True)+'"')
        self.parts.append('<'+tag+(' '+' '.join(new) if new else '')+'>')
        if tag=='style':self.style=True
        if 'data-copy' in attr:
            ident=attr['data-copy']
            if ident not in self.copy:raise ValueError('Unknown data-copy '+ident)
            if tag in VOID:raise ValueError('Copy must be bound to a text container')
            self.parts.append(html.escape(self.copy[ident],quote=False));self.seen.add(ident);self.skip=1
    def handle_startendtag(self,tag,attrs):
        if self.skip:return
        self.handle_starttag(tag,attrs)
        if tag not in VOID:self.handle_endtag(tag)
    def handle_endtag(self,tag):
        if self.skip:
            if tag not in VOID:self.skip-=1
            if self.skip:return
        if tag=='style':self.style=False
        self.parts.append('</'+tag+'>')
    def handle_data(self,data):
        if not self.skip:self.parts.append(bundle_css(data,self.base) if self.style else data)
    def handle_entityref(self,name):
        if not self.skip:self.parts.append('&'+name+';')
    def handle_charref(self,name):
        if not self.skip:self.parts.append('&#'+name+';')

VIEWPORT='''<style id="standalone-slide-view">
html,body{width:100%;height:100%;margin:0!important;overflow:hidden;background:#e8e8e8!important}
#slide{position:absolute!important;left:50%!important;top:50%!important;transform-origin:center center;transform:translate(-50%,-50%) scale(var(--slide-scale,1))}
</style><script id="standalone-slide-scaling">
(()=>{function fit(){document.documentElement.style.setProperty('--slide-scale',String(Math.min(innerWidth/1920,innerHeight/1080)))}addEventListener('resize',fit);fit()})();
</script>'''

def export(template,source_path,plan_path,output,report=None,page_file=None):
    template=Path(template).resolve();output=Path(output).resolve()
    if output==template:raise ValueError('Keep the source template; export to a separate HTML file')
    source=read_source(source_path);plan=json.loads(Path(plan_path).read_text(encoding='utf-8-sig'))
    audit=check(source,plan,page_file)
    if not audit['ok']:raise ValueError(json.dumps(audit['errors'],ensure_ascii=False))
    parser=Binder(audit['text_by_id'],template.parent);parser.feed(template.read_text(encoding='utf-8-sig'));parser.close()
    missing=set(audit['text_by_id'])-parser.seen
    if missing:raise ValueError('Missing copy containers: '+', '.join(sorted(missing)))
    content=''.join(parser.parts)
    if not re.search(r'\bid=[\'"]slide[\'"]',content):raise ValueError('Missing #slide fixed canvas')
    meta='<meta name="viewport" content="width=device-width,initial-scale=1">'
    if '</head>' in content:content=content.replace('</head>',meta+'</head>',1)
    else:content=content.replace('<html', '<html',1);content=content.replace('<style',meta+'<style',1)
    if '</body>' in content:content=content.replace('</body>',VIEWPORT+'</body>',1)
    elif '</html>' in content:content=content.replace('</html>',VIEWPORT+'</html>',1)
    else:content+=VIEWPORT
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(content,encoding='utf-8',newline='')
    result={'ok':True,'output':str(output),'mode':'html','bound_items':len(parser.seen),
            'source_sha256':audit['source_sha256'],'offline':True,
            'next_step':'Open the exported HTML directly without source or plan files, verify visible text and inspect at native and smaller viewport sizes.'}
    report_path=Path(report).resolve() if report else template.parent/(output.stem+'.audit.json')
    report_path.parent.mkdir(parents=True,exist_ok=True)
    report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    result['audit']=str(report_path)
    return result

if __name__=='__main__':
    try:sys.stdout.reconfigure(encoding='utf-8')
    except Exception:pass
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('html','source','plan','output'):p.add_argument('--'+key,required=True)
    p.add_argument('--report',help='Audit JSON path; defaults to the template work directory')
    p.add_argument('--page-file',help='Approved content/pages/Pxx.md; source.txt must be an exact copy')
    a=p.parse_args();print(json.dumps(export(a.html,a.source,a.plan,a.output,a.report,a.page_file),ensure_ascii=False,indent=2))
