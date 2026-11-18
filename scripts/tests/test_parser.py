import importlib.util
import json
import pathlib
import tempfile

from PIL import Image
from lxml import etree

HERE=pathlib.Path(__file__).resolve().parents[1]
target_parser = HERE / 'export_lesson.py'
if not target_parser.exists():
    target_parser = HERE / 'academix_parser_v2.py'
spec=importlib.util.spec_from_file_location('export_lesson', target_parser)
import sys
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)


def test_inline_math_format_and_escaped_symbols():
    nodes=module.parse_inline(r'En $R_2R_1\boldsymbol{p}$, usar \textbf{rotaciones} y 50\%.')
    assert [x['type'] for x in nodes]==['text','math_inline','text','strong','text']
    assert nodes[1]['latex']==r'R_2R_1\boldsymbol{p}'
    assert nodes[-1]['value'].endswith('50%.')


def test_nested_lists_and_table():
    body=r'\item Uno\begin{enumerate}\item interno\end{enumerate}\item Dos'
    pairs=module.split_items(body)
    assert len(pairs)==2
    assert 'interno' in pairs[0][1]
    cells=module.split_table(r'\toprule A & B \\ \midrule \multicolumn{2}{c}{T} \\')
    assert len(cells)==2
    assert len(cells[0])==2


def test_svg_background_and_raster_embedding():
    with tempfile.TemporaryDirectory() as temp:
        d=pathlib.Path(temp);Image.new('RGB',(20,10),'#123456').save(d/'small.png')
        manager=module.AssetManager(d/'output',d,module.BASE_TIKZ_PREAMBLE,False)
        ref=manager.external('small.png')
        record=manager.manifest[ref['assetId']]
        assert record['status']=='resolved'
        xml=etree.fromstring((d/'output'/record['src']).read_bytes())
        ns='{http://www.w3.org/2000/svg}'
        assert xml.find(ns+'rect').get('fill')=='#ffffff'
        assert xml.find(ns+'image') is not None
        missing=manager.external('not-here.png')
        assert manager.manifest[missing['assetId']]['status']=='missing'


def test_layout_and_context_macro_detection():
    with tempfile.TemporaryDirectory() as temp:
        d=pathlib.Path(temp)
        pre=r'\newcommand{\RobotDosR}[1]{\begin{tikzpicture}\draw (0,0)--(#1,1);\end{tikzpicture}}'
        definitions,macros=module.preamble_definitions(pre)
        manager=module.AssetManager(d/'out',d,module.BASE_TIKZ_PREAMBLE+definitions,False)
        parser=module.LessonParser(d/'class.tex',manager,macros)
        tex=(r'\begin{columns}[T,onlytextwidth]'
             r'\column{0.4\textwidth}Texto'
             r'\column{0.6\textwidth}'
             r'\resizebox{!}{4cm}{\RobotDosR{2}}'
             r'\end{columns}')
        blocks=parser.parse_blocks(tex)
        assert [b['type'] for b in blocks]==['paragraph','figure']
        assert blocks[0]['children'][0]['value']=='Texto'
        assert len(manager.manifest)==1


def test_existing_exports():
    samples={'industrial_5':(37,6),'industrial_8':(127,46),'web1_9':(80,11)}
    for name,(count,images) in samples.items():
        folder=HERE/'exports'/name
        if not folder.exists():continue
        doc=json.loads((folder/'document.json').read_text())
        refs=[];frames=[]
        def walk(x):
            if isinstance(x,dict):
                if x.get('type')=='frame':frames.append(x)
                if x.get('type')=='figure':refs.append(x)
                for value in x.values():walk(value)
            elif isinstance(x,list):
                for value in x:walk(value)
        walk(doc['structure'])
        assert len(frames)==count
        assert len(refs)==images


def test_minted_and_lstlisting_extraction():
    parser = module.LessonParser(pathlib.Path('test.tex'), None, {})

    # 1. Minted with options and language
    tex_minted = "\\begin{minted}[linenos, fontsize=\\small]{Python}\ndef saludar(nombre):\n    print(f'Hola {nombre}')\n\\end{minted}"
    blocks = parser.parse_blocks(tex_minted)
    code_blocks = [b for b in blocks if b['type'] == 'code']
    assert len(code_blocks) == 1
    assert code_blocks[0]['language'] == 'python'
    assert 'def saludar' in code_blocks[0]['value']

    # 2. Lstlisting with language option
    tex_lst = "\\begin{lstlisting}[language=HTML, caption=Mi página]\n<!DOCTYPE html>\n<html>\n<body><h1>Test</h1></body>\n</html>\n\\end{lstlisting}"
    blocks2 = parser.parse_blocks(tex_lst)
    code_blocks2 = [b for b in blocks2 if b['type'] == 'code']
    assert len(code_blocks2) == 1
    assert code_blocks2[0]['language'] == 'html'

    # 3. Fallback heuristic auto-detection on verbatim
    tex_verb = "\\begin{verbatim}\nimport numpy as np\nimport matplotlib.pyplot as plt\nx = np.linspace(0, 10, 100)\n\\end{verbatim}"
    blocks3 = parser.parse_blocks(tex_verb)
    code_blocks3 = [b for b in blocks3 if b['type'] == 'code']
    assert len(code_blocks3) == 1
    assert code_blocks3[0]['language'] == 'python'

