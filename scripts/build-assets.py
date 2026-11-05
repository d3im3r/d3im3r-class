#!/usr/bin/env python3
"""
build-assets.py
- Extrae diagramas TikZ de archivos .tex en docs/ y content/
- Compila a SVG vectorial nítido con latex + dvisvgm (--no-fonts, --exact-bbox)
- Guarda los SVGs en public/assets/diagrams/ y content/materials/assets/diagrams/
- Genera public/js/preloaded-data.js y js/preloaded-data.js con los contenidos para carga instantánea
- Sincroniza y asocia los diagramas para eliminar dependencias de CDNs o motores JS frágiles
"""

import os
import re
import sys
import json
import hashlib
import tempfile
import argparse
import subprocess
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = BASE_DIR / "docs"
CONTENT_DIR = BASE_DIR / "content"
PUBLIC_ASSETS_DIR = BASE_DIR / "public" / "assets" / "diagrams"
MATERIALS_ASSETS_DIR = BASE_DIR / "content" / "materials" / "assets" / "diagrams"
LEGACY_CACHE_DIR = BASE_DIR / "img" / "tikz_cache"
PUBLIC_JS_DIR = BASE_DIR / "public" / "js"
LEGACY_JS_DIR = BASE_DIR / "js"
PREAMBLE_PATH = BASE_DIR / "content" / "resources" / "latex" / "diagram-preamble.tex"

# Crear directorios necesarios
PUBLIC_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
MATERIALS_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
LEGACY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_JS_DIR.mkdir(parents=True, exist_ok=True)
LEGACY_JS_DIR.mkdir(parents=True, exist_ok=True)
DOCS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_PREAMBLE = r"""\documentclass[tikz,border=8pt]{standalone}
\usepackage{amsmath,amssymb}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{calc,positioning,arrows.meta,mindmap,shapes,shapes.geometric,fit,backgrounds,decorations.pathreplacing,decorations.markings,patterns,matrix,chains,scopes,trees}
\usepackage{xcolor}
\providecommand{\ok}{\textcolor{green!60!black}{\checkmark}}
\providecommand{\fail}{\textcolor{red}{\times}}
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
\definecolor{WarningBody}{RGB}{255,243,205}
\definecolor{IdeaTitle}{RGB}{245,158,11}
\definecolor{IdeaBody}{RGB}{254,243,199}
\definecolor{WarnTitle}{RGB}{239,68,68}
\definecolor{WarnBody}{RGB}{254,226,226}
\definecolor{ResultTitle}{RGB}{16,185,129}
\definecolor{ResultBody}{RGB}{209,250,229}
\definecolor{DefTitle}{RGB}{59,130,246}
\definecolor{DefBody}{RGB}{219,234,254}
"""

def load_preamble() -> str:
    if PREAMBLE_PATH.exists():
        try:
            return PREAMBLE_PATH.read_text(encoding="utf-8")
        except Exception as e:
            print(f"[!] Error leyendo {PREAMBLE_PATH}: {e}, usando preámbulo por defecto")
    return DEFAULT_PREAMBLE

