#!/usr/bin/env python3
"""d3im3r-class CLI: deterministic LaTeX -> JSON + SVG for lessons, guides, exams."""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import re
import shutil
from collections import Counter
from datetime import datetime, timezone

from parser import d3im3r_core as core
from parser.academic_adapters import GuideParser, ExamParser, METADATA


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
            inner = inline_to_text(node.get('children', []))
            core_text = inner.strip()
            if not core_text:
                continue
            lead = inner[:len(inner) - len(inner.lstrip())]
            trail = inner[len(inner.rstrip()):]
            res.append(f"{lead}**{core_text}**{trail}")
        elif ntype == 'emphasis':
            inner = inline_to_text(node.get('children', []))
            core_text = inner.strip()
            if not core_text:
                continue
            lead = inner[:len(inner) - len(inner.lstrip())]
            trail = inner[len(inner.rstrip()):]
            res.append(f"{lead}*{core_text}*{trail}")
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
