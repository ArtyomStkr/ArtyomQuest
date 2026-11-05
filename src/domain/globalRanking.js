import {ranking} from './ranking.js';

// Display-only Easter egg. These entries never enter the room service or scoring.
export function globalRanking(room){
  return [{id:'creator-easter-egg',nickname:'ArtyomStkr',displayScore:'99999+',creator:true},...ranking(room).map(player=>({...player,displayScore:player.score,creator:false}))];
}
