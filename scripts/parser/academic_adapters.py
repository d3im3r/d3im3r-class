"""Deterministic adapters for the real TemplateGuide and TemplateExam LaTeX families.

Uses the Beamer v2 semantic parser as the shared block/asset engine.
No generative model and no execution of source-code snippets.
"""
from __future__ import annotations

import pathlib
import re
from collections import Counter
from typing import Any

from . import academix_core as core

METADATA = {
    'CourseName':'courseName','CourseCode':'courseCode','Faculty':'faculty',
    'Institution':'institution','Instructor':'instructor','Email':'email',
    'InstitutionLogo':'institutionLogo','AcademicPeriod':'academicPeriod',
    'GuideTitle':'guideTitle','ClassName':'className',
    'ExamTitle':'examTitle','ExamTopics':'examTopics',
    'ExamDuration':'examDuration','ExamValue':'examValue',
    'ExamQuestions':'examQuestions'
}


def extract_metadata(head: str, template_head: str='') -> dict[str,str]:
    """Read explicit metadata; template values are fallback only."""
    values={}
    for content in (core.strip_comments(template_head),core.strip_comments(head)):
        for match in re.finditer(r'\\(?:renewcommand|newcommand|providecommand)\*?\s*\{\s*\\([A-Za-z]+)\s*\}\s*\{',content):
            name=match.group(1)
            if name not in METADATA:continue
            try: val,_=core.group(content,match.end()-1)
            except ValueError:continue
            values[METADATA[name]]=core.latex_plain(val)
    return values


def skip_command(s: str, name: str, n: int=0) -> str:
    """Remove a top-level display command and its arguments; keep all other content."""
    pat=re.compile(r'\\'+re.escape(name)+r'\b')
    out=[];i=0
    for m in pat.finditer(s):
        if m.start()<i:continue
        out.append(s[i:m.start()]);j=m.end()
        try:
            for _ in range(n):
                _,j2=core.maybe_group(s,j)
                if j2==core.ws(s,j):break
                j=j2
        except (IndexError,ValueError):pass
        i=j
    out.append(s[i:]);return ''.join(out)


def find_headings(body: str) -> list[tuple[int,int,str,str,bool]]:
    """Return LaTeX headings outside verbatim/code listings and TikZ figures."""
    out=[];i=0;protected={*core.CODE_ENVS.keys(),'tikzpicture','verbatim'}
    while i<len(body):
        if body[i]!='\\':i+=1;continue
        name,j=core.cmd_at(body,i)
        if name=='begin':
            env,k=core.maybe_group(body,j)
            if env in protected:
                stop=core.LessonParser.find_env_close(body,env,k)
                if stop is not None:i=stop[1];continue
            i=k;continue
        if name.rstrip('*') in ('section','subsection','subsubsection'):
            _,j=core.maybe_group(body,j,'[',']')
            title,k=core.maybe_group(body,j)
            if title is not None:
                out.append((i,k,name.rstrip('*'),core.latex_plain(title),name.endswith('*')))
                i=k;continue
        i=j
    return out


def remove_display_only(body:str) -> str:
    for name in ('GuideHeader','tableofcontents','ExamHeader','StudentInfo',
                 'ExamScore','ExamCompact','ExamStandard','raggedcolumns'):
        body=skip_command(body,name)
    for name in ('thispagestyle','pagestyle'):
        body=skip_command(body,name,1)
    return body


