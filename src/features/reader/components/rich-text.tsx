import { Fragment, type ReactNode } from 'react';
import katex from 'katex';
import { group } from '@/features/latex-import/lib/parser';
function MathInline({ source }: { source: string }) {
  return (
    <span
      className="inline-math"
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(source, {
          throwOnError: false,
          trust: false,
          displayMode: false,
        }),
      }}
    />
  );
}
export function InlineText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const token =
    /\\(textbf|texttt|textit|emph|alert|underline|text|url|href|textcolor)\s*\{|(?<!\\)\$|\\\(|\\\\(?:\[[^\]]*\])?|\\(?:ok|fail|fa[A-Za-z]+)\b/g;
  const literal = (s: string) =>
    s
      .replace(/\\([_%&#${}])/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/``/g, '“')
      .replace(/''/g, '”');
  let cursor = 0,
    m;
  while ((m = token.exec(text))) {
    if (m.index > cursor) nodes.push(literal(text.slice(cursor, m.index)));
    let end = token.lastIndex;
    if (m[1]) {
      try {
        const g = group(text, end - 1);
        let value = g.value;
        end = g.end;
        let target = '';
        if (m[1] === 'href' || m[1] === 'textcolor') {
          target = value;
          let i = end;
          while (/\s/.test(text[i] ?? '') && i < text.length) i++;
          if (text[i] === '{') {
            const second = group(text, i);
            value = second.value;
            end = second.end;
          }
        }
        const inner = <InlineText text={value} />;
        if (m[1] === 'texttt')
          nodes.push(<code key={m.index}>{value.replace(/\\([_%&#${}])/g, '$1')}</code>);
        else if (m[1] === 'textbf') nodes.push(<strong key={m.index}>{inner}</strong>);
        else if (m[1] === 'textit' || m[1] === 'emph') nodes.push(<em key={m.index}>{inner}</em>);
        else if (m[1] === 'alert') nodes.push(<mark key={m.index}>{inner}</mark>);
        else if (m[1] === 'underline') nodes.push(<u key={m.index}>{inner}</u>);
        else if (m[1] === 'url' || m[1] === 'href') {
          const url = m[1] === 'url' ? value : target;
          nodes.push(
            /^https?:\/\//.test(url) ? (
              <a href={url} target="_blank" rel="noreferrer" key={m.index}>
                {inner}
              </a>
            ) : (
              inner
            )
          );
        } else nodes.push(inner);
      } catch {
        nodes.push(literal(m[0]));
      }
    } else if (m[0] === '$' || m[0] === '\\(') {
      const closing = m[0] === '$' ? '$' : '\\)';
      const stop = text.indexOf(closing, end);
      if (stop >= 0) {
        nodes.push(<MathInline key={m.index} source={text.slice(end, stop)} />);
        end = stop + closing.length;
      } else nodes.push(m[0]);
    } else if (m[0].startsWith('\\\\')) nodes.push(<br key={m.index} />);
    else if (m[0] === '\\ok') nodes.push('✓');
    else if (m[0] === '\\fail') nodes.push('✕');
    cursor = end;
    token.lastIndex = end;
  }
  if (cursor < text.length) nodes.push(literal(text.slice(cursor)));
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
}
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p className="lesson-text" key={i}>
            <InlineText text={p.trim()} />
          </p>
        ))}
    </>
  );
}
