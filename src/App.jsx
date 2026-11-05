import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Code2, Check, CheckCheck, CircleHelp, Copy, Crown, Flame, Gamepad2, LoaderCircle, LogOut, Play, Send, ShieldCheck, Timer, Trophy, Users, X, Zap } from 'lucide-react';
import AvatarImage, { avatarName, AVATAR_COUNT } from './components/AvatarImage.jsx';
import Code, {Syntax} from './components/Code.jsx';
import { ranking } from './domain/ranking.js';
import { roomService } from './services/index.js';

const number = value => new Intl.NumberFormat('es-BO').format(value || 0);

const transition = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 }, transition: { duration: .2 } };

function Brand({ large = false }) {
  return <span className={`brand ${large ? 'brand-large' : ''}`}><span className="brand-icon"><Gamepad2 /></span><span>Arty<span className="brand-arena">Quest</span><span className="brand-period">.</span></span></span>;
}
function Avatar({ id = 0, className = '' }) { return <span className={`avatar ${className}`}><AvatarImage id={id} /></span>; }
function Button({ children, busy, className = '', ...props }) {
  return <button className={`button ${className}`} {...props} disabled={props.disabled || busy}>{busy ? <><LoaderCircle className="spin" size={19} />Un momento…</> : children}</button>;
}
function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}><div className="modal-body"><button className="icon-button modal-close" aria-label="Cerrar" onClick={onClose}><X /></button><h2 id="modal-title">{title}</h2>{children}</div></dialog>;
}
function Help({ onClose }) {
  return <Modal title="Así se juega" onClose={onClose}><ol className="help-steps"><li>Entra con el código y tu nombre.</li><li>Elige una opción, completa código con fichas o arma una petición guiada.</li><li>En selección, un toque envía tu respuesta. En los demás retos, pulsa Enviar.</li><li>Mira tus puntos tras cada reto. ¡El mayor puntaje gana!</li></ol><p className="muted">Selección: 1.000 pts · Código y peticiones: 1.500 pts · Rapidez: hasta 500 pts · Racha: +250 desde el tercer acierto · Fallo enviado a tiempo: 100 pts.</p><Button onClick={onClose}>¡Vamos!<ArrowRight size={18} /></Button></Modal>;
}
function AvatarPicker({ value, onSelect, onClose }) {
  return <Modal title="Elige tu avatar" onClose={onClose}><div className="avatar-picker">{Array.from({ length: AVATAR_COUNT }, (_, id) => <button key={id} className={value === id ? 'chosen' : ''} aria-label={`Elegir avatar ${id+1}`} aria-pressed={value === id} onClick={() => onSelect(id)}><AvatarImage id={id} />{value === id && <Check className="avatar-tick" size={16} />}</button>)}</div></Modal>;
}

