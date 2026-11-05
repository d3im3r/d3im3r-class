"""Restricted TikZ worker: JSON stdin, JSON stdout. Only figures from authenticated imports."""
import json,sys,re,pathlib,subprocess,tempfile,os,hashlib
request=json.load(sys.stdin)
preamble=pathlib.Path('content/resources/latex/diagram-preamble.tex').read_text()
output=pathlib.Path(request['output']).resolve();output.mkdir(parents=True,exist_ok=True)

BLOCKED_COMMANDS = {
    'input', 'include', 'openin', 'openout', 'read', 'write', 'immediate',
    'newwrite', 'newread', 'closein', 'closeout', 'catcode', 'catcodetable',
    'lccode', 'uccode', 'csname', 'endcsname', 'def', 'gdef', 'edef', 'xdef',
    'let', 'futurelet', 'directlua', 'luaescapestring', 'shellescape', 'sys',
    'special', 'font', 'everypar', 'everyjob', 'errhelp', 'batchmode'
}

ALLOWED_ENVS = {
    'tikzpicture', 'scope', 'pgfpicture',
    'axis', 'semilogxaxis', 'semilogyaxis', 'loglogaxis',
    'matrix', 'array', 'cases', 'aligned', 'align', 'align*', 'gather', 'gather*',
    'equation', 'equation*', 'tabular', 'center', 'table', 'minipage',
    'bmatrix', 'pmatrix', 'vmatrix', 'Bmatrix', 'Vmatrix'
}

results={};errors=[]
for index,source in enumerate(request['figures'][:60],start=1):
    key=hashlib.sha256(source.encode()).hexdigest()
    scanned=re.sub(r'(?<!\\)%[^\n]*','',source)
    scanned_clean=re.sub(r'\\\\',' ',scanned)
    commands={m.group(1).lower() for m in re.finditer(r'\\([A-Za-z]+)',scanned_clean)}
    dangerous=commands & BLOCKED_COMMANDS
    envs={e.strip() for e in re.findall(r'\\(?:begin|end)\{([^}]+)\}',source)}
    disallowed_envs={e for e in envs if e not in ALLOWED_ENVS}
    if '^^' in source or dangerous or disallowed_envs:
        reasons=[]
        if '^^' in source:
            reasons.append('secuencias de escape ^^ no permitidas')
        if dangerous:
            reasons.append('comandos que requieren revisión: '+', '.join(sorted(dangerous)))
        if disallowed_envs:
            reasons.append('entornos no admitidos: '+', '.join(sorted(disallowed_envs)))
        errors.append({'hash':key,'message':f'Diagrama {index}: '+'; '.join(reasons)})
        continue

    with tempfile.TemporaryDirectory(prefix='aula-import-') as td:
        work=pathlib.Path(td)
        (work/'figure.tex').write_text(preamble+'\n'+r'\begin{document}'+'\n'+source+'\n'+r'\end{document}')
        env={**os.environ,'openin_any':'p','openout_any':'p'}
        try:
            subprocess.run(['xelatex','-no-shell-escape','-interaction=nonstopmode','-halt-on-error','figure.tex'],
                           cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=25)
            dest=output/(key+'.svg')
            subprocess.run(['dvisvgm','--pdf','--no-fonts','--exact-bbox','--scale=1.35','--output='+str(dest),'figure.pdf'],
                           cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=15)
            results[key]=str(dest)
        except subprocess.CalledProcessError as error:
            log=(error.stdout or b'').decode(errors='replace')
            lines=log.splitlines()
            detail=next((line.strip() for line in lines if line.startswith('!')),'Error de sintaxis o paquete no disponible.')
            errors.append({
                'hash':key,
                'message':f'Diagrama {index}: '+detail,
                'log':'\n'.join(lines[-65:])[-7000:],
                'line':max(1,int(re.search(r'(?m)^l\.(\d+)',log).group(1))-preamble.count('\n')-2) if re.search(r'(?m)^l\.(\d+)',log) else None
            })
        except subprocess.TimeoutExpired:
            errors.append({'hash':key,'message':f'Diagrama {index}: se superó el tiempo máximo de compilación.'})
        except FileNotFoundError:
            errors.append({'hash':key,'message':f'Diagrama {index}: XeLaTeX o dvisvgm no están disponibles.'})

json.dump({'results':results,'errors':errors},sys.stdout)
