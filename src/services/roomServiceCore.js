export function createRoomService(supabase, storage, environment={}) {
const {window,document}=environment;
const connectionId=environment.randomUUID?.()??crypto.randomUUID();
let attached=false;
let departing=false;
let accessToken=null;

const SESSION = 'rest-arena:v3:session';
let activeSession = null;
let room = null;
let channel = null;
let deadlineTimer = null;
let retryTimer = null;
let stateRetryTimer = null;
let terminalError = false;
let heartbeat = null;
let heartbeatStart = null;
let offset = 0;
let lastError = '';
let generation = 0;
let refreshing = false;
let refreshAgain = false;
let refreshAgainAction='state';
const listeners = new Set();

function message(error) {
  if (/anonymous.*disabled|Anonymous sign-ins are disabled/i.test(error.message)) return 'El acceso de invitados todavía no está habilitado. Avisa al anfitrión.';
  if (error.code === 'PGRST202' || error.code === '42P01') return 'El juego todavía no está configurado. Avisa al anfitrión.';
  if (/fetch|network/i.test(error.message)) return 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  if (/Invalid login credentials/i.test(error.message)) return 'Correo o contraseña incorrectos.';
  if (/rate.*limit|too many requests/i.test(error.message)) return 'Demasiados accesos desde esta red. Avisa al anfitrión o espera un momento.';
  return error.message || 'No se pudo completar la acción.';
}

function emit(next) {
  if (room && next && room.id === next.id && next.revision < room.revision) return;
  room = next;
  listeners.forEach(listener => listener(room));
  clearTimeout(deadlineTimer);
  const stageDeadline=room?.phase==='question'?room.deadline:['countdown','scoreboard'].includes(room?.phase)?room.transitionAt:null;
  const targets=[stageDeadline,room?.presenceDeadline,room?.endAt].filter(value=>Number.isFinite(value)&&value>0);
  const target=targets.length?Math.min(...targets):null;
  if (target) {
    // One request at the deadline, not one database write per timer tick.
    deadlineTimer = setTimeout(refresh, room.connectionError ? 5000 : Math.max(150, target - roomService.now() + 200));
  }
}

async function rpc(action, payload = {}) {
  const { data, error } = await supabase.rpc('arena_command', { action, payload: {flowVersion:2,bankVersion:4,clientVersion:4,connectionId,background:Boolean(document?.hidden),...payload} }).abortSignal(AbortSignal.timeout(12000));
  if (error) throw new Error(message(error));
  if (data.room && data.room.flowVersion !== 2) throw new Error('Falta aplicar la actualización de ArtyQuest en Supabase. Avisa al anfitrión.');
  if (data.serverNow) offset = data.serverNow - Date.now();
  return data;
}

function acceptClosed(data){
  lastError=data.reason||'La sala terminó.';terminalError=true;
  activeSession=null;storage.removeItem(SESSION);disconnect();emit(null);
}

async function refresh(action='state') {
  if (!activeSession || !listeners.size || departing) return;
  if (refreshing) { refreshAgain = true;if(action==='heartbeat')refreshAgainAction='heartbeat';return; }
  const version = generation;
  refreshing = true;
  try {
    // Wait for Supabase to restore/refresh this tab's identity before reading the room.
    // Never create another anonymous user while recovering a saved game.
    const identity = await supabase.auth.getSession();
    if (identity.error) throw new Error(message(identity.error));
    if (!identity.data.session) throw new Error('No se pudo recuperar tu acceso. Reintenta o vuelve a entrar con tu cuenta o código.');
    accessToken=identity.data.session.access_token||accessToken;
    const data = await rpc(attached?action:'attach', { roomId: activeSession.roomId });
    if (version !== generation) return;
    if(data.closed){acceptClosed(data);return;}
    attached=true;
    lastError = ''; terminalError = false;
    if(data.session) saveSession(data.session);
    emit({ ...data.room, connectionError: null });
  } catch (error) {
    if (version !== generation) return;
    lastError = error.message;
    terminalError = /Ya no formas parte|sala ya no/i.test(error.message);
    if (terminalError) emit(null);
    else {
      emit(room ? { ...room, connectionError: error.message } : null);
      clearTimeout(stateRetryTimer);
      stateRetryTimer = setTimeout(refresh,2500);
    }
  } finally {
    refreshing = false;
    if (refreshAgain) { const next=refreshAgainAction;refreshAgain=false;refreshAgainAction='state';void refresh(next); }
  }
}

function disconnect() {
  generation++;
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  clearTimeout(deadlineTimer);
  clearTimeout(retryTimer);
  clearTimeout(stateRetryTimer);
  clearInterval(heartbeat);
  clearTimeout(heartbeatStart);
}

function connect() {
  disconnect();
  attached=false;departing=false;
  if (!activeSession || !listeners.size) return;
  const version = generation;
  channel = supabase.channel(`room:${activeSession.roomId}:${version}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'arena_rooms', filter: `id=eq.${activeSession.roomId}`,
    }, () => { void refresh(); })
    .subscribe(status => {
      if (version !== generation) return;
      if (status === 'SUBSCRIBED') { void refresh(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (room) emit({ ...room, connectionError: 'Reconectando con la sala…' });
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 5000);
      }
    });
  // Recovery when a device resumes or misses an event; Realtime is the primary transport.
  heartbeatStart=setTimeout(()=>{void refresh('heartbeat');heartbeat=setInterval(()=>{void refresh('heartbeat');},20000);},Math.floor(Math.random()*3000));
  void refresh();
}

function saveSession(session) { activeSession=session; storage.setItem(SESSION,JSON.stringify(session)); }

async function accept(data) {
  if(data.closed)throw new Error(data.reason||'Esta sala ya terminó.');
  if(!data.session||!data.room)throw new Error('No se pudo abrir la sala.');
  saveSession(data.session);
  emit(data.room);
  if (listeners.size) connect();
  return activeSession;
}

async function command(session, action, payload = {}) {
  const data = await rpc(action, { roomId: session.roomId, ...payload });
  if(data.closed){acceptClosed(data);return null;}
  lastError = ''; terminalError=false;
  if(data.session) saveSession(data.session);
  emit(data.room);
  return data.room;
}

const roomService = {
  mode: 'supabase',
  now: () => Date.now() + offset,
  getError: () => lastError,
  canRetry: () => !terminalError,
  reconnect: () => connect(),
  getRoom: () => room,
  getSession() {
    try { activeSession = JSON.parse(storage.getItem(SESSION) || 'null'); }
    catch { activeSession = null; }
    if(activeSession && (!['admin','guest'].includes(activeSession.role) || typeof activeSession.roomId!=='string' || typeof activeSession.code!=='string')) activeSession=null;
    return activeSession;
  },
  setSession: saveSession,
  clearSession() { disconnect(); activeSession = null; lastError = '';terminalError=false; storage.removeItem(SESSION); emit(null); },
  subscribe(listener) {
    listeners.add(listener);
    if (listeners.size === 1) connect();
    return () => { listeners.delete(listener); if (!listeners.size) disconnect(); };
  },
  async loginAdmin({ username, password, code = '', seconds = 30 }) {
    const { error } = await supabase.auth.signInWithPassword({ email: username.trim(), password });
    if (error) throw new Error(message(error));
    return accept(await rpc('create', { code, seconds }));
  },
  async join({ code, nickname, avatarId }) {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new Error(message(sessionError));
    // Never reuse the host identity for a guest in the same tab.
    if (session && !session.user.is_anonymous) await supabase.auth.signOut({ scope: 'local' });
    if (!session || !session.user.is_anonymous) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error(message(error));
    }
    return accept(await rpc('join', { code, nickname, avatarId }));
  },
  act: (session, action) => command(session, action, {questionIndex:room?.questionIndex}),
  answer: (session, value) => command(session, 'answer', { value, questionIndex:room?.questionIndex }),
  removePlayer: (session, playerId) => command(session, 'remove', { playerId }),
  updateSettings: (session, seconds) => command(session, 'settings', { seconds }),
  async leave(session) { await command(session, session.role==='admin'?'close':'leave');try{await supabase.auth.signOut({scope:'local'});}catch{/* Room membership is already revoked. */}this.clearSession(); },
  dispose: () => disconnect(),
};

if (window && document) {
  window.addEventListener('online', () => { if (activeSession && listeners.size) connect(); });
  document.addEventListener('visibilitychange', () => { void refresh('heartbeat'); });
  window.addEventListener('pagehide',event=>{
    if(event.persisted||!activeSession)return;
    departing=true;
    if(accessToken)environment.sendDeparture?.({roomId:activeSession.roomId,connectionId,accessToken});
  });
  window.addEventListener('pageshow',event=>{if(event.persisted&&activeSession)connect();});
}

return roomService;
}