function Entry({ onEnter, onHelp }) {
  const [admin, setAdmin] = useState(false);
  const [recover, setRecover] = useState(false);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('sala')?.replace(/\D/g, '').slice(0, 6) || '');
  const [nickname, setNickname] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatarId, setAvatarId] = useState(() => Math.floor(Math.random() * AVATAR_COUNT));
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const session = admin
        ? await roomService.loginAdmin({ username, password, code: recover ? code : '', seconds: 30, name: 'ArtyQuest' })
        : await roomService.join({ code, nickname, avatarId });
      roomService.setSession(session); onEnter(session);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={`entry-page ${admin ? 'entry-admin' : ''}`}><header className="entry-header"><Brand /><div className="entry-navigation"><a className="presentation-back" href="https://artyomstkr.github.io/Expo-Web/#laravel" aria-label="Volver a las diapositivas"><ArrowLeft size={17} /><span>Diapositivas</span></a><button className="icon-button" onClick={onHelp} aria-label="Cómo se juega"><CircleHelp size={22} /></button></div></header>
    <main className="entry-main"><div className="entry-doodle doodle-triangle" aria-hidden="true">&lt;/&gt;</div><div className="entry-doodle doodle-spark" aria-hidden="true">*</div><div className="entry-doodle doodle-diamond" aria-hidden="true">{'{ }'}</div><div className="entry-doodle doodle-circle" aria-hidden="true">_</div>
      <motion.div className="entry-content" {...transition} key={admin ? 'admin' : 'guest'}>
        <div className="entry-heading">{admin ? <><span className="entry-crown admin-emblem"><ShieldCheck /></span><h1>Tu sala, tu ritmo.</h1></> : <><span className="entry-crown"><Code2 /></span><h1>Tu próxima<span> misión.</span></h1></>}</div>
        <form className="entry-card" onSubmit={submit}>
          {admin ? <><label htmlFor="email">Correo del anfitrión<input id="email" type={roomService.mode === 'supabase' ? 'email' : 'text'} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required placeholder="tu@correo.com" /></label><label htmlFor="password">Contraseña<input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="Tu contraseña" /></label>{recover && <label htmlFor="host-code">Código de sala<input id="host-code" className="code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required placeholder="000000" /></label>}</>
          : <><label htmlFor="room-code">Código de sala<input id="room-code" className="code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required placeholder="000000" /></label><label htmlFor="nickname">¿Cómo te llamas?<input id="nickname" autoComplete="nickname" minLength={2} maxLength={20} value={nickname} onChange={event => setNickname(event.target.value)} required placeholder="Tu nombre de batalla" /></label><button type="button" className="avatar-choice" onClick={() => setPicker(true)}><Avatar id={avatarId} /><span>{avatarName(avatarId)}<small>Cambiar avatar</small></span><ArrowRight size={18} /></button></>}
          {error && <p className="error" role="alert">{error}</p>}
          <Button type="submit" busy={busy}>{admin ? recover ? 'Recuperar sala' : 'Crear sala' : '¡Estoy dentro!'}<ArrowRight size={20} /></Button>
          {admin && <button type="button" className="text-button" onClick={() => { setRecover(!recover); setError(''); }}>{recover ? 'Crear una sala nueva' : 'Ya tengo una sala'}</button>}
        </form>
        <button className="entry-switch text-button" onClick={() => { setAdmin(!admin); setError(''); }}>{admin ? <><ArrowLeft size={15} />Volver al juego</> : <><ShieldCheck size={15} />Soy el anfitrión</>}</button>
      </motion.div>
    </main>
    {picker && <AvatarPicker value={avatarId} onSelect={id => { setAvatarId(id); setPicker(false); }} onClose={() => setPicker(false)} />}
  </div>;
}

function useRemaining(deadline) {
  const [now, setNow] = useState(roomService.now());
  useEffect(() => { setNow(roomService.now()); const timer = setInterval(() => setNow(roomService.now()), 150); return () => clearInterval(timer); }, [deadline]);
  return Math.max(0, ((deadline || 0) - now) / 1000);
}

function Leaderboard({ room, session, compact = false, final = false }) {
  const players = ranking(room);
  const me = players.find(player => player.id === session.playerId);
  const visible = compact ? players.slice(0, 5) : players;
  const extra = compact && me && !visible.some(player => player.id === me.id) ? [me] : [];
  return <section className={`leaderboard ${compact ? 'leaderboard-compact' : ''}`} aria-label="Clasificación"><div className="leaderboard-heading"><h2><Trophy size={21} />{final ? 'Clasificación final' : 'Así va la partida'}</h2><span>{players.length}<Users size={15} /></span></div>
    {players.length ? <ol className="ranking-list">{[...visible, ...extra].map(player => {
      const place = players.findIndex(person => person.id === player.id);
      const own = player.id === session.playerId;
      return <motion.li layout key={player.id} className={`${own ? 'rank-me' : ''} ${place === 0 ? 'rank-first' : ''}`} transition={{ type: 'spring', stiffness: 320, damping: 30 }}><span className="rank-place">{place === 0 ? <Crown size={19} fill="currentColor" /> : place + 1}</span><Avatar id={player.avatarId} /><span className="rank-name">{player.nickname}{own && <small>Tú</small>}</span><span className="rank-points"><strong>{number(player.score)}</strong>{player.lastEarned > 0 && <small>+{number(player.lastEarned)}</small>}</span></motion.li>;
    })}</ol> : <p className="muted empty-ranking">Esperando al primer jugador…</p>}
  </section>;
}

function Lobby({ room, session, onRemove, onCopy }) {
  const admin = session.role === 'admin';
  const players = Object.values(room.players);
  const me = room.players[session.playerId];
  return <section className="lobby panel"><div className="lobby-top">{admin ? <span className="lobby-symbol"><Gamepad2 /></span> : <Avatar id={me?.avatarId} className="lobby-avatar" />}<h1>{admin ? 'Que entre el equipo.' : `¡Estás dentro, ${me?.nickname}!`}</h1></div>
    {admin ? <button className="room-code-large" onClick={() => onCopy(true)} aria-label={`Copiar código ${room.code}`}><small>CÓDIGO DE SALA</small><strong>{room.code}</strong><span><Copy size={15} />Copiar código</span></button> : <div className="waiting-badge"><span className="waiting-dots"><i /><i /><i /></span>El anfitrión está preparando la partida</div>}
    <div className="players-label"><span><Users size={18} />{players.length} {players.length === 1 ? 'jugador' : 'jugadores'}</span><span>{players.length}/50</span></div>
    <div className="player-cloud">{players.map(player => <motion.div {...transition} key={player.id} className={`player-chip ${player.id === session.playerId ? 'is-me' : ''}`}><Avatar id={player.avatarId} /><span>{player.nickname}</span>{admin && <button className="remove-player" aria-label={`Retirar a ${player.nickname}`} onClick={() => onRemove(player)}><X size={15} /></button>}</motion.div>)}{!players.length && <p className="muted">Comparte el código para empezar.</p>}</div>
    {admin && <button className="text-button share-button" onClick={() => onCopy(false)}><Copy size={16} />Copiar enlace de invitación</button>}
  </section>;
}

function LegacyRequestEditor({ question, value, onChange, disabled }) {
  return <div className="request-editor"><div className="request-editor-top"><span className="editor-dot" /><span className="editor-dot" /><span className="editor-dot" /><span>Tu petición</span></div><div className="request-line"><label htmlFor="method"><span>Método</span><select id="method" value={value.method} disabled={disabled} onChange={event => onChange({ ...value, method: event.target.value })} required><option value="">Elegir</option>{['GET','POST','PUT','PATCH','DELETE'].map(method => <option key={method}>{method}</option>)}</select></label><label htmlFor="path"><span>Ruta</span><input id="path" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value.path} disabled={disabled} placeholder="/api/…" maxLength={200} onChange={event => onChange({ ...value, path: event.target.value })} /></label></div>
    {question.requiresBody && <label className="body-field" htmlFor="body"><span>Cuerpo JSON</span><textarea id="body" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={4000} value={value.body} disabled={disabled} placeholder={'{\n  "campo": "valor"\n}'} onChange={event => onChange({ ...value, body: event.target.value })} /></label>}
  </div>;
}

