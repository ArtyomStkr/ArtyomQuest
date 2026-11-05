import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const HOST='00000000-0000-0000-0000-000000000001';
const guest=i=>`10000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
// Synthetic fixtures only. Actual game challenges and solutions are never committed.
const bank=Array.from({length:12},(_,i)=>{
  const type=['quiz','order','code','request'][i%4];
  return {id:`fixture-${i}`,type,title:`Fixture ${i}`,prompt:`Private synthetic prompt ${i}`,explanation:`Private synthetic explanation ${i}`,points:type==='quiz'?1000:1500,
    ...(type==='quiz'?{options:['A','B','C','D'],answer:1}:type==='order'?{items:[{id:'v2',text:'Synthetic step B'},{id:'r7',text:'Synthetic step C'},{id:'n4',text:'Synthetic step A'}],answer:['n4','v2','r7']}:type==='code'?{template:'fixture.{{0}}(value, {{1}});',blanks:[{label:'Token'},{label:'Number'}],answer:['token','202']}:{request:{method:'PATCH',path:'/fixture/7',body:{enabled:true,count:2}}})};
});
const correct=q=>q.type==='request'?{method:'PATCH',path:'/fixture/7/',body:'{"count":2,"enabled":true}'}:q.answer;
const wrong=q=>q.type==='quiz'?0:q.type==='order'?[...q.answer].reverse():q.type==='code'?['wrong','202']:{method:'DELETE',path:'/wrong',body:'{}'};
const migration=()=>readFile(new URL('../supabase/migrations/002_artyquest.sql',import.meta.url),'utf8');

async function setup(t,{upgrade=true}={}){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create publication supabase_realtime;`);
  await db.exec(await readFile(new URL('../supabase/migrations/001_arena.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1)',[HOST]);await db.query('insert into arena_private.admins values($1)',[HOST]);
  for(let i=1;i<=55;i++)await db.query('insert into auth.users values($1)',[guest(i)]);
  for(let i=0;i<12;i++)await db.query('insert into arena_private.questions(position,payload) values($1,$2)',[i,JSON.stringify({id:`old-${i}`,type:'quiz',title:'Legacy',prompt:'Legacy synthetic',options:['A','B'],answer:1,points:1000,explanation:'Legacy fixture'})]);
  const apply=async()=>{await db.exec(await migration());for(let i=0;i<12;i++)await db.query('insert into arena_private.questions(version,position,payload) values(2,$1,$2) on conflict(version,position) do update set payload=excluded.payload',[i,JSON.stringify(bank[i])]);await db.exec(await readFile(new URL('../supabase/migrations/003_mobile_challenges.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/004_presence_and_variety.sql',import.meta.url),'utf8'));};
  if(upgrade)await apply();
  async function as(uid,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
  const command=(uid,action,payload={})=>as(uid,async()=>(await db.query('select public.arena_command($1,$2) as data',[action,JSON.stringify({flowVersion:2,...payload})])).rows[0].data);
  const tick=async(id,uid=HOST)=>{await db.query("update public.arena_rooms set transition_at=clock_timestamp()-interval '1 millisecond' where id=$1",[id]);return command(uid,'state',{roomId:id});};
  async function room(players=1){const created=await command(HOST,'create',{seconds:20});for(let i=1;i<=players;i++)await command(guest(i),'join',{code:created.room.code,nickname:`Player${i}`,avatarId:i%60});return created.room;}
  return {db,as,command,tick,room,apply};
}

test('ArtyQuest: cinco segundos sincronizados, sin pregunta ni respuestas antes de empezar',async t=>{
  const {db,command,tick,room}=await setup(t);const r=await room();
  const start=await command(HOST,'start',{roomId:r.id});
  assert.equal(start.room.phase,'countdown');assert.equal(start.room.currentQuestion,null);assert.equal(start.room.questionIndex,-1);
  assert.ok(start.room.transitionAt-start.serverNow>=4900 && start.room.transitionAt-start.serverNow<=5000);
  assert.equal((await command(guest(1),'answer',{roomId:r.id,questionIndex:0,value:1})).room.phase,'countdown');
  assert.equal((await db.query('select count(*) from arena_private.answers')).rows[0].count,0);
  const opened=await tick(r.id);assert.equal(opened.room.phase,'question');assert.equal(opened.room.questionIndex,0);assert.equal(opened.room.currentQuestion.answer,undefined);
});

test('ArtyQuest: 50 jugadores y 12 retos, cierre al responder todos y transición automática con un Siguiente',async t=>{
  const {db,command,tick,room}=await setup(t);const r=await room(50);
  await assert.rejects(command(guest(51),'join',{code:r.code,nickname:'Extra',avatarId:0}),/llena/);
  await command(HOST,'start',{roomId:r.id});let state=await tick(r.id);
  for(let index=0;index<12;index++){
    const q=bank[index];assert.equal(state.room.phase,'question');assert.equal(state.room.questionIndex,index);assert.equal(state.room.questionCount,12);
    for(const key of ['answer','request','solution','explanation'])assert.equal(state.room.currentQuestion[key],undefined);
    assert.equal(state.room.deadline-state.room.startedAt,q.type==='quiz'?20000:40000);
    const publicRow=(await db.query('select question_public from public.arena_rooms where id=$1',[r.id])).rows[0].question_public;
    for(const key of ['answer','request','solution','explanation'])assert.equal(publicRow[key],undefined);
    if(q.type==='order')assert.notDeepEqual(publicRow.items.map(x=>x.id),q.answer,'Public choices must not already be the solution');
    const answered=await command(guest(1),'answer',{roomId:r.id,questionIndex:index,value:correct(q),earned:999999,elapsed:-1,correct:true});
    assert.equal(answered.room.phase,'question');assert.equal(answered.room.answer.correct,undefined);assert.equal(answered.room.answer.earned,undefined);
    await assert.rejects(command(guest(1),'answer',{roomId:r.id,questionIndex:index,value:correct(q)}),/Ya enviaste/);
    for(let i=2;i<=50;i++)state=await command(guest(i),'answer',{roomId:r.id,questionIndex:index,value:wrong(q)});
    assert.equal(state.room.phase,'reveal');assert.equal(state.room.answeredCount,50);
    const own=await command(guest(1),'state',{roomId:r.id});assert.equal(own.room.answer.correct,true);assert.ok(own.room.answer.earned>=q.points);assert.ok(own.room.answer.earned<=q.points+750);assert.equal(own.room.answer.streakBonus,index>=2?250:0);
    assert.equal(state.room.answer.earned,100);const scores=own.room.players;
    state=await command(HOST,'next',{roomId:r.id,questionIndex:index});assert.equal(state.room.phase,'scoreboard');
    assert.deepEqual(state.room.players,scores);
    const repeat=await command(HOST,'next',{roomId:r.id,questionIndex:index});assert.equal(repeat.room.transitionAt,state.room.transitionAt);
    state=await tick(r.id);
  }
  assert.equal(state.room.phase,'finished');
  state=await command(HOST,'restart',{roomId:r.id});assert.equal(state.room.phase,'lobby');assert.equal(state.room.currentQuestion,null);assert.equal(Object.keys(state.room.players).length,50);
  assert.ok(Object.values(state.room.players).every(p=>p.score===0 && p.streak===0));assert.equal((await db.query('select count(*) from arena_private.answers')).rows[0].count,0);
});

test('ArtyQuest: RLS y funciones privadas impiden leer soluciones, alterar puntos o suplantar al anfitrión',async t=>{
  const {db,as,command,room}=await setup(t);const r=await room();
  await assert.rejects(command(null,'create'),/sesión terminó/);await assert.rejects(command(guest(1),'create'),/administrador/);
  for(const table of ['admins','questions','answers'])await assert.rejects(as(guest(1),()=>db.query(`select * from arena_private.${table}`)),/permission denied/);
  await assert.rejects(as(guest(1),()=>db.exec('update public.arena_players set score=999999')),/permission denied/);
  await assert.rejects(as(HOST,()=>db.exec("update public.arena_rooms set phase='finished'")),/permission denied/);
  for(const action of ['start','next','reveal','scoreboard','restart','settings','remove'])await assert.rejects(command(guest(1),action,{roomId:r.id,seconds:20}),/administrador/);
  assert.equal((await as(guest(2),()=>db.query('select * from public.arena_rooms'))).rows.length,0);
  await assert.rejects(command(guest(2),'state',{roomId:r.id}),/formas parte/);
  await assert.rejects(as(guest(1),()=>db.query('select arena_private.advance($1)',[r.id])),/permission denied/);
  const player=(await command(guest(1),'state',{roomId:r.id})).session.playerId;await command(HOST,'remove',{roomId:r.id,playerId:player});
  await assert.rejects(command(guest(1),'state',{roomId:r.id}),/formas parte/);
});

test('ArtyQuest: validación de secuencias, espacios de código y JSON sin ejecutar entradas',async t=>{
  const {db}=await setup(t);
  const check=async(q,v)=>(await db.query('select arena_private.correct_answer($1,$2) as ok',[JSON.stringify(q),JSON.stringify(v)])).rows[0].ok;
  const validate=(q,v)=>db.query('select arena_private.validate_answer($1,$2)',[JSON.stringify(q),JSON.stringify(v)]);
  assert.equal(await check(bank[1],bank[1].answer),true);assert.equal(await check(bank[1],[...bank[1].answer].reverse()),false);
  for(const invalid of [['n4','n4','r7'],['n4','v2'],['n4','v2','not-an-item']])await assert.rejects(validate(bank[1],invalid),/pasos|secuencia/);
  assert.equal(await check(bank[2],[' TOKEN ',' 202 ']),true);assert.equal(await check(bank[2],['process.exit()','202']),false);
  await assert.rejects(validate(bank[2],['token']),/espacios/);await assert.rejects(validate(bank[2],['token',202]),/espacios/);
  assert.equal(await check(bank[3],correct(bank[3])),true);assert.equal(await check(bank[3],{...correct(bank[3]),body:'{"enabled":"true","count":2}'}),false);
  await assert.rejects(validate(bank[3],{...correct(bank[3]),body:'not JSON'}),/JSON/);
});

test('ArtyQuest: reloj autoritativo, Siguiente durante el reto y peticiones atrasadas no saltan preguntas',async t=>{
  const {db,command,tick,room}=await setup(t);const r=await room();await command(HOST,'start',{roomId:r.id});await tick(r.id);
  let state=await command(HOST,'next',{roomId:r.id,questionIndex:0});assert.equal(state.room.phase,'scoreboard');
  state=await tick(r.id);assert.equal(state.room.questionIndex,1);
  state=await command(HOST,'next',{roomId:r.id,questionIndex:0});assert.equal(state.room.phase,'question');assert.equal(state.room.questionIndex,1);
  state=await command(guest(1),'answer',{roomId:r.id,questionIndex:0,value:1});assert.equal(state.room.answeredCount,0);
  await db.query("update public.arena_rooms set started_at=clock_timestamp()-interval '50 seconds',deadline=clock_timestamp()-interval '10 seconds' where id=$1",[r.id]);
  state=await command(guest(1),'answer',{roomId:r.id,questionIndex:1,value:bank[1].answer});assert.equal(state.room.phase,'reveal');assert.equal(state.room.answer,null);assert.ok(Object.values(state.room.players).every(p=>p.score===0));
});

test('ArtyQuest: la actualización conserva salas, banco anterior, cuentas y permisos; se puede reaplicar',async t=>{
  const {db,command,apply}=await setup(t,{upgrade:false});
  const old=await command(HOST,'create',{flowVersion:1});await command(guest(1),'join',{flowVersion:1,code:old.room.code,nickname:'Legacy',avatarId:0});await command(HOST,'start',{flowVersion:1,roomId:old.room.id});await command(guest(1),'answer',{flowVersion:1,roomId:old.room.id,value:1});
  await apply();await apply();
  let state=await command(guest(1),'state',{flowVersion:1,roomId:old.room.id});assert.equal(state.room.phase,'question');assert.equal(state.room.answer.correct,undefined);
  await command(HOST,'reveal',{flowVersion:1,roomId:old.room.id});state=await command(guest(1),'state',{flowVersion:1,roomId:old.room.id});assert.equal(state.room.answer.correct,true);
  await command(HOST,'scoreboard',{flowVersion:1,roomId:old.room.id});state=await command(HOST,'next',{flowVersion:1,roomId:old.room.id});assert.equal(state.room.phase,'question');assert.equal(state.room.questionIndex,1);
  assert.equal((await db.query('select count(*) from arena_private.admins')).rows[0].count,1);
  assert.equal((await db.query('select count(*) from arena_private.questions')).rows[0].count,24);
  const fresh=await command(HOST,'create');assert.equal(fresh.room.gameVersion,2);assert.equal(fresh.room.questionCount,12);
});

test('ArtyQuest móvil: nuevo banco aislado y 80 avatares sin alterar una partida anterior',async t=>{
  const {db,command,tick,room}=await setup(t);const old=await room();await command(HOST,'start',{roomId:old.id});await tick(old.id);
  for(let i=0;i<12;i++)await db.query('insert into arena_private.questions(version,position,payload) values(3,$1,$2)',[i,JSON.stringify({...bank[i],id:`mobile-fixture-${i}`})]);
  const fresh=(await command(HOST,'create',{bankVersion:3})).room;assert.equal(fresh.gameVersion,3);
  await command(guest(2),'join',{bankVersion:3,code:fresh.code,nickname:'Avatar80',avatarId:79});
  await assert.rejects(command(guest(3),'join',{bankVersion:3,code:fresh.code,nickname:'BadAvatar',avatarId:80}),/avatar válido/);
  await command(HOST,'start',{roomId:fresh.id,bankVersion:3});let state=await tick(fresh.id);
  assert.equal(state.room.currentQuestion.id,'mobile-fixture-0');
  state=await command(guest(2),'answer',{roomId:fresh.id,bankVersion:3,questionIndex:0,value:1});assert.equal(state.room.phase,'reveal');assert.equal(state.room.answer.correct,true);
  state=await command(guest(1),'state',{roomId:old.id});assert.equal(state.room.gameVersion,2);assert.equal(state.room.currentQuestion.id,'fixture-0');assert.equal(state.room.currentQuestion.answer,undefined);
});
