"""Restricted TikZ worker: JSON stdin, JSON stdout. Only figures from authenticated imports."""
import json,sys,re,pathlib,subprocess,tempfile,os,hashlib,shutil
import xml.etree.ElementTree as ET
request=json.load(sys.stdin)
preamble=pathlib.Path('content/resources/latex/diagram-preamble.tex').read_text()
output=pathlib.Path(request['output']).resolve();output.mkdir(parents=True,exist_ok=True)

def apply_svg_background(svg_path: pathlib.Path):
    try:
        svg_text = svg_path.read_text(encoding='utf-8')
        root = ET.fromstring(svg_text)
        viewbox = root.attrib.get('viewBox')
        if viewbox:
            values = [float(v) for v in re.split(r'[\s,]+', viewbox.strip())]
            if len(values) == 4:
                x, y, width, height = values
                rect = f'\n  <rect x="{x:g}" y="{y:g}" width="{width:g}" height="{height:g}" fill="#ffffff" stroke="none"/>\n'
                opening = re.search(r'<svg\b[^>]*>', svg_text, re.DOTALL)
                if opening:
                    svg_path.write_text(svg_text[:opening.end()] + rect + svg_text[opening.end():], encoding='utf-8')
    except Exception:
        pass

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
        dest=output/(key+'.svg')
        try:
            compiled = False
            # 1. Preferir XeLaTeX + Inkscape (máxima nitidez vectorial, bounding box exacto y texto a trazados)
            if shutil.which('xelatex') and shutil.which('inkscape'):
                try:
                    r_xe = subprocess.run(
                        ['xelatex', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'figure.tex'],
                        cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25
                    )
                    pdf_file = work / 'figure.pdf'
                    if r_xe.returncode == 0 and pdf_file.exists():
                        r_ink = subprocess.run(
                            ['inkscape', str(pdf_file), '--export-area-drawing', f'--export-filename={dest}', '--export-text-to-path'],
                            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15
                        )
                        if r_ink.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
                            apply_svg_background(dest)
                            results[key] = str(dest)
                            compiled = True
                except Exception:
                    pass

            # 2. Fallback a latex + dvisvgm si no hay Inkscape
            if not compiled and shutil.which('latex') and shutil.which('dvisvgm'):
                r_latex = subprocess.run(
                    ['latex', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'figure.tex'],
                    cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25
                )
                if r_latex.returncode == 0 and (work/'figure.dvi').exists():
                    r_svg = subprocess.run(
                        ['dvisvgm', '--no-fonts', '--exact-bbox', '--scale=1.35', '--output='+str(dest), 'figure.dvi'],
                        cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15
                    )
                    if r_svg.returncode == 0 and dest.exists():
                        results[key]=str(dest)
                        compiled = True

            # 3. Fallback a xelatex + dvisvgm
            if not compiled and shutil.which('xelatex') and shutil.which('dvisvgm'):
                r_xe = subprocess.run(
                    ['xelatex', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'figure.tex'],
                    cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True, timeout=25
                )
                subprocess.run(
                    ['dvisvgm', '--pdf', '--no-fonts', '--exact-bbox', '--scale=1.35', '--output='+str(dest), 'figure.pdf'],
                    cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True, timeout=15
                )
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
            errors.append({'hash':key,'message':f'Diagrama {index}: LaTeX o dvisvgm no están disponibles.'})

json.dump({'results':results,'errors':errors},sys.stdout)