function RequestEditor({question,value,onChange,disabled}) {
  if (!question.endpoint) return <LegacyRequestEditor question={question} value={value} onChange={onChange} disabled={disabled}/>;
  let body={};try { body=JSON.parse(value.body||'{}'); } catch { /* Incomplete legacy text is replaced by the guided form. */ }
  function field(key,entry) { onChange({...value,body:JSON.stringify({...body,[key]:entry})}); }
  return <div className="guided-request"><div className="endpoint-context"><small>Dirección de este ejemplo · ya está dada</small><strong>{question.endpointLabel}</strong><code>{question.endpoint}</code><span>La dirección identifica dónde están los datos.</span></div><fieldset disabled={disabled} className="method-picker"><legend>1. Elige el método HTTP</legend><div>{['GET','POST','PUT','PATCH','DELETE'].map(method=><button key={method} type="button" aria-pressed={value.method===method} className={value.method===method?'chosen':''} onClick={()=>onChange({...value,method})}>{method}</button>)}</div></fieldset>{question.fields?.length>0&&<fieldset disabled={disabled} className="request-fields"><legend>2. Completa el dato que enviarás</legend>{question.fields.map(f=><div className="guided-field" key={f.key}>{f.kind==='boolean'?<><span id={`field-${f.key}`}>{f.label}</span><div className="boolean-picker" role="group" aria-labelledby={`field-${f.key}`}>{[[true,'Sí'],[false,'No']].map(([entry,label])=><button type="button" key={label} aria-pressed={body[f.key]===entry} onClick={()=>field(f.key,entry)}>{label}</button>)}</div></>:<label>{f.label}<input autoComplete="off" maxLength={100} value={body[f.key]??''} placeholder={f.placeholder} onChange={event=>field(f.key,event.target.value)}/></label>}</div>)}</fieldset>}<Code title="Tu petición" language="HTTP / JSON" text={`${value.method||'[método]'} ${question.endpoint}${question.fields?.length?'\n'+JSON.stringify(body,null,2):''}`}/></div>;
}