def hash_sha256(code: str) -> str:
    """Hash canónico usado por la plataforma de clases."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()

def hash_md5_short(code: str) -> str:
    """Hash compatible con scripts de referencia."""
    cleaned = re.sub(r'\s+', ' ', code.strip())
    return hashlib.md5(cleaned.encode("utf-8")).hexdigest()[:12]

def apply_svg_background(svg_path: Path):
    try:
        svg_text = svg_path.read_text(encoding="utf-8")
        root = ET.fromstring(svg_text)
        viewbox = root.attrib.get("viewBox")
        if viewbox:
            values = [float(v) for v in re.split(r"[\s,]+", viewbox.strip())]
            if len(values) == 4:
                x, y, width, height = values
                rect = f'\n  <rect x="{x:g}" y="{y:g}" width="{width:g}" height="{height:g}" fill="#ffffff" stroke="none"/>\n'
                opening = re.search(r"<svg\b[^>]*>", svg_text, re.DOTALL)
                if opening:
                    svg_path.write_text(svg_text[:opening.end()] + rect + svg_text[opening.end():], encoding="utf-8")
    except Exception:
        pass

def compile_tikz_to_svg(tikz_content: str, preamble: str, dest_paths: list[Path]) -> bool:
    """Compila un bloque TikZ a SVG vectorial nítido usando XeLaTeX + Inkscape (o latex + dvisvgm como fallback)."""
    with tempfile.TemporaryDirectory(prefix="tikz_build_") as tmpdir:
        work = Path(tmpdir)
        tex_file = work / "figure.tex"
        pdf_file = work / "figure.pdf"
        dvi_file = work / "figure.dvi"
        svg_file = work / "figure.svg"

        full_doc = f"{preamble}\n\\begin{{document}}\n{tikz_content}\n\\end{{document}}\n"
        tex_file.write_text(full_doc, encoding="utf-8")

        env = {**os.environ, "openin_any": "p", "openout_any": "p"}
        compiled = False

        # 1. XeLaTeX + Inkscape (máxima nitidez vectorial, bounding box exacto y texto a trazados)
        if shutil.which("xelatex") and shutil.which("inkscape"):
            try:
                r_xe = subprocess.run(
                    ["xelatex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "figure.tex"],
                    cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25, text=True
                )
                if r_xe.returncode == 0 and pdf_file.exists():
                    r_ink = subprocess.run(
                        ["inkscape", str(pdf_file), "--export-area-drawing", f"--export-filename={svg_file}", "--export-text-to-path"],
                        cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15, text=True
                    )
                    if r_ink.returncode == 0 and svg_file.exists() and svg_file.stat().st_size > 0:
                        apply_svg_background(svg_file)
                        compiled = True
            except Exception as e:
                print(f"[!] XeLaTeX + Inkscape fallo: {e}, intentando fallback")

        # 2. Fallback a latex + dvisvgm si no hay Inkscape o falló
        if not compiled and shutil.which("latex") and shutil.which("dvisvgm"):
            try:
                r_latex = subprocess.run(
                    ["latex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "figure.tex"],
                    cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25, text=True
                )
                if r_latex.returncode == 0 and dvi_file.exists():
                    r_svg = subprocess.run(
                        ["dvisvgm", "--no-fonts", "--exact-bbox", "--scale=1.35", "-o", str(svg_file), "figure.dvi"],
                        cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15, text=True
                    )
                    if r_svg.returncode == 0 and svg_file.exists():
                        compiled = True
            except Exception as e:
                print(f"[-] Excepción ejecutando dvisvgm: {e}")

        if not compiled or not svg_file.exists():
            return False

        svg_content = svg_file.read_text(encoding="utf-8")
        if not svg_content or len(svg_content) < 50:
            print(f"[-] SVG generado está vacío o corrupto")
            return False

        # Guardar en todos los destinos requeridos
        for dest in dest_paths:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(svg_content, encoding="utf-8")

        return True

def extract_tikz_blocks(tex_content: str) -> list[str]:
    """Extrae todos los entornos tikzpicture de un texto LaTeX."""
    pattern = re.compile(r'(\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})', re.MULTILINE)
    return pattern.findall(tex_content)

def process_file(fpath: Path, preamble: str, all_tikz: dict, preloaded: dict, force: bool = False):
    try:
        content = fpath.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        print(f"[-] No se pudo leer {fpath}: {e}")
        return

    blocks = extract_tikz_blocks(content)
    if not blocks:
        return

    print(f"[*] Procesando {fpath.name} ({len(blocks)} diagramas encontrados)...")
    file_tikz = {}

    for block in blocks:
        sha = hash_sha256(block)
        md5_short = hash_md5_short(block)
        
        # Destinos canónicos y de compatibilidad
        sha_public = PUBLIC_ASSETS_DIR / f"{sha}.svg"
        sha_materials = MATERIALS_ASSETS_DIR / f"{sha}.svg"
        md5_legacy = LEGACY_CACHE_DIR / f"tikz_{md5_short}.svg"
        destinations = [sha_public, sha_materials, md5_legacy]

        # Si ya existe en public y no forzamos, leemos su contenido
        if force or not sha_public.exists() or sha_public.stat().st_size == 0:
            ok = compile_tikz_to_svg(block, preamble, destinations)
            if ok:
                print(f"    [+] Generado SVG para diagrama {sha[:10]}… -> {sha_public.name}")
            else:
                print(f"    [-] Falló la compilación del diagrama {sha[:10]}…")
        else:
            # Asegurar sincronización a las demás ubicaciones
            if not sha_materials.exists():
                sha_materials.write_text(sha_public.read_text(encoding="utf-8"), encoding="utf-8")
            if not md5_legacy.exists():
                md5_legacy.write_text(sha_public.read_text(encoding="utf-8"), encoding="utf-8")

        svg_content = ""
        if sha_public.exists():
            try:
                svg_content = sha_public.read_text(encoding="utf-8")
            except Exception:
                pass

        tikz_info = {
            "sha256": sha,
            "hash": md5_short,
            "asset": f"/assets/diagrams/{sha}.svg",
            "legacy_path": f"img/tikz_cache/tikz_{md5_short}.svg",
            "svg": svg_content,
            "code": block
        }

        all_tikz[sha] = tikz_info
        all_tikz[md5_short] = tikz_info
        file_tikz[sha] = tikz_info["asset"]

    fname = fpath.name
    preloaded[fname] = {
        "filename": fname,
        "path": str(fpath.relative_to(BASE_DIR)),
        "title": fname.replace(".tex", "").replace("_", " ").title(),
        "diagrams_count": len(blocks),
        "tikz": file_tikz
    }

def main():
    parser = argparse.ArgumentParser(description="Compilador y sincronizador de diagramas TikZ y LaTeX.")
    parser.add_argument("--docs-dir", default=str(DOCS_DIR), help="Directorio con archivos .tex (por defecto: docs/)")
    parser.add_argument("--scan-content", action="store_true", default=True, help="Escanear también content/ en busca de .tex")
    parser.add_argument("--force", action="store_true", help="Recompilar todos los diagramas con XeLaTeX + Inkscape aunque ya existan")
    args = parser.parse_args()

    print("[*] Iniciando motor de compilación TikZ y .tex...")
    preamble = load_preamble()
    all_tikz = {}
    preloaded = {}

    target_docs = Path(args.docs_dir)
    target_docs.mkdir(parents=True, exist_ok=True)

    # 1. Escanear docs/
    tex_files = list(target_docs.glob("*.tex"))
    
    # 2. Si scan-content está activo, escanear content/
    if args.scan_content and CONTENT_DIR.exists():
        tex_files.extend(list(CONTENT_DIR.rglob("*.tex")))

    # Deduplicar archivos
    unique_files = sorted(list({f.resolve(): f for f in tex_files}.values()), key=lambda p: p.name)

    print(f"[*] Archivos .tex a procesar: {len(unique_files)}")
    for fpath in unique_files:
        process_file(fpath, preamble, all_tikz, preloaded, force=args.force)

    # 3. Guardar en preloaded-data.js (ubicaciones canónicas y legacy)
    js_content = (
        "// Datos precargados generados automáticamente por scripts/build-assets.py\n"
        "// Carga instantánea de diagramas vectoriales sin dependencias de red o CDNs.\n"
        f"window.PRELOADED_CLASSES = {json.dumps(preloaded, indent=2)};\n"
        f"window.TIKZ_CACHE = {json.dumps(all_tikz, indent=2)};\n"
    )

    for js_dir in [PUBLIC_JS_DIR, LEGACY_JS_DIR]:
        js_file = js_dir / "preloaded-data.js"
        js_file.write_text(js_content, encoding="utf-8")
        print(f"[OK] Archivo generado: {js_file.relative_to(BASE_DIR)}")

    # 4. Guardar un manifiesto JSON en assets para consumo rápido desde API/Frontend
    manifest_path = PUBLIC_ASSETS_DIR / "manifest.json"
    manifest_data = {
        h: {"asset": info["asset"], "sha256": info["sha256"]}
        for h, info in all_tikz.items() if len(h) == 64
    }
    manifest_path.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")
    print(f"[OK] Manifiesto guardado: {manifest_path.relative_to(BASE_DIR)} ({len(manifest_data)} diagramas)")

    print("[*] Proceso completado exitosamente.")

if __name__ == "__main__":
    main()
