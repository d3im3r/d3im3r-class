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


def build(src:pathlib.Path,out:pathlib.Path, no_compile:bool=False,max_diagrams:int=0,overrides:dict|None=None)->dict:
    raw=src.read_text(encoding='utf8')
    cleaned=strip_comments(raw)
    pre_doc=cleaned.split(r'\begin{document}',1)[0]
    latex_macros,macros=preamble_definitions(pre_doc)
    preamble=BASE_TIKZ_PREAMBLE+'\n'+latex_macros
    out.mkdir(parents=True,exist_ok=True)
    assets=AssetManager(out,src.parent,preamble,not no_compile,max_diagrams,overrides)
    parser=LessonParser(src,assets,macros)
    doc=parser.parse(raw)
    manifest={'schemaVersion':'1.0.0','documentId':doc['id'],
              'assets':list(assets.manifest.values())}
    diagnostics=parser.diagnostics + [{'severity':'warning','code':'ASSET','message':x} for x in assets.warnings]
    counts=Counter()
    def walk(node):
        if isinstance(node,dict):
            if 'type' in node:counts[node['type']]+=1
            for v in node.values():walk(v)
        elif isinstance(node,list):
            for v in node:walk(v)
    walk(doc['structure'])
    report={'schemaVersion':'1.0.0','generator':VERSION,'source':src.name,
            'createdAt':datetime.now(timezone.utc).isoformat(),
            'counts':dict(counts),'assets':dict(Counter(r['status'] for r in manifest['assets'])),
            'diagnostics':diagnostics}
    for name,payload in [('document.json',doc),('assets.json',manifest),('build-report.json',report)]:
        (out/name).write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return report


def main():
    cli=argparse.ArgumentParser(description='Parser LaTeX Beamer -> JSON semántico + SVG; sin IA')
    cli.add_argument('tex',type=pathlib.Path)
    cli.add_argument('-o','--output',type=pathlib.Path)
    cli.add_argument('--no-compile',action='store_true',help='Estructura sin compilar TikZ')
    cli.add_argument('--max-diagrams',type=int,default=0,help='Limitar compilaciones; 0=todas')
    cli.add_argument('--overrides',type=pathlib.Path,help='JSON rutas de imagen fuente -> ruta sustituta')
    args=cli.parse_args()
    src=args.tex.resolve();out=(args.output or src.parent/(src.stem+'_v2')).resolve()
    if not src.is_file():cli.error(f'Archivo no encontrado: {src}')
    overrides=json.loads(args.overrides.read_text()) if args.overrides else None
    report=build(src,out,args.no_compile,args.max_diagrams,overrides)
    print(json.dumps({'source':src.name,'out':str(out),'counts':report['counts'],
                      'assets':report['assets'],'warnings':len(report['diagnostics'])},
                     indent=2,ensure_ascii=False))


if __name__=='__main__':main()
