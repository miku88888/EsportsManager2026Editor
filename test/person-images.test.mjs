import test from 'node:test';
import assert from 'node:assert/strict';
import {personImageCandidates,findPersonImage} from '../lib/person-images.mjs';
const catalog=rows=>new Map(rows.map(([name,priority=1])=>[name.toLowerCase(),{name:name+'.png',file:name+'.png',source:'图片包',priority}]));
test('verified player aliases map in both directions without renaming database records',()=>{
 for(const [real,alias]of [['ZywOo','zyvox'],['jkaem','jkaaea'],['mantuu','maduu'],['CYPHER','CYPIHEA'],['oSee','oxSe'],['C4LLM3SU3','K4LML3SU3']]){assert.ok(personImageCandidates('Players',{Id:real,Nick:real}).includes(alias));assert.equal(findPersonImage('Players',catalog([[alias]]),{Id:real,Nick:real}).match,'alias');assert.equal(findPersonImage('Players',catalog([[real]]),{Id:alias,Nick:alias}).name,real+'.png');}
});
test('person aliases preserve explicit images and do not guess similar names or first names',()=>{
 const images=catalog([['ZywOo',8],['zyvox',1],['Mathieu',9]]);assert.equal(findPersonImage('Players',images,{Id:'ZywOo',Nick:'ZywOo',Name:'Mathieu'}).name,'ZywOo.png');const custom=catalog([['ZywOo',1],['zyvox',8]]);custom.get('zyvox').custom=true;assert.equal(findPersonImage('Players',custom,{Id:'ZywOo',Nick:'ZywOo'}).name,'zyvox.png');assert.equal(findPersonImage('Players',catalog([['zyvox']]),{Id:'Zywooo',Nick:'自建角色'}),null);
 assert.equal(findPersonImage('Staff',catalog([['exalon']]),{Id:'XTQZZZ',Nick:'XTQZZZ'}).match,'alias');
});
