import {Fragment} from 'react';

export function Syntax({text}) {
  return String(text).split(/("[^"\n]*"|'[^'\n]*'|\b(?:return|use|function|public|class|true|false|null|const|await|async|GET|POST|PATCH|DELETE|PUT)\b|\/\/[^\n]*|\$\w+|\b\d+\b)/g).map((token,i)=><span key={i} className={token.startsWith('//')?'token-comment':/^['"]/.test(token)?'token-string':/^\$/.test(token)?'token-var':/^(return|use|function|public|class|true|false|null|const|await|async|GET|POST|PATCH|DELETE|PUT)$/.test(token)?'token-keyword':/^\d+$/.test(token)?'token-number':''}>{token}</span>);
}

export default function Code({text,title='Ejemplo',language='PHP',renderSlot}) {
  return <div className="code-window"><div className="code-top"><span>{title}</span><span>{language}</span></div><pre><code>{String(text).split('\n').map((line,i)=><span className="code-line" key={i}>{line.split(/(\{\{\d+\}\})/).map((part,j)=>{const slot=part.match(/^\{\{(\d+)\}\}$/);return <Fragment key={j}>{slot&&renderSlot?renderSlot(Number(slot[1])):<Syntax text={part}/>}</Fragment>;})}{!line&&' '}</span>)}</code></pre></div>;
}
