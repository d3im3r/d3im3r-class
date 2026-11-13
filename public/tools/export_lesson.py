#!/usr/bin/env python3
"""
academix-latex-exporter: Herramienta local para compilar y exportar clases LaTeX a JSON + SVGs.

Uso:
    python scripts/export_lesson.py ruta/a/mi_clase.tex [opciones]

Opciones:
    -o, --output DIR       Directorio de salida (por defecto: <nombre_clase>_export)
    -z, --zip              Genera un archivo .zip listo para cargar a la plataforma
    --no-embed             No embebe los SVGs en base64/data-URI (solo genera archivos en assets/)
    --keep-tmp             Conserva archivos temporales de compilación para depuración
"""

import argparse
import base64
import glob
import hashlib
import json
import mimetypes
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from datetime import datetime

# ==============================================================================
# Preámbulo LaTeX enriquecido para compilación de TikZ y diagramas
# ==============================================================================
TIKZ_PREAMBLE = r"""\documentclass[tikz,border=10pt]{standalone}
\usepackage{amsmath,amssymb}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{calc,positioning,arrows.meta,mindmap,shapes,shapes.geometric,fit,backgrounds,decorations.pathreplacing,decorations.markings,patterns,matrix,chains,scopes,trees}
\usepackage{xcolor}
\providecommand{\ok}{\textcolor{green!60!black}{\checkmark}}
\providecommand{\fail}{\textcolor{red}{\times}}

% Paleta de colores estándar Aula / Academix
\definecolor{BrandYellow}{RGB}{255,185,62}
\definecolor{BrandGreen}{RGB}{20,196,134}
\definecolor{BrandBlue}{RGB}{30,60,120}
\definecolor{DarkBG}{RGB}{14,16,20}
\definecolor{DarkFG}{RGB}{235,235,235}
\definecolor{SoftGray}{RGB}{245,246,248}
\definecolor{MediumGray}{RGB}{210,213,218}
\definecolor{DarkGray}{RGB}{45,47,52}
\definecolor{pybg}{rgb}{0.12,0.18,0.30}
\definecolor{cppbg}{rgb}{0.10,0.10,0.10}
\definecolor{bashbg}{rgb}{0.2,0.2,0.2}

% Callouts pedagógicos
\definecolor{WarningBody}{RGB}{255,243,205}
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
"""

CODE_LANGUAGES = {
    'python': 'python',
    'pythoncode': 'python',
    'pythoncodedark': 'python',
    'javascript': 'javascript',
    'jscode': 'javascript',
    'js': 'javascript',
    'html': 'html',
    'htmlcode': 'html',
    'css': 'css',
    'csscode': 'css',
    'cpp': 'cpp',
    'cppcode': 'cpp',
    'c': 'cpp',
    'bash': 'bash',
    'bashcode': 'bash',
    'sql': 'sql',
    'sqlcode': 'sql',
    'json': 'json',
    'jsoncode': 'json',
    'console': 'text',
}

MATH_ENVS = {
    'align', 'align*', 'gather', 'gather*', 'equation', 'equation*',
    'multline', 'multline*', 'alignat', 'alignat*', 'matrix', 'pmatrix',
    'bmatrix', 'vmatrix', 'cases'
}

