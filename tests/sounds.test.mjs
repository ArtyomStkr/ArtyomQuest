import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameSounds} from '../src/domain/gameSounds.js';

test('Sonidos: requieren activación, no duplican ticks y respetan silencio y pestañas ocultas',async()=>{
  let tones=0,stops=0,visible=true;
  const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  class AudioContext{
    state='suspended';currentTime=0;destination={};async resume(){this.state='running';}
    createOscillator(){tones++;return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){},stop(){stops++;}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const sound=createGameSounds({AudioContext,storage,isVisible:()=>visible});assert.equal(sound.tick('q',5,true),false);assert.equal(tones,0);
  await sound.unlock();assert.equal(sound.ready(),true);assert.equal(sound.tick('q',5,true),true);assert.equal(tones,2);assert.equal(sound.tick('q',5,true),false);assert.equal(tones,2);
  visible=false;assert.equal(sound.tick('q',4,true),false);visible=true;assert.equal(sound.tick('q',4,true),true);
  sound.setEnabled(false);assert.equal(sound.ready(),false);assert.equal(sound.tick('q',3,true),false);assert.ok(stops>0);
  sound.setEnabled(true);await sound.unlock();assert.equal(sound.winner('room:deadline'),true);const after=tones;assert.equal(sound.winner('room:deadline'),false);assert.equal(tones,after);
  const refreshed=createGameSounds({AudioContext,storage});await refreshed.unlock();assert.equal(refreshed.winner('room:deadline'),false,'Reload must not repeat the winner announcement');assert.equal(tones,after);
});
