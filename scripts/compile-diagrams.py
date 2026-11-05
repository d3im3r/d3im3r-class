"""Compile only extracted TikZ figures, with no shell escape. Results are cached."""
import concurrent.futures,hashlib,json,pathlib,re,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
template=(root/'content/templates/template-slide.tex').read_text()
colors='\n'.join(re.findall(r'\\definecolor\{[^}]+\}\{[^}]+\}\{[^}]+\}',template))
preamble=r'''\documentclass[tikz,border=8pt]{standalone}
\usepackage{amsmath,amssymb}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{calc,positioning,arrows.meta,mindmap,shapes,shapes.geometric,fit,backgrounds,decorations.pathreplacing,decorations.markings,patterns,matrix,chains,scopes,trees}
\usepackage{xcolor}
\providecommand{\ok}{\textcolor{green!60!black}{\checkmark}}
\providecommand{\fail}{\textcolor{red}{\times}}
'''+colors+'\n'
(root/'content/resources/latex/diagram-preamble.tex').write_text(preamble)
output=root/'content/materials/assets/diagrams';output.mkdir(parents=True,exist_ok=True)
catalog=json.loads((root/'content/generated.json').read_text());figures={}
def collect(blocks):
 for b in blocks:
  if b['type']=='diagram':figures[hashlib.sha256(b['content'].encode()).hexdigest()]=b['content']
  collect(b.get('children',[]))
  for item in b.get('items',[]):collect(item)
for lesson in catalog['lessons']:
 for frame in lesson['frames']:collect(frame['blocks'])
def compile_one(item):
 key,source=item;dest=output/(key+'.svg');stamp=output/(key+'.sha256');digest=hashlib.sha256((preamble+source).encode()).hexdigest()
 if dest.exists() and stamp.exists() and stamp.read_text()==digest:return key,'cached'
 with tempfile.TemporaryDirectory(prefix='aula-tikz-') as td:
  work=pathlib.Path(td);(work/'figure.tex').write_text(preamble+'\n\\begin{document}\n'+source+'\n\\end{document}')
  try:
   r_tex = subprocess.run(['latex','-no-shell-escape','-interaction=nonstopmode','-halt-on-error','figure.tex'],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
   if r_tex.returncode == 0 and (work/'figure.dvi').exists():
    subprocess.run(['dvisvgm','--no-fonts','--exact-bbox','--output='+str(dest),'figure.dvi'],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=30)
   else:
    subprocess.run(['xelatex','-no-shell-escape','-interaction=nonstopmode','-halt-on-error','figure.tex'],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=45)
    subprocess.run(['dvisvgm','--pdf','--no-fonts','--exact-bbox','--output='+str(dest),'figure.pdf'],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=30)
   stamp.write_text(digest);return key,'ok'
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as e:
   log=(getattr(e,'stdout',b'') or b'').decode(errors='replace');return key,'FAILED: '+log[-1800:]
results={};failures=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for key,status in pool.map(compile_one,figures.items()):
  if status.startswith('FAILED'):failures.append({'hash':key,'error':status})
  else:results[key]='/assets/diagrams/'+key+'.svg'
(root/'content/resources/diagram-manifest.json').write_text(json.dumps(results,indent=2))
(root/'content/resources/diagram-diagnostics.json').write_text(json.dumps(failures,indent=2))
print(f'Diagramas: {len(results)}/{len(figures)} compilados; {len(failures)} errores',flush=True)
for f in failures:print(f['hash'][:12],f['error'],flush=True)
if failures:raise SystemExit(1)