class GuideParser(core.LessonParser):
    """Guide adapter: section hierarchy + guide metadata + checklist nodes."""

    def parse_blocks(self,s:str)->list[dict]:
        # The template defines ChecklistItem as \\item[$\\square$], i.e. not a
        # separate block. Convert to the corresponding list marker before parsing.
        parts=[];i=0
        for m in re.finditer(r'\\ChecklistItem\b',s):
            if m.start()<i:continue
            parts.append(s[i:m.start()]);value,end=core.maybe_group(s,m.end())
            if value is None:
                parts.append(s[m.start():m.end()]);i=m.end();continue
            parts.append(r'\item[☐] '+value+chr(10))
            i=end
        parts.append(s[i:])
        s=''.join(parts)
        nodes=super().parse_blocks(s)
        def mark(obj):
            if isinstance(obj,dict):
                if obj.get('type')=='list' and any(it.get('label')=='☐' for it in obj['items']):
                    obj['variant']='checklist'
                    for it in obj['items']:
                        if it.get('label')=='☐': it.pop('label',None);it['checked']=False
                for v in obj.values():mark(v)
            elif isinstance(obj,list):
                for v in obj:mark(v)
        mark(nodes)
        return nodes

    def parse(self, source:str, defaults:str='') -> dict:
        source=core.strip_comments(source)
        pre,_,body=source.partition(r'\begin{document}')
        metadata=extract_metadata(pre,defaults)
        if not body:body=source
        body=body.split(r'\end{document}',1)[0]
        # GuideInfo{Duracion}{Modalidad}{Evidencia}: metadata, not a visible box.
        m=re.search(r'\\GuideInfo\b',body)
        if m:
            pos=m.end(); args=[]
            for _ in range(3):
                val,pos=core.maybe_group(body,pos)
                if val is None:break
                args.append(core.latex_plain(val))
            if len(args)==3:
                metadata.update(zip(('guideDuration','guideModality','guideEvidence'),args))
                body=body[:m.start()]+body[pos:]
        body=remove_display_only(body)
        headings=find_headings(body)
        structure=[];current_sec=None;current_sub=None;current_subsub=None
        def mk_section(kind,title,starred=False):
            pos=len(structure) if kind=='section' else len(current_sec['children']) if kind=='subsection' else len(current_sub['children'])
            return {'type':kind,'id':kind[:3]+'-'+core.slug(title)+'-'+core.sha(title+'|'+str(pos),7),
                    'title':title,'starred':starred,'blocks':[],'children':[]}
        def add(chunk:str):
            nonlocal current_sec
            if not chunk.strip():return
            blocks=self.parse_blocks(chunk)
            if not blocks:return
            if current_sec is None:
                current_sec=mk_section('section','Contenido inicial');current_sec['implicit']=True
                structure.append(current_sec)
            target=current_subsub or current_sub or current_sec
            target['blocks'].extend(blocks)
        offset=0
        for start,end,kind,title,starred in headings:
            add(body[offset:start])
            if kind=='section':
                current_sec=mk_section(kind,title,starred)
                structure.append(current_sec);current_sub=None;current_subsub=None
            elif kind=='subsection':
                if current_sec is None:
                    current_sec=mk_section('section','Contenido');current_sec['implicit']=True
                    structure.append(current_sec)
                current_sub=mk_section(kind,title,starred)
                current_sec['children'].append(current_sub);current_subsub=None
            else:
                if current_sec is None:
                    current_sec=mk_section('section','Contenido');current_sec['implicit']=True
                    structure.append(current_sec)
                if current_sub is None:
                    current_sub=mk_section('subsection','Contenido');current_sub['implicit']=True
                    current_sec['children'].append(current_sub)
                current_subsub=mk_section(kind,title,starred)
                current_sub['children'].append(current_subsub)
            offset=end
        add(body[offset:])
        return {
            'schemaVersion':'1.1.0', 'id':core.slug(self.src.stem),
            'type':'guide','title':metadata.get('guideTitle',self.src.stem),
            'metadata':metadata,'source':{'file':self.src.name,'template':'guide'},
            'structure':structure
        }