# ==============================================================================
# Limpieza y parsing de texto LaTeX
# ==============================================================================
def clean_layout(text: str) -> str:
    """Limpia comandos de espaciado y estructura de diapositiva innecesarios."""
    if not text:
        return ''
    s = re.sub(r'(?<!\\)%[^\n]*', '', text)
    # Beamer column environments y macros
    s = re.sub(r'\\begin\{columns\}\s*(?:\[[^\]]*\])?', '', s)
    s = re.sub(r'\\end\{columns\}', '', s)
    s = re.sub(r'\\begin\{column\}\s*(?:\[[^\]]*\])?\s*\{[^}]*\}', '', s)
    s = re.sub(r'\\end\{column\}', '', s)
    s = re.sub(r'\\column\s*(?:\[[^\]]*\])?\s*\{[^}]*\}', '', s)
    s = re.sub(r'\\column\b', '', s)
    s = re.sub(r'\\(?:vspace|hspace)\*?\{[^}]*\}', '', s)
    s = re.sub(r'\\(?:begin|end)\{(?:center|columns|column|minipage)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?', '', s)
    s = re.sub(
        r'\\(?:centering|tiny|small|large|Large|LARGE|huge|Huge|footnotesize|scriptsize|normalsize|medskip|bigskip|smallskip|pause)\b',
        '',
        s
    )
    s = re.sub(r'\\texorpdfstring\{([^{}]*)\}\{([^{}]*)\}', r'\2', s)

    # Remanentes de parámetros y anchos de columnas Beamer: [T], [t], [c], 0.48\textwidth, etc.
    s = re.sub(r'(?m)^\s*\[[TtCcBb]\]\s*$', '', s)
    s = re.sub(r'\[[TtCcBb]\]\s*(?=\d|\n|\\|\s|$)', '', s)
    s = re.sub(r'\b\d+(?:\.\d+)?\\(?:textwidth|linewidth|columnwidth|paperwidth|paperheight)\b', '', s)
    s = re.sub(r'\\(?:textwidth|linewidth|columnwidth|paperwidth|paperheight)\b', '', s)
    s = re.sub(r'(?m)^\s*\d+\.\d+\s*$', '', s)
    s = re.sub(r'\{[ \t\r\n]*\}', '', s)

    res = s.strip()
    return '' if res in ['{}', '[]', '()'] else res

def plain_text(text: str) -> str:
    """Convierte texto enriquecido con macros LaTeX a texto plano legible."""
    s = clean_layout(text)
    s = re.sub(r'\\(?:begin|end)\{(?:itemize|enumerate|tabular)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?', '', s)
    s = re.sub(r'\\item(?:\[[^\]]*\])?\s*', '\n• ', s)
    s = re.sub(r'\\\\(?:\[[^\]]*\])?', '\n', s)
    s = re.sub(r'\\(?:toprule|midrule|bottomrule|hline)\b', '', s)
    for _ in range(4):
        s = re.sub(r'\\(?:textbf|texttt|textit|emph|alert|underline|text|url)\{([^{}]*)\}', r'\1', s)
        s = re.sub(r'\\texorpdfstring\{([^{}]*)\}\{([^{}]*)\}', r'\2', s)
    s = re.sub(r'\\([_%&#$])', r'\1', s)
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()

def find_closing_brace(s: str, start: int, open_char='{', close_char='}') -> tuple[str, int]:
    """Encuentra el grupo balanceado {...}."""
    depth = 0
    i = start
    while i < len(s):
        if s[i] == '\\':
            i += 2
            continue
        if s[i] == open_char:
            depth += 1
        elif s[i] == close_char:
            depth -= 1
            if depth == 0:
                return s[start + 1:i], i + 1
        i += 1
    return s[start + 1:], len(s)

def find_env_end(source: str, env_name: str, start_index: int) -> tuple[int, int] | None:
    """Encuentra el \\end{env_name} correspondiente con anidamiento balanceado."""
    pattern = re.compile(r'\\(begin|end)\{(' + re.escape(env_name) + r')\}')
    depth = 1
    for match in pattern.finditer(source, start_index):
        if match.group(1) == 'begin':
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                return match.start(), match.end()
    return None

