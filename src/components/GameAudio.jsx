import {useEffect,useSyncExternalStore} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
import {gameSounds} from '../domain/gameSounds.js';
import {roomService} from '../services/index.js';

export function SoundButton(){
  const ready=useSyncExternalStore(gameSounds.subscribe,gameSounds.ready,()=>false);
  return <button className="icon-button sound-button" aria-label={ready?'Silenciar sonido':'Activar sonido'} aria-pressed={ready} title={ready?'Silenciar sonido':'Activar sonido'} onClick={gameSounds.toggle}>{ready?<Volume2 size={21}/>:<VolumeX size={21}/>}</button>;
}

export function useAudioUnlock(){
  useEffect(()=>{const unlock=event=>{if(!event.target?.closest?.('.sound-button'))void gameSounds.unlock();};const visibility=()=>{if(document.hidden)gameSounds.stop();};window.addEventListener('pointerdown',unlock,{capture:true});window.addEventListener('keydown',unlock,{capture:true});document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('pointerdown',unlock,{capture:true});window.removeEventListener('keydown',unlock,{capture:true});document.removeEventListener('visibilitychange',visibility);gameSounds.stop();};},[]);
}

export function useGameAudio(room){
  useEffect(()=>{
    if(!room)return;
    const tick=()=>{
      if(room.phase==='finished'&&Object.keys(room.players).length){gameSounds.winner(`${room.id}:${room.deadline}`);return;}
      if(room.phase==='question'&&room.answer?.submitted)return;
      const target=room.phase==='question'?room.deadline:['countdown','scoreboard'].includes(room.phase)?room.transitionAt:null;
      if(!target)return;
      const remaining=Math.max(0,Math.ceil((target-roomService.now())/1000));
      if(remaining<=(room.phase==='question'?10:5))gameSounds.tick(`${room.id}:${room.phase}:${room.questionIndex}:${target}`,remaining,room.phase==='question');
    };
    tick();const timer=setInterval(tick,120);return()=>clearInterval(timer);
  },[room?.id,room?.phase,room?.questionIndex,room?.deadline,room?.transitionAt,room?.answer?.submitted]);
}
