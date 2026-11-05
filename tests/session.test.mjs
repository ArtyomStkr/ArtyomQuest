import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomService} from '../src/services/roomServiceCore.js';

const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
function client(role){
  const session={roomId:'room-fixture',code:'654321',role,playerId:role==='guest'?'p1':null};
  const snapshot={flowVersion:2,id:session.roomId,code:session.code,revision:8,phase:'question',questionIndex:4,deadline:Date.now()+60000,players:{p1:{id:'p1',score:2400}},answer:role==='guest'?{value:2,submitted:true}:null};
  let fail=false,gate=Promise.resolve();const calls=[];
  const api={
    calls,session,snapshot,setFailure:value=>{fail=value;},setGate:promise=>{gate=promise;},
    auth:{getSession:async()=>{await gate;calls.push('identity-ready');return {data:{session:{user:{id:'identity-fixture',is_anonymous:role==='guest'}}},error:null};},signInWithPassword:async()=>({error:null}),signInAnonymously:async()=>{throw new Error('Should not create an identity during recovery');},signOut:async()=>{}},
    rpc(_name,{action}){calls.push(action);return {abortSignal:async()=>fail?{data:null,error:{message:'network unavailable'}}:{data:{serverNow:Date.now(),session,room:snapshot},error:null}};},
    channel(){return {on(){return this;},subscribe(){return this;}};},removeChannel:async()=>{},
  };return api;
}
async function nextState(service,predicate=()=>true){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No state received')),1500);const off=service.subscribe(()=>{if(predicate()){clearTimeout(timeout);off();resolve(service.getRoom());}});});}

for(const role of ['admin','guest'])test(`Refresh: ${role} recupera sala, puntos, plazo y respuesta sin volver a entrar`,async t=>{
  const saved=storage(),api=client(role),first=createRoomService(api,saved);t.after(()=>first.dispose());
  if(role==='admin')await first.loginAdmin({username:'fixture@example.test',password:'synthetic'});else await first.join({code:'654321',nickname:'Fixture',avatarId:0});
  const original=first.getSession();first.dispose();api.calls.length=0;
  let release;api.setGate(new Promise(resolve=>{release=resolve;}));
  const reloaded=createRoomService(api,saved);t.after(()=>reloaded.dispose());assert.deepEqual(reloaded.getSession(),original);
  const pending=nextState(reloaded);assert.deepEqual(api.calls,[],'Room must wait until auth restores');release();
  const room=await pending;assert.equal(room.deadline,api.snapshot.deadline);assert.equal(room.players.p1.score,2400);assert.deepEqual(room.answer,api.snapshot.answer);
  assert.deepEqual(api.calls,['identity-ready','state']);assert.equal(reloaded.getSession().role,role);
});

test('Refresh: un fallo de red inicial conserva la sesión y permite reintentar',async t=>{
  const saved=storage(),api=client('guest'),service=createRoomService(api,saved);t.after(()=>service.dispose());service.setSession(api.session);api.setFailure(true);
  await nextState(service);assert.equal(service.getRoom(),null);assert.equal(service.canRetry(),true);assert.deepEqual(service.getSession(),api.session);
  api.setFailure(false);const recovered=await nextState(service,()=>Boolean(service.getRoom()));assert.equal(recovered.id,api.session.roomId);assert.equal(service.getError(),'');assert.ok(!api.calls.includes('join'));
});