# ==============================================================================
# Compilador de TikZ a SVG de alta fidelidad (XeLaTeX / pdflatex + dvisvgm / Inkscape)
# ==============================================================================
class DiagramCompiler:
    def __init__(self, output_dir: pathlib.Path, extra_preamble: str = ''):
        self.output_dir = output_dir
        self.assets_dir = output_dir / 'assets'
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.preamble = TIKZ_PREAMBLE + '\n' + extra_preamble
        self.cache: dict[str, dict] = {}
        self._detect_tools()

    def _detect_tools(self):
        self.has_xelatex = shutil.which('xelatex') is not None
        self.has_pdflatex = shutil.which('pdflatex') is not None
        self.has_latex = shutil.which('latex') is not None
        self.has_dvisvgm = shutil.which('dvisvgm') is not None
        self.has_inkscape = shutil.which('inkscape') is not None

    def compile(self, tikz_code: str, diagram_id: str) -> dict:
        """
        Compila código TikZ a SVG vectorial limpio.
        Retorna:
            {
                "success": bool,
                "svg_path": str,
                "data_uri": str,
                "error": str | None
            }
        """
        code_hash = hashlib.sha256(tikz_code.strip().encode()).hexdigest()[:12]
        filename = f"{diagram_id}-{code_hash}.svg"
        dest_path = self.assets_dir / filename

        # Si ya existe en caché compilado en esta corrida
        if code_hash in self.cache:
            return self.cache[code_hash]

        doc_tex = f"{self.preamble}\n\\begin{{document}}\n{tikz_code}\n\\end{{document}}"

        with tempfile.TemporaryDirectory(prefix="tikz_build_") as tmp:
            tmp_path = pathlib.Path(tmp)
            tex_file = tmp_path / "figure.tex"
            tex_file.write_text(doc_tex, encoding='utf-8')

            compiled = False
            log_output = ""

            # Estrategia 1: latex + dvisvgm (la más rápida y con bounding box matemático exacto)
            if self.has_latex and self.has_dvisvgm:
                try:
                    r1 = subprocess.run(
                        ['latex', '-interaction=nonstopmode', '-halt-on-error', 'figure.tex'],
                        cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=35
                    )
                    log_output = r1.stdout.decode('utf-8', errors='replace')
                    dvi_file = tmp_path / "figure.dvi"
                    if r1.returncode == 0 and dvi_file.exists():
                        r2 = subprocess.run(
                            ['dvisvgm', '--no-fonts', '--exact-bbox', '--scale=1.25', f'--output={dest_path}', 'figure.dvi'],
                            cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25
                        )
                        if r2.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                            compiled = True
                except Exception as e:
                    log_output += f"\nError con latex+dvisvgm: {e}"

            # Estrategia 2: xelatex o pdflatex + inkscape o dvisvgm --pdf (para librerías modernas o fallbacks)
            if not compiled and (self.has_xelatex or self.has_pdflatex):
                engine = 'xelatex' if self.has_xelatex else 'pdflatex'
                try:
                    r1 = subprocess.run(
                        [engine, '-interaction=nonstopmode', '-halt-on-error', 'figure.tex'],
                        cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=45
                    )
                    log_output = r1.stdout.decode('utf-8', errors='replace')
                    pdf_file = tmp_path / "figure.pdf"
                    if r1.returncode == 0 and pdf_file.exists():
                        if self.has_inkscape:
                            r2 = subprocess.run(
                                ['inkscape', str(pdf_file), '--export-area-drawing', f'--export-filename={dest_path}', '--export-text-to-path'],
                                cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25
                            )
                            if r2.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                                compiled = True
                        elif self.has_dvisvgm:
                            r2 = subprocess.run(
                                ['dvisvgm', '--pdf', '--no-fonts', '--exact-bbox', f'--output={dest_path}', 'figure.pdf'],
                                cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25
                            )
                            if r2.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                                compiled = True
                except Exception as e:
                    log_output += f"\nError con {engine}: {e}"

            if not compiled or not dest_path.exists():
                error_msg = self._clean_latex_error(log_output)
                res = {
                    "success": False,
                    "svg_path": None,
                    "data_uri": None,
                    "error": error_msg or "Fallo desconocido al compilar TikZ a SVG."
                }
                self.cache[code_hash] = res
                return res

            # Optimizar y preparar data-URI
            svg_content = dest_path.read_text(encoding='utf-8', errors='replace')
            svg_content = self._sanitize_svg(svg_content)
            dest_path.write_text(svg_content, encoding='utf-8')

            # Generar data URI base64 seguro
            b64_data = base64.b64encode(svg_content.encode('utf-8')).decode('ascii')
            data_uri = f"data:image/svg+xml;base64,{b64_data}"

            res = {
                "success": True,
                "svg_path": f"assets/{filename}",
                "data_uri": data_uri,
                "error": None
            }
            self.cache[code_hash] = res
            return res

    def _clean_latex_error(self, log: str) -> str:
        """Extrae el mensaje de error relevante del log de TeX."""
        lines = log.splitlines()
        errors = []
        for line in lines:
            if line.startswith('!') or 'Error:' in line or 'Fatal error' in line:
                errors.append(line.strip())
        return ' | '.join(errors[:3]) if errors else log[-400:]

    def _sanitize_svg(self, svg: str) -> str:
        """Asegura fondo transparente/óptimo y viewBox en el SVG."""
        # Asegurar xmlns si falta
        if 'xmlns="http://www.w3.org/2000/svg"' not in svg:
            svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
        return svg