function OrderEditor({ question, value, onChange, disabled }) {
  const chosen = value.map(id => question.items.find(item => item.id === id));
  function move(index, direction) { const next = [...value]; [next[index], next[index+direction]] = [next[index+direction], next[index]]; onChange(next); }
  return <div className="order-editor"><p className="editor-hint">Toca los pasos en el orden correcto. Puedes cambiarlos antes de enviar.</p><ol className="ordered-steps" aria-label="Tu secuencia">{chosen.map((item,index) => <li key={item.id}><span className="step-number">{index+1}</span><code>{item.text}</code><div className="step-actions"><button className="icon-button" aria-label={`Subir paso ${index+1}`} disabled={disabled || index===0} onClick={() => move(index,-1)}><ArrowUp size={17}/></button><button className="icon-button" aria-label={`Bajar paso ${index+1}`} disabled={disabled || index===value.length-1} onClick={() => move(index,1)}><ArrowDown size={17}/></button><button className="icon-button" aria-label={`Quitar paso ${index+1}`} disabled={disabled} onClick={() => onChange(value.filter(id => id!==item.id))}><X size={17}/></button></div></li>)}</ol><div className="step-bank" aria-label="Pasos disponibles">{question.items.filter(item => !value.includes(item.id)).map(item => <button key={item.id} disabled={disabled} onClick={() => onChange([...value,item.id])}><span>+</span><code>{item.text}</code></button>)}</div><span className="muted">{value.length}/{question.items.length} pasos</span></div>;
}

function CodeEditor({ question, value, onChange, disabled }) {
  const [active,setActive]=useState(0);
  const blank=question.blanks[active];
  function pick(token) { const next=value.map((v,i)=>i===active?token:v);onChange(next);const empty=next.findIndex(v=>!v);if(empty>=0)setActive(empty); }
  return <div className="code-workspace"><p className="editor-hint">Toca un espacio y elige una ficha. Puedes cambiarla antes de enviar.</p><Code text={question.template} title="Completa las piezas" renderSlot={i=><button type="button" className={`code-slot ${active===i?'active':''} ${value[i]?'filled':''}`} aria-label={`Espacio ${i+1}: ${question.blanks[i].label}`} aria-pressed={active===i} disabled={disabled} onClick={()=>setActive(i)}><small>{i+1}</small>{value[i]||'Elegir'}</button>}/><div className="token-picker"><span className="slot-label">{active+1}. {blank.label}</span>{blank.choices?<div className="token-choices" role="group" aria-label={blank.label}>{blank.choices.map(token=><button key={token} type="button" aria-pressed={value[active]===token} disabled={disabled} onClick={()=>pick(token)}><code><Syntax text={token}/></code></button>)}</div>:<input aria-label={blank.label} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={80} disabled={disabled} value={value[active]} onChange={event=>onChange(value.map((entry,i)=>i===active?event.target.value:entry))}/>}</div></div>;
}

