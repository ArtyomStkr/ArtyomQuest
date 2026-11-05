import test from 'node:test';
import assert from 'node:assert/strict';
import {globalRanking} from '../src/domain/globalRanking.js';
import {ranking} from '../src/domain/ranking.js';
test('El guiño global es visual y no cambia puntos ni posiciones de la partida',()=>{
 const room={players:{a:{id:'a',nickname:'A',score:1400,correct:1,joinedAt:1},b:{id:'b',nickname:'B',score:2700,correct:2,joinedAt:2}}};
 const before=structuredClone(room),actual=ranking(room).map(p=>p.id),global=globalRanking(room);
 assert.equal(global[0].nickname,'ArtyomStkr');assert.equal(global[0].displayScore,'99999+');assert.equal(global[0].score,undefined);
 assert.deepEqual(global.slice(1).map(p=>p.id),actual);assert.deepEqual(room,before);assert.deepEqual(ranking(room).map(p=>p.id),actual);
});