# ==============================================================================
# Parser estructural de documentos LaTeX Beamer / Aula
# ==============================================================================
class LessonParser:
    def __init__(self, tex_path: pathlib.Path, compiler: DiagramCompiler, embed_svg=True):
        self.tex_path = tex_path
        self.tex_dir = tex_path.parent
        self.compiler = compiler
        self.embed_svg = embed_svg
        self.diagram_count = 0
        self.image_count = 0
        self.diagnostics: list[str] = []

    def parse(self) -> dict:
        content = self.tex_path.read_text(encoding='utf-8', errors='replace')
        metadata = self._extract_metadata(content)
        frames = self._extract_frames(content)

        return {
            "id": hashlib.md5(self.tex_path.name.encode()).hexdigest()[:10],
            "title": metadata['title'],
            "subtitle": metadata['subtitle'],
            "sourceFile": self.tex_path.name,
            "exportedAt": datetime.now().isoformat(),
            "stats": {
                "frames": len(frames),
                "diagrams": self.diagram_count,
                "images": self.image_count,
            },
            "diagnostics": self.diagnostics,
            "frames": frames,
        }

    def _extract_metadata(self, source: str) -> dict:
        stripped = re.sub(r'(?<!\\)%[^\n]*', '', source)
        title = ''
        subtitle = ''

        # Buscar \SectionSlide{Título}{Subtítulo}
        sec_slide = re.search(r'\\SectionSlide\s*\{', stripped)
        if sec_slide:
            t, end_t = find_closing_brace(stripped, sec_slide.end() - 1)
            title = plain_text(t)
            idx2 = stripped.find('{', end_t)
            if idx2 != -1 and idx2 - end_t < 10:
                sub, _ = find_closing_brace(stripped, idx2)
                subtitle = plain_text(sub)

        # Si no hubo SectionSlide, buscar \title{...} y \subtitle{...}
        if not title:
            t_match = re.search(r'\\title(?:\[[^\]]*\])?\s*\{', stripped)
            if t_match:
                t, _ = find_closing_brace(stripped, t_match.end() - 1)
                title = plain_text(t)

        if not subtitle:
            sub_match = re.search(r'\\subtitle(?:\[[^\]]*\])?\s*\{', stripped)
            if sub_match:
                s, _ = find_closing_brace(stripped, sub_match.end() - 1)
                subtitle = plain_text(s)

        fallback = self.tex_path.stem.replace('_', ' ').replace('-', ' ').title()
        return {
            "title": title or fallback,
            "subtitle": subtitle or ""
        }

    def _extract_frames(self, source: str) -> list[dict]:
        frames = []
        current_section = "Introducción"

        # Remover comentarios generales pero conservar el código en entornos
        token_pattern = re.compile(
            r'\\section\*?(?:\[[^\]]*\])?\s*\{|\\begin\{frame\}(?:\[[^\]]*\])?'
        )

        cursor = 0
        while cursor < len(source):
            match = token_pattern.search(source, cursor)
            if not match:
                break

            matched_text = match.group(0)
            if matched_text.startswith(r'\section'):
                section_title, end_pos = find_closing_brace(source, match.end() - 1)
                current_section = plain_text(section_title) or current_section
                cursor = end_pos
                continue

            # Es un \begin{frame}
            frame_start_line = source[:match.start()].count('\n') + 1
            body_start = match.end()
            # Opcional: título del frame como parámetro \begin{frame}{Título}
            frame_title = "Contenido"
            temp_idx = body_start
            while temp_idx < len(source) and source[temp_idx].isspace():
                temp_idx += 1
            if temp_idx < len(source) and source[temp_idx] == '{':
                ft, end_brace = find_closing_brace(source, temp_idx)
                frame_title = plain_text(ft) or frame_title
                body_start = end_brace

            frame_end = source.find(r'\end{frame}', body_start)
            if frame_end == -1:
                self.diagnostics.append(f"Frame en línea {frame_start_line} sin cierre \\end{{frame}}.")
                break

            frame_body = source[body_start:frame_end]
            blocks = self._parse_blocks(frame_body)

            frames.append({
                "id": f"frame-{len(frames) + 1}",
                "title": frame_title,
                "section": current_section,
                "line": frame_start_line,
                "blocks": blocks
            })

            cursor = frame_end + len(r'\end{frame}')

        return frames

    def _parse_blocks(self, source: str) -> list[dict]:
        blocks = []
        token_regex = re.compile(
            r'\\begin\{([a-zA-Z0-9_\*]+)\}|'
            r'\\(Idea|Practice|DefBlock|Result|Warning|Compare|Question|ExampleBlock)\b|'
            r'\\\[|\$\$|'
            r'\\(?:includegraphics|smartimage)\b'
        )

        cursor = 0
        while cursor < len(source):
            match = token_regex.search(source, cursor)
            if not match:
                text_chunk = clean_layout(source[cursor:])
                if text_chunk:
                    blocks.append({"type": "text", "content": text_chunk})
                break

            # Texto previo al token
            prefix = clean_layout(source[cursor:match.start()])
            if prefix:
                blocks.append({"type": "text", "content": prefix})

            env_name = match.group(1)
            callout_cmd = match.group(2)
            matched_str = match.group(0)
            end_pos = match.end()

            # 1. Entornos \begin{...}
            if env_name:
                stop = find_env_end(source, env_name, end_pos)
                if not stop:
                    self.diagnostics.append(f"Entorno \\begin{{{env_name}}} sin cierre correspondiente.")
                    cursor = end_pos
                    continue

                body = source[end_pos:stop[0]]
                total_env = source[match.start():stop[1]]

                # --- A. TikZ Diagram ---
                if env_name == 'tikzpicture':
                    self.diagram_count += 1
                    diag_id = f"diag-{self.diagram_count}"
                    comp_res = self.compiler.compile(total_env, diag_id)
                    block = {
                        "type": "diagram",
                        "id": diag_id,
                        "content": total_env,
                        "asset": comp_res['data_uri'] if self.embed_svg and comp_res['data_uri'] else comp_res['svg_path'],
                        "assetFile": comp_res['svg_path'],
                        "compiled": comp_res['success'],
                    }
                    if comp_res['error']:
                        block["error"] = comp_res['error']
                        self.diagnostics.append(f"TikZ {diag_id}: {comp_res['error']}")
                    blocks.append(block)

                # --- B. Fórmulas Matemáticas de visualización ---
                elif env_name in MATH_ENVS:
                    clean_math = re.sub(r'\\pause\b', '', total_env).strip()
                    blocks.append({
                        "type": "math",
                        "content": clean_math,
                        "variant": "display"
                    })

                # --- C. Bloques de Código ---
                elif env_name in CODE_LANGUAGES or env_name.endswith('code') or env_name.endswith('codedark') or env_name == 'minted':
                    lang = CODE_LANGUAGES.get(env_name, 'text')
                    code_body = body
                    if env_name == 'minted':
                        # \begin{minted}{python}
                        opt = re.match(r'^\s*\[[^\]]*\]', code_body)
                        if opt:
                            code_body = code_body[opt.end():]
                        brace_idx = code_body.find('{')
                        if brace_idx != -1:
                            lang_val, b_end = find_closing_brace(code_body, brace_idx)
                            lang = CODE_LANGUAGES.get(lang_val.strip(), lang_val.strip())
                            code_body = code_body[b_end:]

                    # Quitar indentación común
                    lines = code_body.strip('\n').split('\n')
                    indent = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
                    cleaned_code = '\n'.join(l[indent:] if len(l) >= indent else l for l in lines)
                    blocks.append({
                        "type": "code",
                        "language": lang,
                        "content": cleaned_code
                    })

                # --- D. Callouts / Bloques Beamer (block, alertblock, exampleblock) ---
                elif env_name in ['block', 'alertblock', 'exampleblock']:
                    title_callout = "Nota"
                    clean_body = body
                    idx = clean_body.find('{')
                    if idx != -1 and idx < 15:
                        t_val, b_end = find_closing_brace(clean_body, idx)
                        title_callout = plain_text(t_val)
                        clean_body = clean_body[b_end:]

                    clean_content = clean_layout(clean_body)
                    parsed_children = self._parse_blocks(clean_body)
                    if clean_content or parsed_children:
                        blocks.append({
                            "type": "callout",
                            "title": title_callout,
                            "variant": env_name,
                            "content": clean_content,
                            "children": parsed_children
                        })

                # --- E. Listas (itemize / enumerate) ---
                elif env_name in ['itemize', 'enumerate']:
                    items = self._split_list_items(body)
                    parsed_items = [self._parse_blocks(item) for item in items]
                    blocks.append({
                        "type": "list",
                        "variant": env_name,
                        "items": parsed_items
                    })

                # --- F. Tablas (tabular) ---
                elif env_name == 'tabular':
                    rows = self._parse_tabular_rows(body)
                    blocks.append({
                        "type": "table",
                        "rows": rows
                    })

                # --- G. Columnas y mini-páginas Beamer ---
                elif env_name in ['columns', 'column', 'minipage']:
                    clean_body = body
                    # Quitar [opt] inicial
                    m_opt = re.match(r'^\s*\[[^\]]*\]', clean_body)
                    if m_opt:
                        clean_body = clean_body[m_opt.end():]
                    # Quitar {arg} inicial (ej. {0.48\textwidth})
                    m_arg = re.match(r'^\s*\{[^{}]*\}', clean_body)
                    if m_arg:
                        clean_body = clean_body[m_arg.end():]
                    nested = self._parse_blocks(clean_body)
                    if nested:
                        blocks.extend(nested)
                    else:
                        cleaned = clean_layout(clean_body)
                        if cleaned and cleaned not in ['{}', '[]', '()']:
                            blocks.append({"type": "text", "content": cleaned})

                else:
                    # Contenedor genérico
                    nested = self._parse_blocks(body)
                    if nested:
                        blocks.extend(nested)
                    elif clean_layout(body):
                        cleaned = clean_layout(body)
                        if cleaned and cleaned not in ['{}', '[]', '()']:
                            blocks.append({"type": "text", "content": cleaned})

                cursor = stop[1]

            # 2. Callouts con comandos directos (\Idea, \Practice, etc.)
            elif callout_cmd:
                temp_idx = end_pos
                while temp_idx < len(source) and source[temp_idx].isspace():
                    temp_idx += 1
                title = callout_cmd
                if temp_idx < len(source) and source[temp_idx] == '[':
                    t_val, temp_idx = find_closing_brace(source, temp_idx, '[', ']')
                    title = plain_text(t_val)
                while temp_idx < len(source) and source[temp_idx].isspace():
                    temp_idx += 1
                if temp_idx < len(source) and source[temp_idx] == '{':
                    body_val, next_cursor = find_closing_brace(source, temp_idx)
                    clean_content = clean_layout(body_val)
                    parsed_children = self._parse_blocks(body_val)
                    if clean_content or parsed_children:
                        blocks.append({
                            "type": "callout",
                            "title": title,
                            "variant": callout_cmd,
                            "content": clean_content,
                            "children": parsed_children
                        })
                    cursor = next_cursor
                else:
                    cursor = temp_idx

            # 3. Imágenes externas \includegraphics o \smartimage
            elif 'includegraphics' in matched_str or 'smartimage' in matched_str:
                temp_idx = end_pos
                while temp_idx < len(source) and source[temp_idx].isspace():
                    temp_idx += 1
                if temp_idx < len(source) and source[temp_idx] == '[':
                    _, temp_idx = find_closing_brace(source, temp_idx, '[', ']')
                while temp_idx < len(source) and source[temp_idx].isspace():
                    temp_idx += 1
                if temp_idx < len(source) and source[temp_idx] == '{':
                    img_path_raw, cursor = find_closing_brace(source, temp_idx)
                    img_block = self._resolve_external_image(img_path_raw.strip())
                    blocks.append(img_block)
                else:
                    cursor = temp_idx

            # 4. Matemáticas display \[ ... \] o $$ ... $$
            elif matched_str in [r'\[', '$$']:
                close_delim = r'\]' if matched_str == r'\[' else '$$'
                closing_idx = source.find(close_delim, end_pos)
                if closing_idx != -1:
                    math_content = source[end_pos:closing_idx].strip()
                    math_content = re.sub(r'\\pause\b', '', math_content).strip()
                    blocks.append({
                        "type": "math",
                        "content": math_content,
                        "variant": "display"
                    })
                    cursor = closing_idx + len(close_delim)
                else:
                    cursor = end_pos

        return blocks

    def _split_list_items(self, body: str) -> list[str]:
        """Divide el cuerpo de un itemize/enumerate respetando entornos anidados."""
        items = []
        token_pat = re.compile(r'\\(?:begin|end)\{(?:itemize|enumerate)\}|\\item(?:\[[^\]]*\])?')
        depth = 0
        last_start = -1

        for match in token_pat.finditer(body):
            token = match.group(0)
            if token.startswith(r'\begin'):
                depth += 1
            elif token.startswith(r'\end'):
                depth -= 1
            elif depth == 0:
                if last_start != -1:
                    items.append(body[last_start:match.start()].strip())
                last_start = match.end()

        if last_start != -1 and last_start < len(body):
            items.append(body[last_start:].strip())

        return items

    def _parse_tabular_rows(self, body: str) -> list[list[str]]:
        """Convierte un tabular a lista de filas y celdas limpias."""
        # Remover especificación de columnas {l|c|r}
        cleaned = body
        idx = cleaned.find('{')
        if idx != -1 and idx < 10:
            _, end_col = find_closing_brace(cleaned, idx)
            cleaned = cleaned[end_col:]

        cleaned = re.sub(r'\\(?:toprule|midrule|bottomrule|hline)\b', '', cleaned)
        raw_rows = re.split(r'\\\\(?:\[[^\]]*\])?', cleaned)
        table_rows = []

        for row in raw_rows:
            if not row.strip():
                continue
            cells = [clean_layout(c) for c in re.split(r'(?<!\\)&', row)]
            table_rows.append(cells)

        return table_rows

    def _resolve_external_image(self, raw_path: str) -> dict:
        """Busca y resuelve una imagen en la carpeta del .tex y genera enlace seguro."""
        self.image_count += 1
        img_id = f"img-{self.image_count}"

        # Candidatos de ruta
        candidates = [
            self.tex_dir / raw_path,
            self.tex_dir / f"{raw_path}.png",
            self.tex_dir / f"{raw_path}.jpg",
            self.tex_dir / f"{raw_path}.jpeg",
            self.tex_dir / f"{raw_path}.pdf",
            self.tex_dir / "imagenes" / raw_path,
            self.tex_dir / "images" / raw_path,
            self.tex_dir / "img" / raw_path,
        ]

        found_path = None
        for cand in candidates:
            if cand.exists() and cand.is_file():
                found_path = cand
                break

        if not found_path:
            self.diagnostics.append(f"Imagen no encontrada en disco: '{raw_path}'")
            return {
                "type": "image",
                "id": img_id,
                "content": raw_path,
                "asset": None,
                "assetFile": None,
                "error": f"Recurso no encontrado: {raw_path}"
            }

        # Copiar imagen a assets/
        ext = found_path.suffix.lower()
        safe_name = f"{img_id}-{hashlib.md5(found_path.name.encode()).hexdigest()[:8]}{ext}"
        dest_asset = self.compiler.assets_dir / safe_name
        shutil.copy2(found_path, dest_asset)

        # Si es imagen raster y es menor a 3MB, embeber en data URI para que nunca se rompa
        data_uri = None
        if ext in ['.png', '.jpg', '.jpeg', '.webp', '.svg'] and found_path.stat().st_size <= 3 * 1024 * 1024:
            mime = mimetypes.guess_type(str(found_path))[0] or 'image/png'
            b64_bytes = base64.b64encode(found_path.read_bytes()).decode('ascii')
            data_uri = f"data:{mime};base64,{b64_bytes}"

        return {
            "type": "image",
            "id": img_id,
            "content": raw_path,
            "asset": data_uri if self.embed_svg and data_uri else f"assets/{safe_name}",
            "assetFile": f"assets/{safe_name}",
            "original": str(found_path.name),
        }

