"""Restricted TikZ worker: JSON stdin, JSON stdout. Only figures from authenticated imports."""
import json,sys,re,pathlib,subprocess,tempfile,os,hashlib
request=json.load(sys.stdin)
preamble=pathlib.Path('content/resources/latex/diagram-preamble.tex').read_text()
output=pathlib.Path(request['output']).resolve();output.mkdir(parents=True,exist_ok=True)
# No arbitrary macro definitions, IO primitives, control-sequence construction or TeX escaping.
allowed=set('begin end node draw fill filldraw path coordinate foreach pgfmathsetmacro tikzset text textbf texttt textit scriptsize footnotesize small large Large centering color textcolor linewidth textwidth theta omega pi alpha beta gamma delta epsilon sigma mu phi psi atan atanTwo operatorname sin cos tan sqrt frac dfrac vec mathbf mathrm mathcal left right underbrace overbrace boxed boldsymbol mathit mathsf mathtt mathbb textnormal ensuremath hat widehat bar overline underline tilde widetilde dot ddot prime perp parallel angle Vert vert lVert rVert lvert rvert sin cos tan arctan arcsin arccos log ln exp det min max sum prod int partial nabla forall exists in notin subset subseteq cup cap degree coloneqq sim simeq equiv ldots dots cdots vdots ddots binom sb sp frac dfrac tfrac overset underset substack displaystyle textstyle scriptstyle tiny normalsize bfseries itshape thinspace phantom vphantom hphantom textbackslash times cdot pm mp div leq geq neq approx infty rightarrow leftarrow longrightarrow downarrow uparrow to ldots cdots quad qquad ok fail faCheck faTimes x y z Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split())
results={};errors=[]
for index,source in enumerate(request['figures'][:60],start=1):
 key=hashlib.sha256(source.encode()).hexdigest();scanned=re.sub(r'(?<!\\)%[^\n]*','',source);commands={m.group(1) for m in re.finditer(r'\\(?:([A-Za-z]+)|[^A-Za-z])',scanned) if m.group(1)}
 envs=re.findall(r'\\(?:begin|end)\{([^}]+)\}',source)
 unknown=commands-allowed
 if '^^' in source or unknown or any(e not in ['tikzpicture','scope','matrix','array','bmatrix','pmatrix'] for e in envs):
  errors.append({'hash':key,'message':f'Diagrama {index}: comandos que requieren revisión: '+', '.join(sorted(unknown))});continue
 with tempfile.TemporaryDirectory(prefix='aula-import-') as td:
  work=pathlib.Path(td);(work/'figure.tex').write_text(preamble+'\n'+r'\begin{document}'+'\n'+source+'\n'+r'\end{document}')
  env={**os.environ,'openin_any':'p','openout_any':'p'}
  try:
   subprocess.run(['xelatex','-no-shell-escape','-interaction=nonstopmode','-halt-on-error','figure.tex'],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=25)
   dest=output/(key+'.svg');subprocess.run(['dvisvgm','--pdf','--no-fonts','--exact-bbox','--scale=1.35','--output='+str(dest),'figure.pdf'],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=15)
   results[key]=str(dest)
  except subprocess.CalledProcessError as error:
   log=(error.stdout or b'').decode(errors='replace');lines=log.splitlines();detail=next((line.strip() for line in lines if line.startswith('!')),'Error de sintaxis o paquete no disponible.')
   errors.append({'hash':key,'message':f'Diagrama {index}: '+detail,'log':'\n'.join(lines[-65:])[-7000:],'line':max(1,int(re.search(r'(?m)^l\.(\d+)',log).group(1))-preamble.count('\n')-2) if re.search(r'(?m)^l\.(\d+)',log) else None})
  except subprocess.TimeoutExpired:errors.append({'hash':key,'message':f'Diagrama {index}: se superó el tiempo máximo de compilación.'})
  except FileNotFoundError:errors.append({'hash':key,'message':f'Diagrama {index}: XeLaTeX o dvisvgm no están disponibles.'})
json.dump({'results':results,'errors':errors},sys.stdout)
