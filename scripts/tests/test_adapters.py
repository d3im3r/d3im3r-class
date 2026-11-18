import json
import sys
from pathlib import Path

import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from academix_cli import build
from validate_export import validate

GUIDES={
    'Web1_guia1':(19,48,54,10,4,0),
    'Web1_guia2':(39,52,75,8,12,21),
    'Web1_guia3':(19,6,12,3,6,11),
}
EXAMS={'Industrial_exam1':2,'Industrial_Parcial1':0}


def walk(obj):
    if isinstance(obj,dict):
        if 'type' in obj:yield obj
        for child in obj.values():yield from walk(child)
    elif isinstance(obj,list):
        for child in obj:yield from walk(child)


@pytest.mark.parametrize('name,counts',GUIDES.items())
def test_guide_content(tmp_path,name,counts):
    out=tmp_path/name
    report=build(ROOT/'samples'/f'{name}.tex',out,'guide',
                 ROOT/'samples'/'template-guide.tex',no_compile=True)
    doc=json.loads((out/'document.json').read_text())
    assert validate(out)==[]
    assert doc['type']=='guide' and doc['metadata']['guideTitle'].startswith('Guía')
    assert doc['metadata']['courseName']=='Diseño Web 1'
    for kind,expect in zip(('section','subsection','code','table','figure'),counts[:5]):
        assert report['counts'].get(kind,0)==expect,(name,kind)
    assert sum(1 for x in walk(doc['structure']) if x.get('checked') is False)==0  # items are not nodes
    checkitems=[]
    for x in walk(doc['structure']):
        if x['type']=='list' and x['variant']=='checklist':
            checkitems.extend(x['items'])
    assert len(checkitems)==counts[5]
    assert all(x.get('checked') is False for x in checkitems)
    assert not any(x['type']=='unsupported' for x in walk(doc['structure']))
    assert len(report['diagnostics'])==1  # institutional logo not uploaded


@pytest.mark.parametrize('name,n_figures',EXAMS.items())
def test_exam_questions_privacy_and_points(tmp_path,name,n_figures):
    out=tmp_path/name
    report=build(ROOT/'samples'/f'{name}.tex',out,'exam',
                 ROOT/'samples'/'template-exam.tex',no_compile=True)
    doc=json.loads((out/'document.json').read_text())
    assert validate(out)==[]
    assert doc['type']=='exam' and doc['metadata']['courseName']=='Robótica Industrial'
    questions=doc['structure'][0]['children']
    assert len(questions)==10
    assert sum(q['points'] for q in questions)==100
    assert all(len(q['options']['items'])==4 for q in questions)
    assert all(item['blocks'] for q in questions for item in q['options']['items'])
    assert all([item['label'] for item in q['options']['items']]==['A','B','C','D'] for q in questions)
    assert not any(x['type']=='unsupported' for x in walk(doc['structure']))
    assert report['counts'].get('figure',0)==n_figures
    assert doc['answerSheet']==10
    dumped=json.dumps(doc,ensure_ascii=False)
    assert 'RESPUESTA DOCENTE' not in dumped
    assert 'Verificación: ||v_hat||' not in dumped


def test_filenames_in_code_and_raster_references(tmp_path):
    out=tmp_path/'guide'
    build(ROOT/'samples'/'Web1_guia3.tex',out,'guide',
          ROOT/'samples'/'template-guide.tex',no_compile=True)
    doc=json.loads((out/'document.json').read_text())
    html=[x for x in walk(doc['structure']) if x.get('type')=='code' and x.get('fileName')=='index.html']
    assert len(html)==1
    assert '<html' in html[0]['value']
    assert '<img src="img/bosque.jpg"' in html[0]['value']
    # Source-code HTML images are not interpreted as document assets.
    manifest=json.loads((out/'assets.json').read_text())
    assert len(manifest['assets'])==7  # 6 TikZ + 1 missing institution logo


def test_layout_wrapper_is_not_exported_as_text(tmp_path):
    out=tmp_path/'synthetic'
    source=tmp_path/'test.tex'
    source.write_text(r'''
    \documentclass{article}\begin{document}
    \section{Ejercicios}
    \begin{multicols}{2}
      \begin{enumerate}
        \item Primero
        \item Segundo
      \end{enumerate}
    \end{multicols}
    \end{document}''')
    build(source,out,'guide',no_compile=True)
    doc=json.loads((out/'document.json').read_text())
    assert validate(out)==[]
    lists=[x for x in walk(doc) if x.get('type')=='list']
    assert len(lists)==1 and len(lists[0]['items'])==2
    text=' '.join(x.get('value','') for x in walk(doc) if x.get('type')=='text')
    assert '{2}' not in text


def test_svg_white_background_from_compiled_real_example():
    # Part of the deliverable: actual compiled SVG, not only synthetic JSON.
    folders=(ROOT/'exports'/'Web1_guia3',ROOT/'exports'/'Industrial_exam1')
    for folder in folders:
        if not folder.exists():pytest.skip('Compiled sample outputs are not present')
        assert validate(folder)==[]
        manifest=json.loads((folder/'assets.json').read_text())
        assert any(a['status']=='resolved' for a in manifest['assets'])


def test_lesson_parser_still_works(tmp_path):
    out=tmp_path/'lesson'
    report=build(ROOT/'samples'/'Industrial_5.tex',out,'lesson',no_compile=True)
    doc=json.loads((out/'document.json').read_text())
    assert validate(out)==[]
    assert doc['type']=='lesson' and report['counts']['frame']==37


def test_manual_override_recovers_missing_logo(tmp_path):
    from PIL import Image
    replacement=tmp_path/'logo.png'
    Image.new('RGB',(10,10),(255,255,255)).save(replacement)
    out=tmp_path/'recovered'
    build(ROOT/'samples'/'Web1_guia3.tex',out,'guide',
          ROOT/'samples'/'template-guide.tex',no_compile=True,
          overrides={'Template/LogoSena.png':str(replacement)})
    assert validate(out)==[]
    doc=json.loads((out/'document.json').read_text())
    assets=json.loads((out/'assets.json').read_text())
    logo=next(x for x in assets['assets'] if x['id']==doc['metadata']['institutionLogoAssetId'])
    assert logo['status']=='resolved'
    assert (out/logo['src']).is_file()
