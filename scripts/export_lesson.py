#!/usr/bin/env python3
"""d3im3r-class parser v2 (MVP): LaTeX Beamer -> JSON semántico + SVG con fondo blanco.

Sin IA. Conserva fuentes y reporta anomalías; necesita TeX Live y pdftocairo
para compilar TikZ. Solo compilar archivos LaTeX de confianza.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import pathlib
import re
import shutil
import subprocess
import tempfile
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from lxml import etree
from PIL import Image

VERSION = '3.0.0-beta'
XML_NS = 'http://www.w3.org/2000/svg'
XLINK_NS = 'http://www.w3.org/1999/xlink'

CODE_ENVS = {
    'pythoncode':'python','pythoncodedark':'python','jscode':'javascript',
    'jscodedark':'javascript','javacode':'java','javacodedark':'java','javascriptcode':'javascript',
    'javascriptcodedark':'javascript','htmlcode':'html','htmlcodedark':'html',
    'csscode':'css','csscodedark':'css','bashcode':'bash','bashcodedark':'bash',
    'cppcode':'cpp','cppcodedark':'cpp','sqlcode':'sql','sqlcodedark':'sql',
    'jsoncode':'json','jsoncodedark':'json','console':'text',
    'verbatim':'text','lstlisting':'text','minted':'text',
    'htmlfile':'html','pythonfile':'python','cppfile':'cpp','javafile':'java',
    'sqlfile':'sql','bashfile':'bash','consolecode':'text',
    'mongodbcode':'javascript','mongodbcodedark':'javascript',
}
LIST_ENVS = {'enumerate', 'itemize', 'description'}
MATH_ENVS = {'equation','equation*','align','align*','alignat','alignat*',
             'gather','gather*','multline','multline*','flalign','flalign*','displaymath'}
LAYOUT_ENVS = {'columns','column','minipage','center','flushleft','flushright',
               'onlyenv','uncoverenv','overlayarea','blockwrapper',
               'multicols','multicols*','adjustwidth','samepage'}
CALLOUTS = {'Idea':'idea', 'Practice':'practice','DefBlock':'definition',
            'Result':'result', 'Warning':'warning','Compare':'comparison',
            'Question':'question','ExampleBlock':'example'}
CALLOUT_ENVS = {'block':'standard','alertblock':'warning','exampleblock':'example'}
IGNORABLE_CMDS = {'centering','raggedright','raggedleft','tiny','scriptsize',
                  'footnotesize','small','normalsize','large','Large','LARGE','huge',
                  'Huge','pause','medskip','bigskip','smallskip','noindent',
                  'vfill','hfill','quad','qquad','par','hrulefill'}
DIMENSION_CMDS = {'vspace','hspace','vskip','hskip','addvspace',
                  'rule','hspace*','vspace*'}
INLINE_CMDS = {'textbf':'strong','bfseries':'strong','textit':'emphasis',
               'emph':'emphasis','texttt':'code_inline','underline':'underline',
               'alert':'emphasis','textsc':'small_caps','textnormal':'span'}
TOKEN_PATTERN = re.compile(
    r'\\begin\{([A-Za-z0-9@_*]+)\}|\\\[|\$\$|\\\(|(?<!\\)\$(?!\$)|'
    r'\\(?:includegraphics|smartimage|smartlogo|resizebox|scalebox|adjustbox|parbox|column|ExamImage)\b|'
    r'\\(?:Idea|Practice|DefBlock|Result|Warning|Compare|Question|ExampleBlock)\b|'
    r'\\[A-Za-z@]+'
)
BASE_TIKZ_PREAMBLE = r'''
\documentclass[tikz,border=7pt]{standalone}
\usepackage{amsmath,amssymb,mathtools}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{calc,positioning,arrows.meta,mindmap,shapes,shapes.geometric,fit,backgrounds,decorations.pathreplacing,decorations.markings,patterns,matrix,chains,scopes,trees,angles,quotes}
\usepackage{xcolor}
\definecolor{BrandYellow}{RGB}{255,185,62}
\definecolor{BrandGreen}{RGB}{20,196,134}
\definecolor{BrandBlue}{RGB}{30,60,120}
\definecolor{DarkBG}{RGB}{14,16,20}
\definecolor{DarkFG}{RGB}{235,235,235}
\definecolor{SoftGray}{RGB}{245,246,248}
\definecolor{MediumGray}{RGB}{210,213,218}
\definecolor{DarkGray}{RGB}{45,47,52}
\definecolor{IdeaTitle}{RGB}{30,60,120}
\definecolor{IdeaBody}{RGB}{235,241,255}
\definecolor{PracticeTitle}{RGB}{20,120,90}
\definecolor{PracticeBody}{RGB}{232,250,245}
\definecolor{DefTitle}{RGB}{90,70,160}
\definecolor{DefBody}{RGB}{240,236,255}
\definecolor{ResultTitle}{RGB}{0,120,0}
\definecolor{ResultBody}{RGB}{235,250,235}
\definecolor{WarnTitle}{RGB}{160,30,30}
\definecolor{WarnBody}{RGB}{255,235,235}
\definecolor{CompareTitle}{RGB}{28,92,145}
\definecolor{CompareBody}{RGB}{235,245,252}
\definecolor{QuestionTitle}{RGB}{176,112,20}
\definecolor{QuestionBody}{RGB}{255,247,229}
\definecolor{ExampleTitle}{RGB}{84,78,150}
\definecolor{ExampleBody}{RGB}{243,241,255}
\providecommand{\ok}{\textcolor{green!60!black}{\checkmark}}
\providecommand{\fail}{\textcolor{red}{\times}}
'''


def sha(s: str, n: int=12) -> str:
    return hashlib.sha256(s.encode('utf8')).hexdigest()[:n]


def slug(s: str) -> str:
    t = ''.join(c for c in unicodedata.normalize('NFKD',s) if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+','-',t.lower()).strip('-')[:60] or 'unnamed'


def cmd_at(s: str, i: int) -> tuple[str, int]:
    if i>=len(s) or s[i]!='\\': return '',i
    j=i+1
    if j<len(s) and (s[j].isalpha() or s[j]=='@'):
        while j<len(s) and (s[j].isalpha() or s[j]=='@'): j+=1
        if j<len(s) and s[j]=='*': j+=1
    else: j+=1
    return s[i+1:j],j


def ws(s: str, i: int) -> int:
    while i<len(s) and s[i].isspace(): i+=1
    return i


def group(s: str, i: int, opening='{', closing='}') -> tuple[str,int]:
    if i>=len(s) or s[i]!=opening:
        raise ValueError(f'Expected {opening} at offset {i}: {s[i:i+30]!r}')
    depth=1; j=i+1
    while j<len(s):
        if s[j]=='\\':
            # escaped delimiter is never a closing delimiter
            name,k=cmd_at(s,j)
            if len(name)==1 and name in '{}[]%': j=k; continue
            j+=1; continue
        if s[j]==opening: depth+=1
        elif s[j]==closing:
            depth-=1
            if depth==0: return s[i+1:j],j+1
        j+=1
    raise ValueError(f'Unbalanced {opening}{closing} at {i}')


def maybe_group(s: str,i:int,op='{',cl='}') -> tuple[str|None,int]:
    i=ws(s,i)
    return group(s,i,op,cl) if i<len(s) and s[i]==op else (None,i)


def strip_comments(text: str) -> str:
    """Remove TeX comments except inside verbatim-like environments; preserve newlines."""
    raw_envs=set(CODE_ENVS)
    active=None
    out=[]
    for line in text.splitlines(keepends=True):
        if active:
            out.append(line)
            if re.search(r'\\end\{'+re.escape(active)+r'\}',line): active=None
            continue
        begin=re.search(r'\\begin\{([\w*]+)\}',line)
        if begin and begin.group(1) in raw_envs:
            start_idx=begin.start(); prefix=line[:start_idx]
            # allow normal comments in material before the code environment
            line_prefix=re.sub(r'(?<!\\)%[^\n]*$', '', prefix)
            out.append(line_prefix + line[start_idx:])
            if not re.search(r'\\end\{'+re.escape(begin.group(1))+r'\}',line[begin.end():]):
                active=begin.group(1)
            continue
        acc=[]; i=0
        while i<len(line):
            if line[i]=='%':
                k=i-1
                while k>=0 and line[k]=='\\': k-=1
                if (i-k-1)%2==0:
                    if line.endswith('\n'): acc.append('\n')
                    break
            acc.append(line[i]); i+=1
        out.append(''.join(acc))
    return ''.join(out)


def is_letter_command(s: str,i:int,name:str) -> bool:
    if not s.startswith('\\'+name,i):return False
    j=i+len(name)+1
    return j>=len(s) or not s[j].isalpha()


def latex_plain(s:str) -> str:
    s=re.sub(r'\\(?:texorpdfstring)\s*\{([^{}]*)\}\s*\{([^{}]*)\}',r'\2',s)
    s=re.sub(r'\\(?:textbf|textit|emph|texttt|alert|underline|textsc)\s*\{([^{}]*)\}',r'\1',s)
    s=re.sub(r'\\([{}_%&#$])',r'\1',s)
    s=re.sub(r'\\(?:LaTeX|TeX)\b',lambda m: m.group(0)[1:],s)
    return re.sub(r'\s+',' ',s).strip()


@dataclass
class Macro:
    name: str
    arity: int
    source: str
    body: str


def preamble_definitions(preamble:str) -> tuple[str,dict[str,Macro]]:
    """Collect TikZ-related user definitions without trying to execute TeX."""
    selected=[]; macros={}; i=0
    commands={'newcommand','providecommand','renewcommand','def','pgfmathsetmacro',
              'tikzset','usetikzlibrary','definecolor','colorlet'}
    while i<len(preamble):
        if preamble[i]!='\\': i+=1;continue
        name,j=cmd_at(preamble,i)
        if name not in commands: i=j;continue
        try:
            start=i
            if name in {'newcommand','providecommand','renewcommand'}:
                name_group,j2=maybe_group(preamble,j)
                if name_group is None:
                    j=ws(preamble,j)
                    if preamble[j]!='\\': i=j+1;continue
                    macro_name,j2=cmd_at(preamble,j)
                else:
                    macro_name=name_group.strip().lstrip('\\')
                arity=0
                optional,j3=maybe_group(preamble,j2,'[',']')
                if optional is not None and optional.isdigit():
                    arity=int(optional); j2=j3
                    # default optional argument
                    default,j3=maybe_group(preamble,j2,'[',']')
                    if default is not None: j2=j3
                body,j4=maybe_group(preamble,j2)
                if body is None: i=j2;continue
                if name!='renewcommand' or macro_name not in {'CourseName','CourseCode','Faculty','Institution','Instructor','Email','InstitutionLogo','UseImages'}:
                    selected.append(preamble[start:j4])
                macros[macro_name]=Macro(macro_name,arity,preamble[start:j4],body)
                i=j4;continue
            if name=='def':
                j=ws(preamble,j)
                if j>=len(preamble) or preamble[j]!='\\': i=j+1;continue
                def_name,j2=cmd_at(preamble,j)
                while j2<len(preamble) and preamble[j2]!='{':j2+=1
                value,end=maybe_group(preamble,j2)
                if value is not None: selected.append(preamble[start:end]);i=end;continue
            if name in {'tikzset','usetikzlibrary'}:
                g,end=maybe_group(preamble,j)
                if g is not None:selected.append(preamble[start:end]);i=end;continue
            if name=='pgfmathsetmacro':
                _,j2=maybe_group(preamble,j);_,end=maybe_group(preamble,j2)
                if end>j2:selected.append(preamble[start:end]);i=end;continue
            if name in {'definecolor','colorlet'}:
                _,j2=maybe_group(preamble,j);_,j3=maybe_group(preamble,j2)
                if name=='definecolor':_,j3=maybe_group(preamble,j3)
                if j3>j2:selected.append(preamble[start:j3]);i=j3;continue
        except (ValueError,IndexError): pass
        i=j
    # avoid defining original colors twice; user declarations should win
    return '\n'.join(selected), macros


def normalize_svg(xml_data:bytes) -> bytes:
    """Parse/sanitize SVG, add opaque white background, validate final XML."""
    parser=etree.XMLParser(resolve_entities=False,no_network=True,load_dtd=False,huge_tree=False)
    root=etree.fromstring(xml_data,parser=parser)
    if etree.QName(root).localname!='svg':raise ValueError('Not an SVG root')
    disallowed={'script','foreignObject','iframe','object','embed','animate','set','animateTransform','animateMotion'}
    for el in list(root.iter()):
        if etree.QName(el).localname in disallowed:
            if el.getparent() is not None:el.getparent().remove(el)
            continue
        for att,value in list(el.attrib.items()):
            local=etree.QName(att).localname.lower()
            if local.startswith('on'):
                del el.attrib[att];continue
            if local in {'href','src'}:
                u=value.strip().lower()
                if not (u.startswith('#') or u.startswith('data:image/png;base64,')
                        or u.startswith('data:image/jpeg;base64,')
                        or u.startswith('data:image/webp;base64,')):
                    del el.attrib[att]
            if local=='style' and ('url(http' in value.lower() or 'expression(' in value.lower()):
                del el.attrib[att]
    vb=root.get('viewBox')
    if not vb:
        def measure(a):
            match=re.match(r'([0-9.]+)',root.get(a,'0'))
            return float(match.group(1)) if match else 0.0
        w,h=measure('width'),measure('height')
        if w<=0 or h<=0:raise ValueError('SVG lacks useful width, height and viewBox')
        vb=f'0 0 {w:g} {h:g}';root.set('viewBox',vb)
    parts=re.split(r'[\s,]+',vb.strip())
    if len(parts)!=4:raise ValueError('Invalid viewBox')
    x,y,w,h=(float(a) for a in parts)
    if w<=0 or h<=0:raise ValueError('Invalid SVG dimensions')
    # root inserted rectangle comes after defs, before every visible graphic
    rect=etree.Element('{%s}rect'%XML_NS)
    rect.set('x',f'{x:g}');rect.set('y',f'{y:g}');rect.set('width',f'{w:g}')
    rect.set('height',f'{h:g}');rect.set('fill','#ffffff')
    root.insert(next((i+1 for i,c in enumerate(root) if etree.QName(c).localname=='defs'),0),rect)
    result=etree.tostring(root,encoding='UTF-8',xml_declaration=True)
    etree.fromstring(result,parser=parser)
    return result


def sanitize_tikz(code: str) -> str:
    """Elimina saltos de línea vacíos dentro de corchetes [ ... ] de opciones en TikZ.
    En TeX, una línea en blanco dentro de corchetes se interpreta como \\par, provocando
    '! Paragraph ended before \\pgfkeys@addpath was complete'."""
    lines = code.splitlines(keepends=True)
    out = []
    bracket_depth = 0
    for line in lines:
        stripped = line.strip()
        escaped = False
        for c in line:
            if escaped:
                escaped = False
                continue
            if c == '\\':
                escaped = True
                continue
            if c == '[':
                bracket_depth += 1
            elif c == ']':
                bracket_depth = max(0, bracket_depth - 1)
        if not stripped and bracket_depth > 0:
            continue
        out.append(line)
    return ''.join(out)


class AssetManager:
    def __init__(self,out:pathlib.Path,tex_dir:pathlib.Path,graphics_preamble:str, compile_graphics:bool=True,
                 limit:int=0, overrides:dict|None=None):
        self.out=out; self.src_dir=tex_dir;self.asset_dir=out/'assets';self.asset_dir.mkdir(parents=True,exist_ok=True)
        self.preamble=graphics_preamble;self.compile_graphics=compile_graphics
        self.limit=limit;self.attempted=0;self.overrides=overrides or {}
        self.manifest:dict[str,dict]={};self.warnings=[]
        self.have_latex=shutil.which('pdflatex') is not None
        self.have_svg=shutil.which('pdftocairo') is not None

    def asset_id(self,origin:str,source:str)->str:
        # Macro invocations depend on the exact diagram preamble as well as call args.
        signature=origin+'\n'+source
        if origin in ('tikz','tikz_macro'):
            signature+='\n'+sha(self.preamble)+'\n'+VERSION
        return 'asset-'+sha(signature)

    def add_record(self,origin:str,source:str,status:str,src:str|None,error:str|None=None)->str:
        asset_id=self.asset_id(origin,source)
        record={'id':asset_id,'origin':origin,'source':source,'status':status,'src':src,
                'background':'white','format':'svg'}
        if error:record['error']=error
        self.manifest[asset_id]=record
        return asset_id

    def tikz(self,code:str,origin='tikz')->dict:
        code=sanitize_tikz(code)
        asset_id=self.asset_id(origin,code)
        name=asset_id+'.svg';out=self.asset_dir/name
        if asset_id in self.manifest:return {'type':'figure','assetId':asset_id}
        if out.exists():
            try:normalize_svg(out.read_bytes());self.add_record(origin,code,'resolved','assets/'+name)
            except Exception:out.unlink(missing_ok=True)
            else:return {'type':'figure','assetId':asset_id}
        if not self.compile_graphics or (self.limit and self.attempted>=self.limit):
            reason='Compilación de figuras omitida por configuración'
            self.add_record(origin,code,'pending',None,reason)
            return {'type':'figure','assetId':asset_id}
        self.attempted+=1
        if not (self.have_latex and self.have_svg):
            err='Se requieren pdflatex y pdftocairo para compilar TikZ'
            self.add_record(origin,code,'failed',None,err);self.warnings.append(err)
            return {'type':'figure','assetId':asset_id}
        tex=self.preamble+'\n\\begin{document}\n'+code+'\n\\end{document}\n'
        try:
            with tempfile.TemporaryDirectory(prefix='d3im3r_tikz_') as d:
                tmp=pathlib.Path(d);(tmp/'diagram.tex').write_text(tex,encoding='utf-8')
                # -no-shell-escape is essential; only use on local, trusted .tex files
                run=subprocess.run(['pdflatex','-no-shell-escape','-interaction=nonstopmode',
                                    '-halt-on-error','diagram.tex'],cwd=tmp,stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT,timeout=45)
                pdf=tmp/'diagram.pdf'
                if run.returncode or not pdf.exists():
                    log=run.stdout.decode(errors='replace')
                    errors=re.findall(r'^! .+$',log,re.M)
                    raise RuntimeError(' | '.join(errors[:3]) or log[-450:])
                temp_svg=tmp/'diagram.svg'
                convert=subprocess.run(['pdftocairo','-svg',str(pdf),str(temp_svg)],
                                       cwd=tmp,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=20)
                if convert.returncode or not temp_svg.exists():
                    raise RuntimeError(convert.stderr.decode(errors='replace')[-400:] or 'pdf -> svg failed')
                out.write_bytes(normalize_svg(temp_svg.read_bytes()))
            self.add_record(origin,code,'resolved','assets/'+name)
        except Exception as ex:
            error=f'{type(ex).__name__}: {str(ex)[:300]}'
            self.warnings.append(f'{asset_id}: {error}')
            out.unlink(missing_ok=True)
            self.add_record(origin,code,'failed',None,error)
        return {'type':'figure','assetId':asset_id}

    def external(self,path:str)->dict:
        asset_id='asset-'+sha('external\n'+path)
        if asset_id in self.manifest:return {'type':'figure','assetId':asset_id}
        requested=self.overrides.get(path,path)
        raw=pathlib.Path(requested).expanduser()
        # only simple local source files; no HTTP/network fetching
        candidates=[raw] if raw.is_absolute() else [self.src_dir/raw]
        if not raw.is_absolute():
            home = pathlib.Path.home()
            candidates.extend([
                self.src_dir / 'Template' / raw.name,
                self.src_dir / 'templates' / raw.name,
                self.src_dir / 'img' / raw.name,
                self.src_dir / 'images' / raw.name,
                home / 'Projects/d3im3r-class/public/assets/teaching' / raw.name,
                home / 'Projects/d3im3r-class/content/materials/assets/teaching' / raw.name,
                home / 'Dropbox/Latex/TemplateSlides' / raw,
                home / 'Dropbox/Latex/TemplateSlides/Template' / raw.name,
            ])
        if not raw.suffix:
            candidates += [pathlib.Path(str(c)+ext) for c in list(candidates) for ext in ('.svg','.png','.jpg','.jpeg','.webp','.pdf')]
        found=next((p for p in candidates if p.is_file()),None)
        if not found:
            self.add_record('external',path,'missing',None,'SOURCE_NOT_FOUND')
            self.warnings.append(f'Imagen no encontrada: {path}')
            return {'type':'figure','assetId':asset_id}
        ext=found.suffix.lower(); dest=self.asset_dir/(asset_id+'.svg')
        try:
            if ext=='.svg':dest.write_bytes(normalize_svg(found.read_bytes()))
            elif ext in ('.png','.jpg','.jpeg','.webp'):
                with Image.open(found) as im:
                    w,h=im.size
                    if ext in ('.png','.webp'):
                        buff=BytesIO();im.save(buff,'PNG');mime='image/png'
                    else:
                        buff=BytesIO();im.convert('RGB').save(buff,'JPEG',quality=95);mime='image/jpeg'
                    uri=f'data:{mime};base64,{base64.b64encode(buff.getvalue()).decode()}'
                svg=(f'<svg xmlns="{XML_NS}" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
                     f'<image width="{w}" height="{h}" href="{uri}"/></svg>')
                dest.write_bytes(normalize_svg(svg.encode()))
            elif ext=='.pdf':
                run=subprocess.run(['pdftocairo','-f','1','-l','1','-svg',str(found),str(dest)],
                                   stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=20)
                if run.returncode:raise RuntimeError(run.stderr.decode(errors='replace'))
                dest.write_bytes(normalize_svg(dest.read_bytes()))
            else:raise ValueError('Formato no admitido: '+ext)
            self.add_record('external',path,'resolved','assets/'+dest.name)
        except Exception as ex:
            dest.unlink(missing_ok=True)
            self.add_record('external',path,'failed',None,str(ex)[:300])
            self.warnings.append(f'{path}: {ex}')
        return {'type':'figure','assetId':asset_id}


def trim_layout(text:str)->str:
    # Only formatting-only instructions: do not remove unknown groups or math
    text=re.sub(r'\\(?:vspace|hspace|vskip|hskip|addvspace)\*?\s*\{[^{}]*\}', '',text)
    text=re.sub(r'\\(?:centering|raggedright|raggedleft|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|pause|medskip|bigskip|smallskip|noindent|vfill|hfill|columnbreak|clearpage|newpage|pagebreak|tableofcontents|raggedcolumns)\b','',text)
    text=re.sub(r'\\(?:only|visible|uncover|onslide)<[^>]+>', '',text)
    return text.strip()


def parse_inline(raw:str)->list[dict]:
    nodes=[];buf=[];i=0
    def flush():
        if buf:
            val=''.join(buf)
            val=re.sub(r'[ \t\r\n]+',' ',val)
            if val:nodes.append({'type':'text','value':val})
            buf.clear()
    while i<len(raw):
        ch=raw[i]
        if raw.startswith('$$',i) or raw.startswith(r'\[',i):
            sep='$$' if raw.startswith('$$',i) else r'\['
            stop='$$' if sep=='$$' else r'\]'
            close=raw.find(stop,i+len(sep))
            if close>=0:
                flush();nodes.append({'type':'math_inline','latex':raw[i+len(sep):close].strip()});i=close+len(stop);continue
        if raw.startswith(r'\(',i) or ch=='$' and (i==0 or raw[i-1]!='\\'):
            start=r'\(' if raw.startswith(r'\(',i) else '$'
            end=r'\)' if start==r'\(' else '$'
            p=i+len(start);close=raw.find(end,p)
            if close>=0:
                flush();nodes.append({'type':'math_inline','latex':raw[p:close].strip()});i=close+len(end);continue
        if ch=='\\':
            name,j=cmd_at(raw,i)
            if name in INLINE_CMDS:
                value,k=maybe_group(raw,j)
                if value is not None:
                    flush();nodes.append({'type':INLINE_CMDS[name],'children':parse_inline(value)})
                    i=k;continue
            if name in ('href','textcolor'):
                first,k=maybe_group(raw,j);second,e=maybe_group(raw,k)
                if first is not None and second is not None:
                    flush();nodes.append({'type':'link' if name=='href' else 'span',
                                          'href':first if name=='href' else None,
                                          'children':parse_inline(second)})
                    i=e;continue
            if name=='url':
                first,k=maybe_group(raw,j)
                if first is not None:
                    flush();nodes.append({'type':'link','href':first,'children':[{'type':'text','value':first}]});i=k;continue
            if name in ('LaTeX','TeX'):
                buf.append(name);i=j;continue
            if name in ('%','_','&','#','$','{','}'):
                buf.append(name);i=j;continue
            if name in (',',';','!',' '):
                buf.append(' ');i=j;continue
            if name=='~':buf.append(' ');i=j;continue
            if name in ('newline','\\'):
                flush();nodes.append({'type':'line_break'});i=j;continue
        if raw.startswith('``',i):buf.append('“');i+=2;continue
        if raw.startswith("''",i):buf.append('”');i+=2;continue
        if raw[i]=='~':buf.append('\u00a0');i+=1;continue
        buf.append(ch);i+=1
    flush()
    return nodes


def paragraphs(content:str)->list[dict]:
    s=trim_layout(content)
    if not s:return []
    out=[]
    for p in re.split(r'\n[ \t]*\n+',s):
        p=trim_layout(p)
        if not p:continue
        out.append({'type':'paragraph','children':parse_inline(p)})
    return out


def split_items(body:str)->list[tuple[str|None,str]]:
    """Top-level \\item while preserving nested lists."""
    items=[];depth=0;brace=0;math=False;starts=[];i=0
    while i<len(body):
        if body.startswith(r'\begin{',i):
            j=body.find('}',i+7)
            if j>=0:depth+=1;i=j+1;continue
        if body.startswith(r'\end{',i):
            j=body.find('}',i+5)
            if j>=0:depth=max(0,depth-1);i=j+1;continue
        if body[i]=='\\':
            name,j=cmd_at(body,i)
            if name=='item' and depth==0 and brace==0:
                label,k=maybe_group(body,j,'[',']')
                if starts:
                    previous_label,previous_pos=starts[-1]
                    items.append((previous_label,body[previous_pos:i].strip()))
                starts.append((label,k));i=k;continue
            i=j;continue
        if body[i]=='{':brace+=1
        if body[i]=='}':brace=max(0,brace-1)
        i+=1
    if starts:
        label,pos=starts[-1];items.append((label,body[pos:].strip()))
    return items


def split_table(body:str)->list[list[str]]:
    """Split unescaped & / \\\\ at top level, excluding grouped and math material."""
    rows=[];cells=[];buf=[];brace=0;environments=0;math='';i=0
    def finish_cell():
        cells.append(''.join(buf).strip());buf.clear()
    def finish_row():
        finish_cell()
        if any(c for c in cells):rows.append(cells[:])
        cells.clear()
    while i<len(body):
        if body.startswith(r'\begin{',i):
            j=body.find('}',i+7)
            if j>=0:environments+=1;buf.append(body[i:j+1]);i=j+1;continue
        if body.startswith(r'\end{',i):
            j=body.find('}',i+5)
            if j>=0:environments=max(0,environments-1);buf.append(body[i:j+1]);i=j+1;continue
        if body[i]=='\\':
            name,j=cmd_at(body,i)
            if name=='\\' and brace==0 and environments==0 and not math:
                finish_row();i=j
                _,i2=maybe_group(body,i,'[',']')
                if i2>i:i=i2
                continue
            if name in ('toprule','midrule','bottomrule','hline','cline','addlinespace') and brace==0:
                if name=='cline': _,j=maybe_group(body,j)
                if name=='addlinespace': _,j2=maybe_group(body,j,'[',']'); j=j2
                i=j;continue
            if name in ('(', '[') and not math:math=')' if name=='(' else ']'
            elif name==math:math=''
            buf.append(body[i:j]);i=j;continue
        if body[i]=='$':math='' if math=='$' else '$'
        if body[i]=='{':brace+=1
        if body[i]=='}':brace=max(0,brace-1)
        if body[i]=='&' and brace==0 and environments==0 and not math:
            finish_cell();i+=1;continue
        buf.append(body[i]);i+=1
    if ''.join(buf).strip() or cells:finish_row()
    return rows


def detect_code_language(code: str) -> str:
    s = code.strip()
    if not s:
        return 'text'
    # HTML
    if re.search(r'<!DOCTYPE\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<div[\s>]|<header[\s>]|<nav[\s>]|<p[\s>]|<h[1-6][\s>]|class="[^"]*"|id="[^"]*"', s, re.IGNORECASE):
        return 'html'
    # Python
    if re.search(r'\b(def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|elif\s+|np\.\w+|plt\.\w+|print\s*\()', s):
        return 'python'
    # CSS
    if re.search(r'(?:[.#][\w-]+\s*\{|\b(?:margin|padding|background|color|display|font-size|border)\s*:)', s):
        return 'css'
    # JS / TS
    if re.search(r'\b(function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|console\.(?:log|error)|document\.(?:getElementById|querySelector)|addEventListener)', s):
        return 'javascript'
    # Bash
    if re.search(r'^\s*(?:npm|npx|pnpm|yarn|pip|uv|git|cd|mkdir|rm|apt-get|brew|cargo)\s+', s, re.MULTILINE):
        return 'bash'
    # C / C++
    if re.search(r'\b(#include\s*<|std::|int\s+main\s*\()', s):
        return 'cpp'
    # SQL
    if re.search(r'\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\s+.+\s+SET)\b', s, re.IGNORECASE):
        return 'sql'
    return 'text'


class LessonParser:
    def __init__(self,src:pathlib.Path, assets:AssetManager, macros:dict[str,Macro]):
        self.src=src;self.assets=assets;self.macros=macros
        self.graphics_macros={n:v for n,v in macros.items() if r'\begin{tikzpicture}' in v.body}
        self.diagnostics=[];self.counts=Counter()

    def parse(self,source:str)->dict:
        source=strip_comments(source)
        doc_start=source.find(r'\begin{document}')
        text=source[doc_start+len(r'\begin{document}'): ] if doc_start>=0 else source
        meta=self.metadata(source[:doc_start] if doc_start>=0 else source)
        sections=[]; current_sec=None;current_sub=None
        def new_sec(title:str,implicit=False):
            nonlocal current_sec,current_sub
            current_sec={'id':'sec-'+sha(title+str(len(sections))), 'type':'section',
                         'title':title,'implicit':implicit,'children':[]}
            sections.append(current_sec); current_sub=None
        def add_frame(frame:dict):
            nonlocal current_sec
            if current_sec is None:new_sec('Contenido',implicit=True)
            destination=current_sub['children'] if current_sub is not None else current_sec['children']
            destination.append(frame)
        i=0; title_override=None
        while i<len(text):
            if text[i]!='\\':i+=1;continue
            name,j=cmd_at(text,i)
            if name in ('section','section*','subsection','subsection*'):
                # Ignore navigation-only optional short headings; preserve full heading
                _,j=maybe_group(text,j,'[',']');label,k=maybe_group(text,j)
                if label is not None:
                    heading=latex_plain(label)
                    if name.startswith('subsection'):
                        if current_sec is None:new_sec('Contenido',implicit=True)
                        current_sub={'id':'sub-'+sha(heading+str(len(current_sec['children']))),
                                     'type':'subsection','title':heading,'children':[]}
                        current_sec['children'].append(current_sub)
                    else:new_sec(heading)
                    i=k;continue
            if name=='SectionSlide':
                first,k=maybe_group(text,j);second,end=maybe_group(text,k)
                if first is not None:
                    name_title=latex_plain(first)
                    if not title_override:title_override=name_title
                    # SectionSlide is a decorative slide, not a semantic section.
                    # Existing \section is authoritative; remember its introductory text.
                    if current_sec is not None and not current_sec['children']:
                        current_sec['introTitle']=name_title
                        if second is not None:current_sec['introSubtitle']=latex_plain(second)
                    i=end if second is not None else k;continue
            if name=='begin' and text.startswith('{frame}',j):
                start_line=source[:doc_start+len(r'\begin{document}')+i].count('\n')+1 if doc_start>=0 else source[:i].count('\n')+1
                begin_end=j+len('{frame}')
                _,pos=maybe_group(text,begin_end,'[',']')
                heading,pos2=maybe_group(text,pos)
                if heading is not None:pos=pos2
                stop=text.find(r'\end{frame}',pos)
                if stop<0:
                    self.diagnostics.append({'severity':'error','code':'UNCLOSED_FRAME','line':start_line})
                    break
                body=text[pos:stop]
                if heading is None:
                    m=re.search(r'\\frametitle\s*\{',body)
                    if m:
                        heading,k=group(body,m.end()-1);body=body[:m.start()]+body[k:]
                title=latex_plain(heading or 'Contenido')
                blocks=self.parse_blocks(body)
                lab=re.search(r'\\label\{([^}]+)\}',body)
                stable='frame-'+slug(lab.group(1) if lab else title)+'-'+sha(title+'\n'+body,7)
                frame={'id':stable,'type':'frame','title':title,'sourceLine':start_line,
                       'blocks':blocks}
                if lab:frame['label']=lab.group(1)
                add_frame(frame);self.counts['frames']+=1
                i=stop+len(r'\end{frame}');continue
            i=j
        if not sections: new_sec('Contenido',implicit=True)
        if not meta.get('lessonTitle'):
            meta['lessonTitle']=meta.get('subtitle') or title_override or self.src.stem
        return {'schemaVersion':'1.0.0','id':slug(self.src.stem),'type':'lesson',
                'title':meta['lessonTitle'],'metadata':meta,
                'source':{'file':self.src.name,'template':'beamer'},'structure':sections}

    def metadata(self,head:str)->dict:
        fields={'CourseName':'courseName','CourseCode':'courseCode','Faculty':'faculty',
                'Institution':'institution','Instructor':'instructor','Email':'email',
                'InstitutionLogo':'institutionLogo'}
        info={}
        for name,key in fields.items():
            hits=list(re.finditer(r'\\renewcommand\s*\{\\'+name+r'\}\s*\{',head))
            if hits:
                val,_=group(head,hits[-1].end()-1);info[key]=latex_plain(val)
        for name,key in [('title','originalTitle'),('subtitle','subtitle'),('date','academicPeriod')]:
            hits=list(re.finditer(r'\\'+name+r'\s*\{',head))
            if hits:
                val,_=group(head,hits[-1].end()-1);info[key]=latex_plain(val)
        return info

    def parse_blocks(self,s:str)->list[dict]:
        out=[];cursor=0;idx=0
        while idx<len(s):
            m=TOKEN_PATTERN.search(s,idx)
            if not m:
                out.extend(paragraphs(s[cursor:]));break
            tok=m.group();p=m.start();end=m.end()
            # Inline math must be opaque to the block parser: matrix/cases
            # environments embedded in $...$ or \( ... \) are math, not blocks.
            if tok in ('$', r'\('):
                closer='$' if tok=='$' else r'\)'
                k=s.find(closer,end)
                if k>=0:
                    idx=k+len(closer)
                    continue
            name=tok[1:] if tok.startswith('\\') else tok
            env=m.group(1)
            # Inline commands inside ordinary text should not become structural tokens.
            is_struct=(env is not None or tok in (r'\[','$$') or
                       name in CALLOUTS or name in self.graphics_macros or
                       name in ('includegraphics','smartimage','smartlogo',
                                'resizebox','scalebox','adjustbox','parbox','column','ExamImage'))
            if not is_struct:
                idx=end;continue
            out.extend(paragraphs(s[cursor:p]));cursor=end
            try:
                if env:
                    close=self.find_env_close(s,env,end)
                    if close is None:
                        self.diagnostics.append({'severity':'warning','code':'UNCLOSED_ENV','env':env})
                        out.append({'type':'unsupported','latex':s[p:end],'reason':'UNCLOSED_ENV'})
                        idx=end;cursor=end;continue
                    body_start=end
                    # environment options and mandatory args are inside the body slice
                    body=s[body_start:close[0]]
                    if env=='tikzpicture':
                        out.append(self.assets.tikz(s[p:close[1]]));self.counts['figures']+=1
                    elif env in MATH_ENVS:
                        out.append({'type':'math','latex':s[p:close[1]].strip(),'display':True});self.counts['math']+=1
                    elif env in CODE_ENVS or env.endswith('code') or env.endswith('codedark') or env.endswith('file'):
                        lang=CODE_ENVS.get(env,env.removesuffix('codedark').removesuffix('code') or 'text')
                        filename=None
                        if env.endswith('file'):
                            filename,k=maybe_group(body,0)
                            if filename is not None:body=body[k:]
                        if env=='minted':
                            _,k=maybe_group(body,0,'[',']');raw_lang,k=maybe_group(body,k)
                            if raw_lang is not None:
                                lang=raw_lang.strip().lower()
                                body=body[k:]
                        elif env=='lstlisting':
                            opts,k=maybe_group(body,0,'[',']')
                            if opts:
                                m=re.search(r'language\s*=\s*([A-Za-z0-9_+#]+)',opts,re.IGNORECASE)
                                if m:lang=m.group(1).lower()
                                body=body[k:]
                        body=body.strip('\n')
                        lines=body.splitlines()
                        indentation=min((len(z)-len(z.lstrip(' ')) for z in lines if z.strip()),default=0)
                        code='\n'.join(z[indentation:] if len(z)>=indentation else z for z in lines)
                        lang_aliases={'py':'python','js':'javascript','ts':'typescript','sh':'bash','c++':'cpp'}
                        lang=lang_aliases.get(lang,lang)
                        if lang in ('text','verbatim','') or not lang:
                            detected=detect_code_language(code)
                            if detected!='text':lang=detected
                        code_node={'type':'code','language':lang,'value':code}
                        if filename is not None:code_node['fileName']=latex_plain(filename)
                        out.append(code_node);self.counts['code']+=1
                    elif env in LIST_ENVS:
                        items=[]
                        for item_label,item_body in split_items(body):
                            it={'blocks':self.parse_blocks(item_body)}
                            if item_label is not None:it['label']=latex_plain(item_label)
                            items.append(it)
                        out.append({'type':'list','variant':env,'items':items});self.counts['lists']+=1
                    elif env in ('tabular','tabular*','tabularx','longtable'):
                        _,k=maybe_group(body,0,'[',']')
                        if env in ('tabularx','tabular*'):
                            _,k=maybe_group(body,k)
                        spec,k2=maybe_group(body,k)
                        if spec is not None:k=k2
                        rows=[]
                        for raw_row in split_table(body[k:]):
                            cells=[]
                            for raw_cell in raw_row:
                                raw_cell=raw_cell.strip()
                                colspan=1;rowspan=1
                                for cmd,field in (('multicolumn','colspan'),('multirow','rowspan')):
                                    if raw_cell.startswith('\\'+cmd):
                                        _,j2=cmd_at(raw_cell,0);val,j3=maybe_group(raw_cell,j2)
                                        if val is not None:
                                            try:amount=int(val)
                                            except ValueError:amount=1
                                            if field=='colspan': colspan=amount
                                            else: rowspan=amount
                                            _,j4=maybe_group(raw_cell,j3)
                                            content,j5=maybe_group(raw_cell,j4)
                                            if content is not None:raw_cell=content
                                cells.append({'colspan':colspan,'rowspan':rowspan,
                                              'children':self.parse_blocks(raw_cell)})
                            rows.append(cells)
                        out.append({'type':'table','columnSpec':spec,'rows':rows});self.counts['tables']+=1
                    elif env in CALLOUT_ENVS:
                        title,k=maybe_group(body,0)
                        out.append({'type':'academic_block','variant':CALLOUT_ENVS[env],
                                    'title':latex_plain(title) if title else None,
                                    'children':self.parse_blocks(body[k:])})
                        self.counts['callouts']+=1
                    elif env in LAYOUT_ENVS:
                        if env=='columns':
                            _,k=maybe_group(body,0,'[',']')
                            body=body[k:]
                        if env in ('column','minipage','overlayarea','multicols','multicols*'):
                            _,k=maybe_group(body,0,'[',']')
                            _,k2=maybe_group(body,k)
                            body=body[k2:]
                        if env=='adjustwidth':
                            _,k=maybe_group(body,0)
                            _,k2=maybe_group(body,k)
                            body=body[k2:]
                        out.extend(self.parse_blocks(body))
                    else:
                        # Unknown environment: preserve source for editor, do not lose content
                        self.diagnostics.append({'severity':'warning','code':'UNKNOWN_ENV','env':env})
                        out.append({'type':'unsupported','reason':'UNKNOWN_ENV',
                                    'env':env,'latex':s[p:close[1]],
                                    'children':self.parse_blocks(body)})
                    idx=close[1];cursor=idx;continue
                if tok in (r'\[','$$'):
                    close_delim=r'\]' if tok==r'\[' else '$$'
                    k=s.find(close_delim,end)
                    if k>=0:
                        out.append({'type':'math','latex':s[end:k].strip(),'display':True})
                        self.counts['math']+=1;idx=k+len(close_delim);cursor=idx;continue
                if name in CALLOUTS:
                    title,k=maybe_group(s,end,'[',']')
                    body,j=maybe_group(s,k)
                    if body is not None:
                        out.append({'type':'academic_block','variant':CALLOUTS[name],
                                    'title':latex_plain(title) if title else None,
                                    'children':self.parse_blocks(body)})
                        self.counts['callouts']+=1;idx=j;cursor=j;continue
                if name in self.graphics_macros:
                    macro=self.graphics_macros[name];k=end;full=s[p:k]
                    okay=True
                    for _ in range(macro.arity):
                        arg,j=maybe_group(s,k)
                        if arg is None:okay=False;break
                        full=s[p:j];k=j
                    if okay:
                        out.append(self.assets.tikz(full,origin='tikz_macro'));self.counts['figures']+=1
                        idx=k;cursor=k;continue
                if name in ('includegraphics','smartimage','smartlogo','ExamImage'):
                    _,k=maybe_group(s,end,'[',']');path,j=maybe_group(s,k)
                    if path is not None:
                        out.append(self.assets.external(path.strip()));self.counts['figures']+=1
                        idx=j;cursor=j;continue
                if name=='column':
                    _,k=maybe_group(s,end,'[',']')
                    _,k=maybe_group(s,k)
                    idx=k;cursor=k;continue
                if name in ('resizebox','scalebox','adjustbox','parbox'):
                    k=end
                    if name=='resizebox':
                        _,k=maybe_group(s,k);_,k=maybe_group(s,k)
                    elif name=='scalebox':_,k=maybe_group(s,k)
                    elif name=='adjustbox':_,k=maybe_group(s,k)
                    elif name=='parbox':
                        _,k=maybe_group(s,k,'[',']');_,k=maybe_group(s,k)
                    interior,j=maybe_group(s,k)
                    if interior is not None:
                        out.extend(self.parse_blocks(interior));idx=j;cursor=j;continue
            except (ValueError,IndexError) as ex:
                self.diagnostics.append({'severity':'warning','code':'PARSE_ERROR','offset':p,'message':str(ex)[:140]})
            # Preserve unhandled full command as plain text for admin diagnostics
            out.extend(paragraphs(s[p:end]));idx=end;cursor=end
        if cursor < len(s) and idx >= len(s):
            out.extend(paragraphs(s[cursor:]))
        return [x for x in out if x is not None]

    @staticmethod
    def find_env_close(s:str,env:str,start:int)->tuple[int,int]|None:
        # find balanced environment start/end, matching same environment name
        pattern=re.compile(r'\\(begin|end)\{'+re.escape(env)+r'\}')
        depth=1
        for match in pattern.finditer(s,start):
            depth+=1 if match.group(1)=='begin' else -1
            if depth==0:return match.start(),match.end()
        return None



# ==============================================================================
# Academic Adapters (Guides & Exams)
# ==============================================================================
"""Deterministic adapters for the real TemplateGuide and TemplateExam LaTeX families.