function Question({ room, session, busy, onAnswer }) {
  const question = room.currentQuestion;
  const [value, setValue] = useState(room.answer?.value ?? (question.type === 'request' ? { method: '', path: question.endpoint || '', body: '' } : question.type === 'order' ? [] : question.type === 'code' ? question.blanks.map(() => '') : null));
  const sending = useRef(false);
  const remaining = useRemaining(room.deadline);
  const admin = session.role === 'admin';
  const sent = Boolean(room.answer);
  const locked = admin || sent || remaining <= 0 || busy || Boolean(room.connectionError);
  const ratio = Math.max(0, Math.min(1, remaining * 1000 / (room.deadline-room.startedAt)));
  let fieldsReady=true;
  if(question.fields?.length){try{const body=JSON.parse(value.body||'{}');fieldsReady=question.fields.every(f=>f.kind==='boolean'?typeof body[f.key]==='boolean':typeof body[f.key]==='string'&&body[f.key].trim().length>0);}catch{fieldsReady=false;}}
  const valid = question.type === 'request' ? value.method && value.path.trim().startsWith('/') && fieldsReady && (!question.requiresBody || value.body.trim()) : question.type === 'order' ? value.length === question.items.length : question.type === 'code' ? value.every(entry => entry.trim()) : value !== null;
  async function send(answer) { if (locked || sending.current) return; sending.current = true; const ok = await onAnswer(answer); if (!ok) sending.current = false; }
  const typeLabel = {quiz:'Elige una',order:'Ordena los pasos',code:'Completa el código',request:'Construye la petición'}[question.type];
  return <section className={`question panel ${remaining <= 5 ? 'question-urgent' : ''}`}><div className="question-top"><span className="question-type"><Code2 size={17}/>{typeLabel}</span><span className="question-value"><Zap size={16} />{number(question.points)} pts</span></div>
    <div className="timer-track" role="progressbar" aria-label="Tiempo restante" aria-valuemin={0} aria-valuemax={Math.ceil((room.deadline-room.startedAt)/1000)} aria-valuenow={Math.ceil(remaining)}><div style={{ width: `${ratio*100}%` }} /></div>
    <div className="question-copy"><h1>{question.title}</h1><p>{question.prompt}</p></div>{question.code && <Code text={question.code} title="Datos del ejemplo" language="Referencia"/>}
    {sent ? <div className="answer-sent" role="status"><span className="sent-icon"><CheckCheck /></span><h2>¡Respuesta enviada!</h2><p>Tu misión está en manos del servidor.</p><span className="waiting-dots"><i /><i /><i /></span></div> : <>{question.type === 'request' ? <RequestEditor question={question} value={value} onChange={setValue} disabled={locked} /> : question.type === 'order' ? <OrderEditor question={question} value={value} onChange={setValue} disabled={locked}/> : question.type === 'code' ? <CodeEditor question={question} value={value} onChange={setValue} disabled={locked}/> : <><p className="editor-hint">Un toque y queda enviada.</p><div className="answer-grid">{question.options.map((option, index) => <button key={index} className={`answer-option ${value === index ? 'selected' : ''}`} aria-pressed={value === index} disabled={locked} onClick={() => { setValue(index); void send(index); }}><span className="answer-number">{String(index+1).padStart(2,'0')}</span><span>{question.optionsAreCode?<code><Syntax text={option}/></code>:option}</span>{value === index && <Check className="option-check" size={21} />}</button>)}</div></>}
    {!admin && question.type!=='quiz' && <Button className="submit-answer" disabled={!valid || locked} busy={busy} onClick={() => send(value)}>{remaining <= 0 ? '¡Tiempo!' : 'Enviar respuesta'}<Send size={19} /></Button>}</>}
    <div className="question-bottom"><span><Users size={16} />{room.answeredCount}/{Object.keys(room.players).length} respuestas</span><span className={`time-number ${remaining <= 5 ? 'urgent' : ''}`}><Timer size={19} /><strong>{Math.ceil(remaining)}</strong><small>s</small></span></div>
    {remaining <= 0 && <p className="waiting-caption" role="status">Cerrando reto…</p>}
  </section>;
}

