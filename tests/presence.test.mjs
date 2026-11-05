import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const HOST='00000000-0000-0000-0000-000000000001';
const guest=i=>`10000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create publication supabase_realtime;`);
 for(const file of ['001_arena.sql','002_artyquest.sql','003_mobile_challenges.sql','004_presence_and_variety.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 for(const id of [HOST,...Array.from({length:55},(_,i)=>guest(i+1))])await db.query('insert into auth.users values($1)',[id]);await db.query('insert into arena_private.admins values($1)',[HOST]);
 for(let i=0;i<12;i++)await db.query('insert into arena_private.questions(version,position,payload) values(4,$1,$2)',[i,JSON.stringify({id:'presence-fixture-'+i,type:'quiz',prompt:'Synthetic',options:['One','Two'],answer:1,explanation:'Synthetic',points:1000})]);
 async function as(uid,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
 const command=(uid,action,payload={})=>as(uid,async()=>(await db.query('select public.arena_command($1,$2) data',[action,JSON.stringify({clientVersion:4,flowVersion:2,bankVersion:4,connectionId:uid,...payload})])).rows[0].data);
 const tick=async id=>{await db.query("update public.arena_rooms set transition_at=clock_timestamp()-interval '1 millisecond' where id=$1",[id]);return command(HOST,'state',{roomId:id});};
 async function room(n=2){const r=(await command(HOST,'create')).room;for(let i=1;i<=n;i++)await command(guest(i),'join',{code:r.code,nickname:'Person'+i,avatarId:0,ip:'same-network'});return r;}
 return {db,as,command,tick,room};
}

test('Presencia: cerrar pestaña tiene margen, refresh invalida el aviso viejo y minimizar conserva conexión',async t=>{
 const {db,command,room}=await setup(t),r=await room();
 await command(guest(1),'depart',{roomId:r.id});let state=await command(HOST,'state',{roomId:r.id});assert.equal(Object.keys(state.room.players).length,2);
 const replacement='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';await command(guest(1),'attach',{roomId:r.id,connectionId:replacement});await command(guest(1),'depart',{roomId:r.id});
 assert.equal((await db.query('select depart_at from arena_private.presence where room_id=$1 and user_id=$2',[r.id,guest(1)])).rows[0].depart_at,null);
 await db.query("update arena_private.presence set background=true,last_seen=clock_timestamp()-interval '90 seconds' where room_id=$1 and user_id=$2",[r.id,guest(1)]);
 state=await command(HOST,'state',{roomId:r.id});assert.equal(Object.keys(state.room.players).length,2,'Background heartbeat allows throttled tabs');
 await command(guest(1),'depart',{roomId:r.id,connectionId:replacement});await db.query("update arena_private.presence set depart_at=clock_timestamp()-interval '1 second' where room_id=$1 and user_id=$2",[r.id,guest(1)]);
 state=await command(HOST,'state',{roomId:r.id});assert.equal(Object.keys(state.room.players).length,1);assert.ok(state.room.presenceDeadline>Date.now(),'Expired offline rows must not create a refresh loop');
});

test('Salas: salir o desconectarse el anfitrión invalida el código y expulsa a todos',async t=>{
 const {db,command,room}=await setup(t);let r=await room();
 await assert.rejects(command(guest(1),'close',{roomId:r.id}),/administrador/);
 assert.equal((await command(HOST,'leave',{roomId:r.id})).closed,true);
 assert.equal((await command(guest(1),'state',{roomId:r.id})).closed,true);assert.equal((await command(guest(3),'join',{code:r.code,nickname:'Late',avatarId:0})).closed,true);
 assert.equal((await db.query('select count(*) from public.arena_players where room_id=$1 and connected',[r.id])).rows[0].count,0);
 r=await room();await command(HOST,'depart',{roomId:r.id});await db.query("update arena_private.presence set depart_at=clock_timestamp()-interval '1 second' where room_id=$1 and user_id=$2",[r.id,HOST]);
 assert.equal((await command(guest(1),'heartbeat',{roomId:r.id})).closed,true);
 r=await room();await db.query("update public.arena_rooms set phase='finished',end_at=clock_timestamp()-interval '1 second' where id=$1",[r.id]);assert.equal((await command(guest(1),'state',{roomId:r.id})).closed,true);
});

test('Presencia: una baja libera el turno y la plaza; el logout revoca lecturas',async t=>{
 const {db,as,command,tick,room}=await setup(t),r=await room();await command(HOST,'start',{roomId:r.id});await tick(r.id);
 assert.equal((await command(guest(1),'answer',{roomId:r.id,questionIndex:0,value:1})).room.phase,'question');
 await command(guest(2),'leave',{roomId:r.id});const state=await command(HOST,'state',{roomId:r.id});assert.equal(state.room.phase,'reveal');assert.equal(state.room.answeredCount,1);assert.equal(Object.keys(state.room.players).length,1);
 await assert.rejects(command(guest(2),'state',{roomId:r.id}),/formas parte/);assert.equal((await as(guest(2),()=>db.query('select * from public.arena_rooms'))).rows.length,0);
 await assert.rejects(as(guest(1),()=>db.query('select * from arena_private.presence')),/permission denied/);
});

test('Misma red: 50 identidades distintas y 50 plazas sin identificar jugadores por IP',async t=>{
 const {command,room}=await setup(t),r=await room(50);let state=await command(HOST,'state',{roomId:r.id});assert.equal(Object.keys(state.room.players).length,50);
 await assert.rejects(command(guest(51),'join',{code:r.code,nickname:'Extra',avatarId:0}),/llena/);
 await command(guest(1),'leave',{roomId:r.id});state=await command(guest(51),'join',{code:r.code,nickname:'Person1',avatarId:79});assert.equal(Object.keys(state.room.players).length,50);
});

test('Texto: mayúsculas/minúsculas aceptadas, títulos propios y booleanos con tipos reales',async t=>{
 const {db}=await setup(t);
 const check=async(q,v)=>(await db.query('select arena_private.correct_answer($1,$2) ok',[JSON.stringify(q),JSON.stringify(v)])).rows[0].ok;
 const q={type:'request',acceptAnyTitle:true,request:{method:'PUT',path:'/fixture/7',body:{titulo:'Example',completada:false}}};
 assert.equal(await check(q,{method:'put',path:'/fixture/7/',body:JSON.stringify({titulo:'MI NUEVO TÍTULO',completada:false})}),true);
 assert.equal(await check(q,{method:'PUT',path:'/fixture/7',body:JSON.stringify({titulo:'  ',completada:false})}),false);
 assert.equal(await check(q,{method:'PUT',path:'/fixture/7',body:JSON.stringify({titulo:'Valid',completada:'false'})}),false);
 assert.equal(await check({...q,acceptAnyTitle:false},{method:'PUT',path:'/fixture/7',body:JSON.stringify({titulo:' EXAMPLE ',completada:false})}),true);
 await db.query('select arena_private.validate_answer($1,$2)',[JSON.stringify(q),JSON.stringify({method:'put',path:'/fixture/7',body:'{}'})]);
});
