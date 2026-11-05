export function createGameSounds({AudioContext,storage,isVisible=()=>true}={}) {
  let context=null;
  let enabled=true;
  try { enabled=storage?.getItem('artyquest:sound')!=='off'; } catch { /* Optional preference. */ }
  const listeners=new Set(),played=new Set(),nodes=new Set();
  const ready=()=>Boolean(enabled&&context?.state==='running');
  const notify=()=>listeners.forEach(fn=>fn());
  function stop(){for(const node of nodes){try{node.stop();}catch{/* Already ended. */}}nodes.clear();}
  async function unlock(){
    if(!enabled||!AudioContext)return;
    try { if(!context){context=new AudioContext();context.onstatechange=notify;}if(context.state==='suspended')await context.resume();notify(); } catch { /* A browser may require another user gesture. */ }
  }
  function setEnabled(value){enabled=value;try{storage?.setItem('artyquest:sound',value?'on':'off');}catch{/* Optional preference. */}if(!value)stop();else void unlock();notify();}
  function tone(frequency,duration=.1,delay=0,volume=.045){
    const oscillator=context.createOscillator(),gain=context.createGain();
    const start=context.currentTime+delay;
    oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.012);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(gain);gain.connect(context.destination);nodes.add(oscillator);
    oscillator.onended=()=>{nodes.delete(oscillator);oscillator.disconnect();gain.disconnect();};
    oscillator.start(start);oscillator.stop(start+duration+.02);
  }
  function once(key,play,persistent=false){
    if(!ready()||!isVisible()||played.has(key))return false;
    try{if(persistent&&storage?.getItem('artyquest:played:'+key))return false;}catch{/* Optional replay guard. */}
    played.add(key);if(played.size>300)played.delete(played.values().next().value);
    if(persistent)try{storage?.setItem('artyquest:played:'+key,'1');}catch{/* Optional replay guard. */}
    play();return true;
  }
  return {
    ready,unlock,setEnabled,toggle:()=>setEnabled(!ready()),stop,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    tick(key,seconds,urgent=false){return once(key+':'+seconds,()=>{if(seconds===0){tone(220,.25);return;}tone(urgent?780:540,.085);if(urgent&&seconds<=5)tone(980,.07,.18,.035);});},
    winner(key){return once('winner:'+key,()=>{[523.25,659.25,783.99,1046.5,783.99,1046.5].forEach((frequency,i)=>tone(frequency,.25,i*.14,.05));[523.25,659.25,783.99].forEach(frequency=>tone(frequency,.65,.9,.022));},true);},
  };
}

export const gameSounds=createGameSounds(typeof window==='undefined'?{}:{AudioContext:window.AudioContext||window.webkitAudioContext,storage:window.sessionStorage,isVisible:()=>!document.hidden});