function Solution({ question:q }) {
  const code = q.type==='request' ? `${q.request.method} ${q.request.path}${q.request.body ? `\n${JSON.stringify(q.request.body,null,2)}` : ''}` : q.type==='code' ? q.template.replace(/\{\{(\d+)\}\}/g,(_,i) => q.answer[Number(i)]) : q.optionsAreCode?q.options[q.answer]:null;
  return <section className="solution" aria-label="Solución y explicación"><h2><CheckCheck size={20}/>Solución</h2>{code ? <Code text={code} title="Respuesta correcta" language={q.type==='request'?'HTTP / JSON':q.type==='quiz'?'JSON':'PHP'}/> : q.type==='order' ? <ol>{q.answer.map(id => <li key={id}><code>{q.items.find(item => item.id===id)?.text}</code></li>)}</ol> : <strong>{q.options[q.answer]}</strong>}<p>{q.explanation}</p></section>;
}

function Result({ room, session }) {
  const answer = room.answer;
  const admin = session.role === 'admin';
  const correct = answer?.correct;
  const text = admin ? '¡Reto cerrado!' : correct ? '¡Bien jugado!' : answer ? '¡La próxima es tuya!' : '¡Se acabó el tiempo!';
  return <div className="result-stack"><section className={`result panel ${admin ? 'result-neutral' : correct ? 'result-correct' : 'result-wrong'}`}><div className="result-burst">{admin ? <CheckCheck /> : correct ? <Zap fill="currentColor" /> : <X />}</div><h1>{text}</h1>{!admin && <div className="earned-points">+{number(answer?.earned)}<span>puntos</span></div>}{correct && answer?.streakBonus > 0 && <span className="streak-pill"><Flame size={17} />¡En racha! +{answer.streakBonus}</span>}</section><Solution question={room.currentQuestion}/><Leaderboard room={room} session={session}/></div>;
}

function Countdown({ room }) {
  const remaining = useRemaining(room.transitionAt);
  return <section className="countdown panel" aria-label="Cuenta regresiva"><span className="countdown-label">Equipo listo</span><h1>La misión empieza en…</h1><div className="countdown-dial" style={{'--progress':`${Math.min(1,remaining/5)*360}deg`}}><strong role="timer">{Math.ceil(remaining) || '¡Ya!'}</strong></div><p>Prepara tu ingenio.</p></section>;
}

function Intermission({ room, session }) {
  const remaining = useRemaining(room.transitionAt);
  return <div className="scoreboard-stage"><div className="next-countdown" role="status"><Timer size={22}/><span>{room.questionIndex+1 >= room.questionCount ? 'El ganador aparece en' : 'Siguiente reto en'} <strong>{Math.ceil(remaining) || '…'}</strong></span></div><Leaderboard room={room} session={session}/></div>;
}

function Final({ room, session }) {
  const players = ranking(room);
  const winner = players[0];
  const top = players.slice(0, 3);
  const order = top.length >= 2 ? [top[1], top[0], ...top.slice(2)] : top;
  const ownPlace = players.findIndex(player => player.id === session.playerId);
  return <div className="final-stack"><section className="final panel"><div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--i':i }} />)}</div><Trophy className="final-trophy" size={51} /><h1>¡Tenemos {top.length ? 'ganador' : 'resultado'}!</h1>{winner && <p className="winner-name">{winner.nickname}<Crown size={23} fill="currentColor" /></p>}<div className="podium">{order.map(player => {
    const place = players.findIndex(person => person.id === player.id);
    return <motion.div initial={{ opacity:0, y:30 }} animate={{ opacity:1, y:0 }} transition={{ delay: .1+place*.12 }} key={player.id} className={`podium-place podium-${place}`}><Avatar id={player.avatarId} /><strong>{player.nickname}</strong><span>{number(player.score)}</span><div>{place+1}<small>{place === 0 ? 'LA CORONA ES TUYA' : 'BIEN JUGADO'}</small></div></motion.div>;
  })}</div>{ownPlace >= 0 && <div className="personal-result"><strong>#{ownPlace+1}</strong><span>Tu puesto</span><strong>{number(players[ownPlace].score)}</strong><span>puntos</span></div>}</section><Leaderboard room={room} session={session} final /></div>;
}

