#!/usr/bin/env python3
"""Strict schema and asset validation for d3im3r-class export packages."""
from __future__ import annotations
import argparse,json,pathlib,sys
from jsonschema import Draft202012Validator
from lxml import etree

def validate(folder:pathlib.Path,root:pathlib.Path|None=None)->list[str]:
    root=root or pathlib.Path(__file__).resolve().parent
    doc=json.loads((folder/'document.json').read_text(encoding='utf-8'))
    assets=json.loads((folder/'assets.json').read_text(encoding='utf-8'))
    schema=json.loads((root/'schema'/'academic.schema.json').read_text(encoding='utf-8'))
    issues=[]
    for error in Draft202012Validator(schema).iter_errors(doc):
        issues.append('SCHEMA '+'.'.join(str(x) for x in error.absolute_path)+': '+error.message[:220])
    assets_schema=json.loads((root/'schema'/'assets.schema.json').read_text(encoding='utf-8'))
    for error in Draft202012Validator(assets_schema).iter_errors(assets):
        issues.append('ASSET_SCHEMA '+'.'.join(str(x) for x in error.absolute_path)+': '+error.message[:220])
    asset_ids={}
    for record in assets['assets']:
        ident=record['id']
        if ident in asset_ids:issues.append('DUPLICATE_ASSET_ID '+ident)
        asset_ids[ident]=record
        if record['status']=='resolved':
            src=folder/record['src']
            if not src.is_file():issues.append('MISSING_SVG '+str(src));continue
            try:
                xml=etree.parse(str(src),etree.XMLParser(resolve_entities=False,no_network=True))
                root_svg=xml.getroot()
                if etree.QName(root_svg).localname!='svg':issues.append('BAD_SVG '+ident)
                has_white=any(etree.QName(c).localname=='rect' and c.get('fill','').lower()=='#ffffff' for c in root_svg)
                if not has_white:issues.append('NO_WHITE_BACKGROUND '+ident)
            except Exception as ex:issues.append('INVALID_SVG '+ident+': '+str(ex))
    def walk(v):
        if isinstance(v,dict):
            if v.get('type')=='figure' and v.get('assetId') not in asset_ids:
                issues.append('UNKNOWN_FIGURE '+str(v.get('assetId')))
            for z in v.values():walk(z)
        elif isinstance(v,list):
            for z in v:walk(z)
    walk(doc)
    return issues

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('folders',nargs='+',type=pathlib.Path);args=a.parse_args()
    for folder in args.folders:
        errors=validate(folder)
        print(folder.name,'OK' if not errors else 'ERROR',len(errors))
        for error in errors:print('  -',error)
        if errors:sys.exit(1)