class ExamParser(core.LessonParser):
    """Exam adapter: question, stem, 4-choice answers, instructions, answer sheet."""

    def parse(self,source:str,defaults:str='') -> dict:
        source=core.strip_comments(source)
        pre,_,body=source.partition(r'\begin{document}')
        metadata=extract_metadata(pre,defaults)
        if not body:body=source
        body=body.split(r'\end{document}',1)[0]
        instructions=[]
        m=re.search(r'\\ExamInstructions\b',body)
        if m:
            value,j=core.maybe_group(body,m.end())
            if value is not None:instructions=self.parse_blocks(value)
        answer_sheet=None
        m=re.search(r'\\AnswerSheet\b',body)
        if m:
            count,j=core.maybe_group(body,m.end())
            if count is not None:
                try:answer_sheet=int(count.strip())
                except ValueError:self.diagnostics.append({'severity':'warning','code':'INVALID_ANSWER_SHEET','source':count})
        questions=[];pos=0;counter=0
        pattern=re.compile(r'\\begin\{question\}')
        for match in pattern.finditer(body):
            if match.start()<pos:continue
            stop=self.find_env_close(body,'question',match.end())
            if stop is None:
                self.diagnostics.append({'severity':'error','code':'UNCLOSED_QUESTION','offset':match.start()})
                break
            counter+=1
            raw=body[match.end():stop[0]]
            points=None
            score=re.match(r'\s*\\textbf\s*\{\s*\[\s*(\d+(?:[.,]\d+)?)\s*puntos?\s*\]\s*\}',raw,re.I)
            if score:
                points=float(score.group(1).replace(',','.'))
                if points.is_integer():points=int(points)
                raw=raw[score.end():]
            options=None
            found=[]
            opt_pat=re.compile(r'\\begin\{(answers|inlineanswers|gridanswers)\}')
            for om in opt_pat.finditer(raw):
                if found and om.start()<found[-1][1]:continue
                opt_end=self.find_env_close(raw,om.group(1),om.end())
                if opt_end is None:
                    self.diagnostics.append({'severity':'error','code':'UNCLOSED_ANSWERS','question':counter})
                    continue
                found.append((om.start(),opt_end[1],om.group(1),raw[om.end():opt_end[0]]))
            if len(found)>1:
                self.diagnostics.append({'severity':'warning','code':'MULTIPLE_ANSWER_SETS','question':counter})
            if found:
                a,b,layout,inner=found[0]
                choices=[];cursor=0
                for choice in re.finditer(r'\\answer\b',inner):
                    if choice.start()<cursor:continue
                    value,j=core.maybe_group(inner,choice.end())
                    if value is None:
                        self.diagnostics.append({'severity':'warning','code':'BAD_ANSWER','question':counter})
                        continue
                    choices.append({'label':chr(65+len(choices)) if len(choices)<26 else str(len(choices)+1),
                                    'blocks':self.parse_blocks(value)})
                    cursor=j
                options={'layout':{'answers':'vertical','inlineanswers':'inline','gridanswers':'grid'}[layout],
                         'items':choices}
                tail=raw[b:].strip()
                if tail:
                    self.diagnostics.append({'severity':'warning','code':'QUESTION_TEXT_AFTER_OPTIONS','question':counter})
                stem=self.parse_blocks(raw[:a]+raw[b:])
            else:
                stem=self.parse_blocks(raw)
            node={'id':'q-'+str(counter)+'-'+core.sha(raw,8),'type':'question',
                  'number':counter,'points':points,'stem':stem,'options':options}
            questions.append(node)
            pos=stop[1]
        declared=metadata.get('examQuestions')
        if declared and declared.isdigit() and int(declared)!=len(questions):
            self.diagnostics.append({'severity':'warning','code':'QUESTION_COUNT_MISMATCH',
                                     'declared':int(declared),'actual':len(questions)})
        section={'id':'sec-questions','type':'section','title':'Preguntas',
                 'children':questions,'blocks':[]}
        return {'schemaVersion':'1.1.0','id':core.slug(self.src.stem),
                'type':'exam','title':metadata.get('examTitle',self.src.stem),
                'metadata':metadata,'source':{'file':self.src.name,'template':'exam'},
                'instructions':instructions,'answerSheet':answer_sheet,
                'structure':[section]}