function Room({ session, onLeave, onHelp }) {
  const [room, setRoom] = useState(() => roomService.getRoom());
  const [loaded, setLoaded] = useState(Boolean(room));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [invite, setInvite] = useState('');
  const admin = session.role === 'admin';
  useEffect(() => roomService.subscribe(() => { setRoom(roomService.getRoom()); setLoaded(true); }), [session.roomId, session.code]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setError(''); if (room?.phase) window.scrollTo({ top:0, behavior:'instant' }); }, [room?.phase, room?.questionIndex]);
  async function perform(operation) {
    if (busy) return false;
    setBusy(true); setError('');
    try { await operation(); return true; } catch (err) { setError(err.message); return false; } finally { setBusy(false); }
  }
  async function copy(codeOnly) {
    const url = new URL(location.pathname, location.origin);
    if (['localhost','127.0.0.1'].includes(location.hostname) && room.inviteOrigin) {
      const origin = new URL(room.inviteOrigin); url.host=origin.host; url.protocol=origin.protocol; url.pathname=origin.pathname;
    }
    url.searchParams.set('sala',room.code);
    try { await navigator.clipboard.writeText(codeOnly ? room.code : url.href); setToast(codeOnly ? '¡Código copiado!' : '¡Enlace copiado!'); }
    catch { setInvite(codeOnly ? room.code : url.href); }
  }
  if (!loaded) return <main className="connection-screen"><Brand large /><LoaderCircle className="spin" size={36} /><p>Entrando a tu sala…</p></main>;
  if (!room) return <main className="connection-screen"><Brand large /><h1>No pudimos abrir la sala.</h1><p className="error" role="alert">{roomService.getError() || 'Vuelve a entrar con el código.'}</p><Button onClick={() => { roomService.clearSession(); onLeave(); }}>Volver al inicio<ArrowLeft size={18} /></Button></main>;
  const count = Object.keys(room.players).length;
  const me = room.players[session.playerId];
  const total = room.questionCount || 12;
  const questionNumber = room.questionIndex+1;
  const action = { lobby:'start', question:'next', reveal:'next', finished:'restart' }[room.phase];
  const actionLabel = { lobby:'¡Empezar!', question:'Siguiente', reveal:'Siguiente', finished:'Volver a jugar' }[room.phase];
  return <div className={`room-page ${admin ? 'host-view' : 'guest-view'}`}><header className="room-header"><Brand /><div className="room-header-actions"><span className="room-code-small">SALA <strong>{room.code}</strong></span><button className="icon-button" onClick={onHelp} aria-label="Cómo se juega"><CircleHelp size={20} /></button><button className="icon-button" onClick={() => setLeaving(true)} aria-label="Salir de la sala"><LogOut size={20} /></button></div></header>
    <main className="room-main"><div className="game-status"><span>{room.phase === 'lobby' ? <><span className="status-dot" />Sala abierta</> : room.phase === 'countdown' ? <>Preparados…</> : room.phase === 'finished' ? <><Crown size={18} />Partida terminada</> : <>Reto <strong>{questionNumber}<span> / {total}</span></strong></>}</span>{admin ? <span className="host-label"><ShieldCheck size={15} />Anfitrión</span> : me && <span className="my-score"><Zap size={16} />{number(me.score)}<small>pts</small></span>}</div>
      <AnimatePresence mode="wait"><motion.div key={`${room.phase}-${room.questionIndex}`} {...transition}>
        {room.phase === 'lobby' ? <Lobby room={room} session={session} onRemove={setRemoving} onCopy={copy} /> : room.phase === 'countdown' ? <Countdown room={room}/> : room.phase === 'question' ? <Question room={room} session={session} busy={busy} onAnswer={value => perform(() => roomService.answer(session,value))} /> : room.phase === 'reveal' ? <Result room={room} session={session} /> : room.phase === 'scoreboard' ? <Intermission room={room} session={session}/> : <Final room={room} session={session} />}
      </motion.div></AnimatePresence>
      {room.connectionError && <p className="connection-warning" role="status">Reconectando… Espera antes de enviar tu respuesta.</p>}
      {error && <p className="error room-error" role="alert">{error}<button className="icon-button" onClick={() => setError('')} aria-label="Cerrar error"><X size={18} /></button></p>}
      {admin ? <div className="host-controls">{room.phase === 'lobby' && <label htmlFor="question-seconds"><Timer size={17} /><select id="question-seconds" aria-label="Tiempo por pregunta" disabled={busy} value={room.seconds} onChange={event => perform(() => roomService.updateSettings(session,Number(event.target.value)))}>{[20,30,45,60].map(seconds => <option key={seconds} value={seconds}>{seconds} s por pregunta</option>)}</select></label>}{action && <Button busy={busy} disabled={Boolean(room.connectionError) || room.phase==='lobby' && count===0} onClick={() => perform(() => roomService.act(session,action))}>{actionLabel}{action==='start' ? <Play size={19} fill="currentColor" /> : <ArrowRight size={19} />}</Button>}</div> : ['reveal','finished'].includes(room.phase) && <p className="waiting-caption"><span className="waiting-dots"><i /><i /><i /></span>{room.phase==='finished' ? 'Espera la próxima partida' : 'El anfitrión continúa en un momento'}</p>}
    </main>
    {toast && <div className="toast" role="status"><Check size={18} />{toast}</div>}
    {invite && <Modal title="Comparte la sala" onClose={() => setInvite('')}><input aria-label="Invitación" className="invite-input" readOnly value={invite} onFocus={event => event.target.select()} /><Button onClick={() => setInvite('')}>Listo<Check size={18} /></Button></Modal>}
    {leaving && <Modal title="¿Salir de la sala?" onClose={() => setLeaving(false)}><p>{admin ? 'Puedes recuperar el control con tu cuenta y el código.' : room.phase==='lobby' ? 'Se quitará tu nombre de la sala.' : 'Tus puntos se conservan. Puedes volver con el código desde esta pestaña.'}</p><div className="modal-actions"><Button className="secondary" onClick={() => setLeaving(false)}>Me quedo</Button><Button busy={busy} onClick={async () => { if (await perform(() => roomService.leave(session))) onLeave(); }}>Salir<LogOut size={18} /></Button></div></Modal>}
    {removing && <Modal title={`¿Retirar a ${removing.nickname}?`} onClose={() => setRemoving(null)}><p>Podrá volver a entrar con el código.</p><div className="modal-actions"><Button className="secondary" onClick={() => setRemoving(null)}>Cancelar</Button><Button busy={busy} onClick={async () => { if (await perform(() => roomService.removePlayer(session,removing.id))) setRemoving(null); }}>Retirar<X size={18} /></Button></div></Modal>}
  </div>;
}

export default function App() {
  const [session,setSession] = useState(() => roomService.getSession());
  const [help,setHelp] = useState(false);
  return <MotionConfig reducedMotion="user">{session ? <Room session={session} onLeave={() => setSession(null)} onHelp={() => setHelp(true)} /> : <Entry onEnter={setSession} onHelp={() => setHelp(true)} />}{help && <Help onClose={() => setHelp(false)} />}</MotionConfig>;
}