Uses the Beamer v2 semantic parser as the shared block/asset engine.
No generative model and no execution of source-code snippets.
"""

import pathlib
import re
from collections import Counter
from typing import Any

# core is defined locally
import sys
core = sys.modules[__name__]


METADATA = {
    'CourseName':'courseName','CourseCode':'courseCode','Faculty':'faculty',
    'Institution':'institution','Instructor':'instructor','Email':'email',
    'InstitutionLogo':'institutionLogo','AcademicPeriod':'academicPeriod',
    'GuideTitle':'guideTitle','ClassName':'className',
    'ExamTitle':'examTitle','ExamTopics':'examTopics',
    'ExamDuration':'examDuration','ExamValue':'examValue',
    'ExamQuestions':'examQuestions'
}


def extract_metadata(head: str, template_head: str='') -> dict[str,str]:
    """Read explicit metadata; template values are fallback only."""
    values={}
    for content in (core.strip_comments(template_head),core.strip_comments(head)):
        for match in re.finditer(r'\\(?:renewcommand|newcommand|providecommand)\*?\s*\{\s*\\([A-Za-z]+)\s*\}\s*\{',content):
            name=match.group(1)
            if name not in METADATA:continue
            try: val,_=core.group(content,match.end()-1)
            except ValueError:continue
            values[METADATA[name]]=core.latex_plain(val)
    return values


def skip_command(s: str, name: str, n: int=0) -> str:
    """Remove a top-level display command and its arguments; keep all other content."""
    pat=re.compile(r'\\'+re.escape(name)+r'\b')
    out=[];i=0
    for m in pat.finditer(s):
        if m.start()<i:continue
        out.append(s[i:m.start()]);j=m.end()
        try:
            for _ in range(n):
                _,j2=core.maybe_group(s,j)
                if j2==core.ws(s,j):break
                j=j2
        except (IndexError,ValueError):pass
        i=j
    out.append(s[i:]);return ''.join(out)


def find_headings(body: str) -> list[tuple[int,int,str,str,bool]]:
    """Return LaTeX headings outside verbatim/code listings and TikZ figures."""
    out=[];i=0;protected={*core.CODE_ENVS.keys(),'tikzpicture','verbatim'}
    while i<len(body):
        if body[i]!='\\':i+=1;continue
        name,j=core.cmd_at(body,i)
        if name=='begin':
            env,k=core.maybe_group(body,j)
            if env in protected:
                stop=core.LessonParser.find_env_close(body,env,k)
                if stop is not None:i=stop[1];continue
            i=k;continue
        if name.rstrip('*') in ('section','subsection','subsubsection'):
            _,j=core.maybe_group(body,j,'[',']')
            title,k=core.maybe_group(body,j)
            if title is not None:
                out.append((i,k,name.rstrip('*'),core.latex_plain(title),name.endswith('*')))
                i=k;continue
        i=j
    return out


def remove_display_only(body:str) -> str:
    for name in ('GuideHeader','tableofcontents','ExamHeader','StudentInfo',
                 'ExamScore','ExamCompact','ExamStandard','raggedcolumns'):
        body=skip_command(body,name)
    for name in ('thispagestyle','pagestyle'):
        body=skip_command(body,name,1)
    return body


class GuideParser(core.LessonParser):
    """Guide adapter: section hierarchy + guide metadata + checklist nodes."""

    def parse_blocks(self,s:str)->list[dict]:
        # The template defines ChecklistItem as \\item[$\\square$], i.e. not a
        # separate block. Convert to the corresponding list marker before parsing.
        parts=[];i=0
        for m in re.finditer(r'\\ChecklistItem\b',s):
            if m.start()<i:continue
            parts.append(s[i:m.start()]);value,end=core.maybe_group(s,m.end())
            if value is None:
                parts.append(s[m.start():m.end()]);i=m.end();continue
            parts.append(r'\item[☐] '+value+chr(10))
            i=end
        parts.append(s[i:])
        s=''.join(parts)
        nodes=super().parse_blocks(s)
        def mark(obj):
            if isinstance(obj,dict):
                if obj.get('type')=='list' and any(it.get('label')=='☐' for it in obj['items']):
                    obj['variant']='checklist'
                    for it in obj['items']:
                        if it.get('label')=='☐': it.pop('label',None);it['checked']=False
                for v in obj.values():mark(v)
            elif isinstance(obj,list):
                for v in obj:mark(v)
        mark(nodes)
        return nodes

    def parse(self, source:str, defaults:str='') -> dict:
        source=core.strip_comments(source)
        pre,_,body=source.partition(r'\begin{document}')
        metadata=extract_metadata(pre,defaults)
        if not body:body=source
        body=body.split(r'\end{document}',1)[0]
        # GuideInfo{Duracion}{Modalidad}{Evidencia}: metadata, not a visible box.
        m=re.search(r'\\GuideInfo\b',body)
        if m:
            pos=m.end(); args=[]
            for _ in range(3):
                val,pos=core.maybe_group(body,pos)
                if val is None:break
                args.append(core.latex_plain(val))
            if len(args)==3:
                metadata.update(zip(('guideDuration','guideModality','guideEvidence'),args))
                body=body[:m.start()]+body[pos:]
        body=remove_display_only(body)
        headings=find_headings(body)
        structure=[];current_sec=None;current_sub=None;current_subsub=None
        def mk_section(kind,title,starred=False):
            pos=len(structure) if kind=='section' else len(current_sec['children']) if kind=='subsection' else len(current_sub['children'])
            return {'type':kind,'id':kind[:3]+'-'+core.slug(title)+'-'+core.sha(title+'|'+str(pos),7),
                    'title':title,'starred':starred,'blocks':[],'children':[]}
        def add(chunk:str):
            nonlocal current_sec
            if not chunk.strip():return
            blocks=self.parse_blocks(chunk)
            if not blocks:return
            if current_sec is None:
                current_sec=mk_section('section','Contenido inicial');current_sec['implicit']=True
                structure.append(current_sec)
            target=current_subsub or current_sub or current_sec
            target['blocks'].extend(blocks)
        offset=0
        for start,end,kind,title,starred in headings:
            add(body[offset:start])
            if kind=='section':
                current_sec=mk_section(kind,title,starred)
                structure.append(current_sec);current_sub=None;current_subsub=None
            elif kind=='subsection':
                if current_sec is None:
                    current_sec=mk_section('section','Contenido');current_sec['implicit']=True
                    structure.append(current_sec)
                current_sub=mk_section(kind,title,starred)
                current_sec['children'].append(current_sub);current_subsub=None
            else:
                if current_sec is None:
                    current_sec=mk_section('section','Contenido');current_sec['implicit']=True
                    structure.append(current_sec)
                if current_sub is None:
                    current_sub=mk_section('subsection','Contenido');current_sub['implicit']=True
                    current_sec['children'].append(current_sub)
                current_subsub=mk_section(kind,title,starred)
                current_sub['children'].append(current_subsub)
            offset=end
        add(body[offset:])
        return {
            'schemaVersion':'1.1.0', 'id':core.slug(self.src.stem),
            'type':'guide','title':metadata.get('guideTitle',self.src.stem),
            'metadata':metadata,'source':{'file':self.src.name,'template':'guide'},
            'structure':structure
        }


class ExamParser(core.LessonParser):
    """Exam adapter: question, stem, 4-choice answers, instructions, answer sheet."""

    def parse(self,source:str,defaults:str='') -> dict:
        source=core.strip_comments(source)
        pre,_,body=source.partition(r'\begin{document}')
        metadata=extract_metadata(pre,defaults)
        if not body:body=source
        body=body.split(r'\end{document}',1)[0]
        instructions=[]
        m=re.search(r'\\ExamInstructions\b',body)
        if m:
            value,j=core.maybe_group(body,m.end())
            if value is not None:instructions=self.parse_blocks(value)
        answer_sheet=None
        m=re.search(r'\\AnswerSheet\b',body)
        if m:
            count,j=core.maybe_group(body,m.end())
            if count is not None:
                try:answer_sheet=int(count.strip())
                except ValueError:self.diagnostics.append({'severity':'warning','code':'INVALID_ANSWER_SHEET','source':count})
        questions=[];pos=0;counter=0
        pattern=re.compile(r'\\begin\{question\}')
        for match in pattern.finditer(body):
            if match.start()<pos:continue
            stop=self.find_env_close(body,'question',match.end())
            if stop is None:
                self.diagnostics.append({'severity':'error','code':'UNCLOSED_QUESTION','offset':match.start()})
                break
            counter+=1
            raw=body[match.end():stop[0]]
            points=None
            score=re.match(r'\s*\\textbf\s*\{\s*\[\s*(\d+(?:[.,]\d+)?)\s*puntos?\s*\]\s*\}',raw,re.I)
            if score:
                points=float(score.group(1).replace(',','.'))
                if points.is_integer():points=int(points)
                raw=raw[score.end():]
            options=None
            found=[]
            opt_pat=re.compile(r'\\begin\{(answers|inlineanswers|gridanswers)\}')
            for om in opt_pat.finditer(raw):
                if found and om.start()<found[-1][1]:continue
                opt_end=self.find_env_close(raw,om.group(1),om.end())
                if opt_end is None:
                    self.diagnostics.append({'severity':'error','code':'UNCLOSED_ANSWERS','question':counter})
                    continue
                found.append((om.start(),opt_end[1],om.group(1),raw[om.end():opt_end[0]]))
            if len(found)>1:
                self.diagnostics.append({'severity':'warning','code':'MULTIPLE_ANSWER_SETS','question':counter})
            if found:
                a,b,layout,inner=found[0]
                choices=[];cursor=0
                for choice in re.finditer(r'\\answer\b',inner):
                    if choice.start()<cursor:continue
                    value,j=core.maybe_group(inner,choice.end())
                    if value is None:
                        self.diagnostics.append({'severity':'warning','code':'BAD_ANSWER','question':counter})
                        continue
                    choices.append({'label':chr(65+len(choices)) if len(choices)<26 else str(len(choices)+1),
                                    'blocks':self.parse_blocks(value)})
                    cursor=j
                options={'layout':{'answers':'vertical','inlineanswers':'inline','gridanswers':'grid'}[layout],
                         'items':choices}
                tail=raw[b:].strip()
                if tail:
                    self.diagnostics.append({'severity':'warning','code':'QUESTION_TEXT_AFTER_OPTIONS','question':counter})
                stem=self.parse_blocks(raw[:a]+raw[b:])
            else:
                stem=self.parse_blocks(raw)
            node={'id':'q-'+str(counter)+'-'+core.sha(raw,8),'type':'question',
                  'number':counter,'points':points,'stem':stem,'options':options}
            questions.append(node)
            pos=stop[1]
        declared=metadata.get('examQuestions')
        if declared and declared.isdigit() and int(declared)!=len(questions):
            self.diagnostics.append({'severity':'warning','code':'QUESTION_COUNT_MISMATCH',
                                     'declared':int(declared),'actual':len(questions)})
        section={'id':'sec-questions','type':'section','title':'Preguntas',
                 'children':questions,'blocks':[]}
        return {'schemaVersion':'1.1.0','id':core.slug(self.src.stem),
                'type':'exam','title':metadata.get('examTitle',self.src.stem),
                'metadata':metadata,'source':{'file':self.src.name,'template':'exam'},
                'instructions':instructions,'answerSheet':answer_sheet,
                'structure':[section]}

# ==============================================================================
# CLI & Platform Exporter
# ==============================================================================
"""d3im3r-class CLI: deterministic LaTeX -> JSON + SVG for lessons, guides, exams."""

import argparse
import base64
import json
import pathlib
import re
import shutil
from collections import Counter
from datetime import datetime, timezone





def inline_to_text(inlines: list[dict]) -> str:
    res = []
    for node in inlines:
        ntype = node.get('type')
        if ntype == 'text':
            res.append(node.get('value', ''))
        elif ntype == 'code_inline':
            val = inline_to_text(node.get('children', [])) if 'children' in node else node.get('value', '')
            res.append(f'`{val}`')
        elif ntype == 'strong':
            res.append(f"**{inline_to_text(node.get('children', []))}**")
        elif ntype == 'emphasis':
            res.append(f"*{inline_to_text(node.get('children', []))}*")
        elif ntype == 'math_inline':
            res.append(f"${node.get('latex', '')}$")
        elif ntype == 'line_break':
            res.append('\n')
        elif ntype == 'link':
            text = inline_to_text(node.get('children', []))
            res.append(f"[{text}]({node.get('href', '#')})")
        elif 'value' in node:
            res.append(str(node['value']))
    return ''.join(res)


def block_to_ui(block: dict, asset_map: dict[str, dict], out_dir: pathlib.Path, embed_svg: bool = True) -> dict | None:
    btype = block.get('type')
    if btype == 'paragraph':
        content = inline_to_text(block.get('children', []))
        if not content.strip():
            return None
        return {'type': 'text', 'content': content}
    elif btype == 'code':
        return {
            'type': 'code',
            'language': block.get('language', 'text'),
            'content': block.get('value', ''),
            'title': block.get('fileName') or '',
        }
    elif btype == 'math':
        return {'type': 'math', 'content': block.get('latex', '')}
    elif btype == 'academic_block':
        children = [b for b in [block_to_ui(c, asset_map, out_dir, embed_svg) for c in block.get('children', [])] if b]
        return {
            'type': 'callout',
            'variant': block.get('variant', 'idea'),
            'title': block.get('title') or '',
            'children': children,
        }
    elif btype == 'figure':
        aid = block.get('assetId')
        rec = asset_map.get(aid, {})
        asset_rel = rec.get('src')
        data_uri = None
        if asset_rel:
            asset_path = out_dir / asset_rel
            if embed_svg and asset_path.exists() and asset_path.stat().st_size <= 3 * 1024 * 1024:
                mime = 'image/svg+xml'
                b64 = base64.b64encode(asset_path.read_bytes()).decode('ascii')
                data_uri = f'data:{mime};base64,{b64}'
        return {
            'type': 'diagram',
            'asset': data_uri or asset_rel or '',
            'content': rec.get('source', ''),
        }
    elif btype == 'list':
        items = []
        for it in block.get('items', []):
            it_blocks = [b for b in [block_to_ui(c, asset_map, out_dir, embed_svg) for c in it.get('blocks', [])] if b]
            items.append(it_blocks)
        return {
            'type': 'list',
            'variant': block.get('variant', 'itemize'),
            'items': items,
        }
    elif btype == 'table':
        rows = []
        for r in block.get('rows', []):
            row_cells = []
            for cell in r:
                cell_blocks = [b for b in [block_to_ui(c, asset_map, out_dir, embed_svg) for c in cell.get('children', [])] if b]
                text = ' '.join(b.get('content', '') for b in cell_blocks if b.get('content'))
                row_cells.append(text)
            rows.append(row_cells)
        return {
            'type': 'table',
            'rows': rows,
        }
    elif btype == 'unsupported':
        children = [b for b in [block_to_ui(c, asset_map, out_dir, embed_svg) for c in block.get('children', [])] if b]
        return {
            'type': 'text',
            'content': block.get('latex', ''),
            'children': children,
        }
    return None


def generate_clase_json(doc: dict, manager: core.AssetManager, out: pathlib.Path, diagnostics: list, embed_svg: bool = True) -> dict:
    ui_frames = []
    for sec in doc.get('structure', []):
        sec_title = sec.get('title', 'General')
        for child in sec.get('children', []):
            if child.get('type') == 'frame':
                fblocks = [b for b in [block_to_ui(b, manager.manifest, out, embed_svg) for b in child.get('blocks', [])] if b]
                ui_frames.append({
                    'id': child.get('id'),
                    'title': child.get('title', ''),
                    'section': sec_title,
                    'line': child.get('sourceLine', 1),
                    'blocks': fblocks,
                })
            elif child.get('type') == 'subsection':
                subsec_title = child.get('title', sec_title)
                for subchild in child.get('children', []):
                    if subchild.get('type') == 'frame':
                        fblocks = [b for b in [block_to_ui(b, manager.manifest, out, embed_svg) for b in subchild.get('blocks', [])] if b]
                        ui_frames.append({
                            'id': subchild.get('id'),
                            'title': subchild.get('title', ''),
                            'section': subsec_title,
                            'line': subchild.get('sourceLine', 1),
                            'blocks': fblocks,
                        })
    meta = doc.get('metadata', {})
    clase_payload = {
        'id': doc['id'],
        'title': doc['title'],
        'subtitle': meta.get('subtitle', ''),
        'sourceFile': doc.get('source', {}).get('file', ''),
        'exportedAt': datetime.now(timezone.utc).isoformat(),
        'stats': {
            'frames': len(ui_frames),
            'diagrams': sum(1 for a in manager.manifest.values() if a.get('origin') in ('tikz', 'tikz_macro')),
            'images': sum(1 for a in manager.manifest.values() if a.get('origin') == 'external'),
        },
        'diagnostics': [d.get('message', str(d)) if isinstance(d, dict) else str(d) for d in diagnostics],
        'frames': ui_frames,
    }
    return clase_payload


def build(src: pathlib.Path, out: pathlib.Path, kind: str = 'auto', template: pathlib.Path | None = None,
          no_compile: bool = False, max_diagrams: int = 0, overrides: dict | None = None,
          embed_svg: bool = True, zip_output: bool = False) -> dict:
    raw = src.read_text(encoding='utf-8')
    cleaned = core.strip_comments(raw)
    header = cleaned.split(r'\begin{document}', 1)[0]
    if kind == 'auto':
        kind = 'exam' if r'\begin{question}' in cleaned or r'\ExamHeader' in cleaned else (
               'guide' if r'\GuideInfo' in cleaned or r'\GuideHeader' in cleaned else 'lesson')
    if kind not in {'lesson', 'guide', 'exam'}:
        raise ValueError(f'Unsupported document type: {kind}')
    template_text = template.read_text(encoding='utf-8') if template and template.exists() else ''
    if template and not template.is_file():
        raise FileNotFoundError(template)
    src_defs, macros = core.preamble_definitions(header)

    def strip_metadata_definitions(text: str) -> str:
        segments = []; cursor = 0
        for m in re.finditer(r'\\(?:renewcommand|newcommand|providecommand)\s*\{\\([A-Za-z]+)\}', text):
            if m.group(1) not in METADATA:
                continue
            _, end = core.maybe_group(text, m.end())
            segments.append(text[cursor:m.start()]); cursor = end
        segments.append(text[cursor:]); return ''.join(segments)

    src_defs = strip_metadata_definitions(src_defs)
    tpl_defs, _ = core.preamble_definitions(core.strip_comments(template_text))
    relevant = []
    for m in re.finditer(r'\\(definecolor|colorlet|tikzset|usetikzlibrary)\b', tpl_defs):
        graphic_kind = m.group(1)
        n = 3 if graphic_kind == 'definecolor' else 2 if graphic_kind == 'colorlet' else 1
        end = m.end()
        for _ in range(n):
            value, k = core.maybe_group(tpl_defs, end)
            if value is None:
                break
            end = k
        else:
            relevant.append(tpl_defs[m.start():end])
    extra = '\n'.join(relevant)
    graphics = core.BASE_TIKZ_PREAMBLE + '\n' + extra + '\n' + src_defs
    out.mkdir(parents=True, exist_ok=True)
    manager = core.AssetManager(out, src.parent, graphics, not no_compile, max_diagrams, overrides)

    if kind == 'lesson':
        parser = core.LessonParser(src, manager, macros)
        doc = parser.parse(raw)
    elif kind == 'guide':
        parser = GuideParser(src, manager, macros)
        doc = parser.parse(raw, template_text)
    else:
        parser = ExamParser(src, manager, macros)
        doc = parser.parse(raw, template_text)

    if kind in ('guide', 'exam'):
        logo = doc['metadata'].get('institutionLogo')
        if logo:
            ref = manager.external(logo)
            doc['metadata']['institutionLogoAssetId'] = ref['assetId']

    manifest = {'schemaVersion': '1.1.0', 'documentId': doc['id'], 'assets': list(manager.manifest.values())}
    diagnostics = parser.diagnostics + [{'severity': 'warning', 'code': 'ASSET', 'message': x} for x in manager.warnings]
    counts = Counter()

    def walk(x):
        if isinstance(x, dict):
            if 'type' in x:
                counts[x['type']] += 1
            for value in x.values():
                walk(value)
        elif isinstance(x, list):
            for value in x:
                walk(value)

    walk(doc['structure'])
    if 'instructions' in doc:
        walk(doc['instructions'])

    report = {
        'schemaVersion': '1.1.0',
        'generator': core.VERSION,
        'documentType': kind,
        'source': src.name,
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'counts': dict(counts),
        'assets': dict(Counter(r['status'] for r in manifest['assets'])),
        'diagnostics': diagnostics,
    }

    for name, value in [('document.json', doc), ('assets.json', manifest), ('build-report.json', report)]:
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # Si es clase/lesson, generar clase.json para compatibilidad inmediata con visor web
    if kind == 'lesson':
        clase_payload = generate_clase_json(doc, manager, out, diagnostics, embed_svg=embed_svg)
        (out / 'clase.json').write_text(json.dumps(clase_payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # Empaquetar en ZIP si se solicita
    if zip_output:
        zip_base = str(out)
        zip_path = shutil.make_archive(zip_base, 'zip', root_dir=out)
        report['zip'] = zip_path

    return report


def main():
    cli = argparse.ArgumentParser(description='d3im3r-class v3: Parser LaTeX académico determinista (clases Beamer, guías de taller y exámenes)')
    cli.add_argument('tex', type=pathlib.Path, help='Ruta al archivo .tex')
    cli.add_argument('--type', choices=['auto', 'lesson', 'guide', 'exam'], default='auto', help='Tipo de documento (por defecto: auto)')
    cli.add_argument('--template', type=pathlib.Path, help='Ruta a template-guide.tex o template-exam.tex')
    cli.add_argument('-o', '--output', type=pathlib.Path, help='Directorio de salida (por defecto: <nombre>_export)')
    cli.add_argument('-z', '--zip', action='store_true', help='Generar paquete .zip listo para cargar a la plataforma')
    cli.add_argument('--no-compile', action='store_true', help='Registrar figuras sin compilar TikZ')
    cli.add_argument('--no-embed', action='store_true', help='No embeber SVGs en data-URI dentro de clase.json')
    cli.add_argument('--max-diagrams', type=int, default=0, help='Límite de compilaciones gráficas (0 = todas)')
    cli.add_argument('--overrides', type=pathlib.Path, help='JSON mapa de imágenes faltantes a sustitutos locales')
    args = cli.parse_args()

    src = args.tex.resolve()
    out = (args.output or (src.parent / (src.stem + '_export'))).resolve()
    if not src.is_file():
        cli.error(f'No existe el archivo {src}')

    resolved_type = args.type
    if resolved_type == 'auto':
        text = core.strip_comments(src.read_text(encoding='utf-8'))
        resolved_type = 'exam' if r'\begin{question}' in text or r'\ExamHeader' in text else (
                        'guide' if r'\GuideInfo' in text or r'\GuideHeader' in text else 'lesson')

    # Auto-búsqueda del template apropiado si no se especificó
    if resolved_type in ('guide', 'exam') and args.template is None:
        tpl_name = 'template-exam.tex' if resolved_type == 'exam' else 'template-guide.tex'
        candidates = [
            src.parent / tpl_name,
            pathlib.Path(__file__).resolve().parent / 'templates' / tpl_name,
            pathlib.Path(__file__).resolve().parent / tpl_name,
        ]
        found_tpl = next((c for c in candidates if c.is_file()), None)
        if found_tpl:
            args.template = found_tpl

    overrides = json.loads(args.overrides.read_text(encoding='utf-8')) if args.overrides else None

    print(f"\033[94m=====================================================================\033[0m")
    print(f"\033[92m  d3im3r-class v3 - Compilador Académico ({resolved_type.upper()})\033[0m")
    print(f"\033[94m=====================================================================\033[0m")
    print(f"📄 Archivo fuente: \033[1m{src.name}\033[0m")
    print(f"📁 Directorio destino: \033[1m{out}\033[0m")

    report = build(
        src=src,
        out=out,
        kind=resolved_type,
        template=args.template.resolve() if args.template else None,
        no_compile=args.no_compile,
        max_diagrams=args.max_diagrams,
        overrides=overrides,
        embed_svg=not args.no_embed,
        zip_output=args.zip,
    )

    counts = report['counts']
    print(f"\n\033[92m✅ Exportación completada con éxito:\033[0m")
    print(f"   • Tipo: \033[1m{report['documentType']}\033[0m")
    if 'frame' in counts:
        print(f"   • Diapositivas / Frames: \033[1m{counts['frame']}\033[0m")
    if 'question' in counts:
        print(f"   • Preguntas estructuradas: \033[1m{counts['question']}\033[0m")
    if 'section' in counts:
        print(f"   • Secciones: \033[1m{counts['section']}\033[0m")
    if 'code' in counts:
        print(f"   • Bloques de código: \033[1m{counts['code']}\033[0m")
    if 'academic_block' in counts:
        print(f"   • Bloques docentes / callouts: \033[1m{counts['academic_block']}\033[0m")
    print(f"   • Figuras / Assets: \033[1m{report.get('assets', {})}\033[0m")
    print(f"   • Archivos generados: \033[1mdocument.json, assets.json, build-report.json" + (", clase.json" if resolved_type == 'lesson' else "") + "\033[0m")

    if args.zip and report.get('zip'):
        print(f"\n📦 Paquete ZIP listo para subir a la plataforma:")
        print(f"   👉 \033[1m{report['zip']}\033[0m")

    if report['diagnostics']:
        warnings = [d for d in report['diagnostics'] if (isinstance(d, dict) and d.get('severity') == 'warning') or not isinstance(d, dict)]
        if warnings:
            print(f"\n\033[93m⚠️  Diagnósticos / Advertencias ({len(warnings)}):\033[0m")
            for w in warnings[:5]:
                msg = w.get('message') if isinstance(w, dict) else str(w)
                print(f"   - {msg}")
            if len(warnings) > 5:
                print(f"   ... y {len(warnings) - 5} más (ver build-report.json)")

    print(f"\n\033[92mListo.\033[0m\n")


if __name__ == '__main__':
    main()