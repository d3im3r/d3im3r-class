'use client';
import {useEffect,useRef} from 'react';
import {EditorView,lineNumbers,highlightActiveLine} from '@codemirror/view';
import {Compartment,EditorState} from '@codemirror/state';
import {defaultHighlightStyle,syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {history,defaultKeymap,historyKeymap} from '@codemirror/commands';
import {keymap} from '@codemirror/view';
import {css} from '@codemirror/lang-css';
import {html} from '@codemirror/lang-html';
import {python} from '@codemirror/lang-python';
import {sql} from '@codemirror/lang-sql';
import {javascript} from '@codemirror/lang-javascript';
import {tags} from '@lezer/highlight';
import {useTheme} from '@/features/theme/theme-provider';
const darkHighlight=HighlightStyle.define([{tag:tags.keyword,color:'#ff7b72'},{tag:[tags.string,tags.special(tags.string)],color:'#a5d6ff'},{tag:[tags.number,tags.bool,tags.null],color:'#79c0ff'},{tag:tags.comment,color:'#9caac0',fontStyle:'italic'},{tag:tags.function(tags.variableName),color:'#d2a8ff'},{tag:[tags.tagName,tags.className],color:'#7ee787'},{tag:tags.attributeName,color:'#79c0ff'},{tag:tags.operator,color:'#ff7b72'}]);
export default function CodeEditor({initial,language,onChange}:{initial:string;language:string;onChange:(value:string)=>void}){
 const {theme}=useTheme();const appearance=useRef(new Compartment());const viewRef=useRef<EditorView|null>(null);
 const themeExtension=(dark:boolean)=>[EditorView.theme({'&':{fontSize:'13px',backgroundColor:'var(--code-bg)',color:'var(--code-fg)'},'.cm-scroller':{fontFamily:'monospace'},'.cm-content':{padding:'16px 0',caretColor:'var(--code-fg)'},'.cm-gutters':{backgroundColor:'var(--code-gutter)',color:'var(--code-muted)',border:'none'},'.cm-activeLine':{backgroundColor:'var(--code-active)'},'.cm-activeLineGutter':{backgroundColor:'var(--code-active)'},'&.cm-focused .cm-selectionBackground, .cm-selectionBackground':{backgroundColor:'var(--code-selection)'}},{dark}),syntaxHighlighting(dark?darkHighlight:defaultHighlightStyle)];
 const container=useRef<HTMLDivElement>(null); const change=useRef(onChange);change.current=onChange;
 useEffect(()=>{if(!container.current)return;const lang={css,html,python,sql,javascript}[language];const view=new EditorView({parent:container.current,state:EditorState.create({doc:initial,extensions:[lineNumbers(),highlightActiveLine(),history(),keymap.of([...defaultKeymap,...historyKeymap]),appearance.current.of(themeExtension(theme==='dark')),...(lang?[lang()]:[]),EditorView.lineWrapping,EditorView.contentAttributes.of({'aria-label':`Editor de código ${language}`}),EditorView.updateListener.of(u=>{if(u.docChanged)change.current(u.state.doc.toString());})]})});viewRef.current=view;return()=>{view.destroy();viewRef.current=null;};},[initial,language]);
 useEffect(()=>{viewRef.current?.dispatch({effects:appearance.current.reconfigure(themeExtension(theme==='dark'))});},[theme]);
 return <div ref={container} className="editor-container"/>;
}