# ==============================================================================
# Función principal de ejecución CLI
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Compilador y exportador local de clases LaTeX (TikZ a SVG y contenido estructurado a JSON)."
    )
    parser.add_argument("tex_file", help="Ruta al archivo .tex de la clase.")
    parser.add_argument("-o", "--output", help="Carpeta de salida (por defecto: <nombre_clase>_export)")
    parser.add_argument("-z", "--zip", action="store_true", help="Generar archivo .zip con el paquete completo.")
    parser.add_argument("--no-embed", action="store_true", help="No embeber SVGs en data-URI dentro del JSON.")
    parser.add_argument("--preamble", help="Ruta a un archivo .tex adicional con macros o colores personalizados.")

    args = parser.parse_args()
    tex_path = pathlib.Path(args.tex_file).resolve()

    if not tex_path.exists() or not tex_path.is_file():
        print(f"\033[91mError: El archivo '{args.tex_file}' no existe o no es válido.\033[0m", file=sys.stderr)
        sys.exit(1)

    out_dir = pathlib.Path(args.output).resolve() if args.output else tex_path.parent / f"{tex_path.stem}_export"
    out_dir.mkdir(parents=True, exist_ok=True)

    extra_preamble = ""
    if args.preamble and pathlib.Path(args.preamble).exists():
        extra_preamble = pathlib.Path(args.preamble).read_text(encoding='utf-8', errors='replace')

    print(f"\033[94m=====================================================================\033[0m")
    print(f"\033[92m  Aula / Academix - Compilador Local de Clases LaTeX\033[0m")
    print(f"\033[94m=====================================================================\033[0m")
    print(f"📄 Archivo fuente: \033[1m{tex_path.name}\033[0m")
    print(f"📁 Directorio destino: \033[1m{out_dir}\033[0m")

    compiler = DiagramCompiler(out_dir, extra_preamble=extra_preamble)
    print(f"⚙️  Herramientas detectadas: "
          f"latex={compiler.has_latex}, "
          f"xelatex={compiler.has_xelatex}, "
          f"pdflatex={compiler.has_pdflatex}, "
          f"dvisvgm={compiler.has_dvisvgm}, "
          f"inkscape={compiler.has_inkscape}")

    lesson_parser = LessonParser(tex_path, compiler, embed_svg=not args.no_embed)
    print("⏳ Parseando estructura y compilando diagramas TikZ a SVG nativo...")

    result = lesson_parser.parse()

    # Guardar clase.json
    json_path = out_dir / "clase.json"
    json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f"\n\033[92m✅ Exportación completada con éxito:\033[0m")
    print(f"   • Título: \033[1m{result['title']}\033[0m")
    if result['subtitle']:
        print(f"   • Subtítulo: {result['subtitle']}")
    print(f"   • Diapositivas / Frames: \033[1m{result['stats']['frames']}\033[0m")
    print(f"   • Diagramas TikZ compilados a SVG: \033[1m{result['stats']['diagrams']}\033[0m")
    print(f"   • Imágenes externas resueltas: \033[1m{result['stats']['images']}\033[0m")
    print(f"   • Archivo generado: \033[1m{json_path.name}\033[0m ({json_path.stat().st_size / 1024:.1f} KB)")

    if result['diagnostics']:
        print(f"\n\033[93m⚠️  Diagnósticos / Advertencias ({len(result['diagnostics'])}):\033[0m")
        for diag in result['diagnostics'][:10]:
            print(f"   - {diag}")

    # Si se solicitó ZIP
    if args.zip:
        zip_base = str(out_dir)
        zip_file = shutil.make_archive(zip_base, 'zip', root_dir=out_dir)
        print(f"\n📦 Paquete ZIP listo para subir a la plataforma:")
        print(f"   👉 \033[1m{zip_file}\033[0m")

    print(f"\n\033[92mListo. Puedes subir '{json_path.name}' directamente a la plataforma sin errores de rutas.\033[0m\n")

if __name__ == "__main__":
    main()
