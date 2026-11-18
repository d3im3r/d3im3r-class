#!/usr/bin/env python3
"""Optional parallel SVG compilation for assets.json created with --no-compile.
Compile only local, trusted LaTeX sources. Updates manifests and diagnostics.
"""
from __future__ import annotations
import argparse
import json
import pathlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from academix_parser_v2 import AssetManager, BASE_TIKZ_PREAMBLE, preamble_definitions, strip_comments


def process(source:pathlib.Path,out:pathlib.Path,workers:int=4):
    head=strip_comments(source.read_text()).split(r'\begin{document}',1)[0]
    custom,_=preamble_definitions(head)
    preamble=BASE_TIKZ_PREAMBLE+'\n'+custom
    manifest_file=out/'assets.json';report_file=out/'build-report.json'
    manifest=json.loads(manifest_file.read_text());report=json.loads(report_file.read_text())
    pending=[(i,r) for i,r in enumerate(manifest['assets']) if r['status']=='pending'
             and r['origin'] in ('tikz','tikz_macro')]
    print(f'{source.name}: compiling {len(pending)} unique graphics with {workers} workers...',flush=True)
    def render(task):
        idx,r=task
        builder=AssetManager(out,source.parent,preamble)
        obj=builder.tikz(r['source'],origin=r['origin'])
        return idx,builder.manifest[obj['assetId']],builder.warnings
    with ThreadPoolExecutor(max_workers=workers) as executor:
        tasks=[executor.submit(render,t) for t in pending]
        for done in as_completed(tasks):
            idx,record,warnings=done.result()
            manifest['assets'][idx]=record
            for m in warnings:report['diagnostics'].append({'severity':'warning','code':'SVG_COMPILE','message':m})
            total=sum(r['status']=='resolved' for r in manifest['assets'])
            print(f'  [{total:02d} SVG ready] {record["id"]}: {record["status"]}',flush=True)
    report['assets']=dict(Counter(r['status'] for r in manifest['assets']))
    manifest_file.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    report_file.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('Status:',report['assets'],flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('tex',type=pathlib.Path)
    parser.add_argument('-o','--output',required=True,type=pathlib.Path)
    parser.add_argument('-w','--workers',type=int,default=4)
    args=parser.parse_args()
    process(args.tex.resolve(),args.output.resolve(),args.workers)
