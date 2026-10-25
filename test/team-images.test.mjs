import test from 'node:test';
import assert from 'node:assert/strict';
import {teamImageCandidates,normalizedTeamImages,findTeamImage} from '../lib/team-images.mjs';
const catalog=entries=>new Map(entries.map(([name,priority=1,kind='workshop'])=>[name.toLocaleLowerCase(),{name:name+'.png',file:name+'.png',source:kind,kind,priority}]));
const find=(images,record)=>findTeamImage(images,normalizedTeamImages(images),record);

test('real team names resolve to verified game aliases in subscribed packs',()=>{
 for(const [Nick,Name,filename]of [['Spirit','Team Spirit','TEAM SIPRIT'],['NAVI','Natus Vincere','NTAUS VICNEE'],['3DMAX','3DMAX','3tax'],['Falcons','Falcons Esports','FALCNOI ESPORTS'],['WOPA','WOPA Esport','WOPOAX Esport'],['K27','K27','K37X']]){
  const img=find(catalog([[filename]]),{Nick,Name});assert.equal(img.name,filename+'.png');assert.equal(img.match,'alias');
 }
});
test('project bindings override aliases and subscribed aliases override built-in logos',()=>{
 const record={Nick:'Spirit',Name:'Team Spirit'},images=catalog([['Spirit',0,'game'],['TEAM SIPRIT',2,'workshop']]);
 assert.equal(find(images,record).kind,'workshop');images.set('spirit',{name:'Spirit.png',priority:8,source:'project',kind:'project'});assert.equal(find(images,record).kind,'project');
});
test('file punctuation, spacing and accents match only unambiguous names',()=>{
 const images=catalog([['KRU Esports'],['Test-Team']]);assert.equal(find(images,{Nick:'KRÜ',Name:'KRÜ Esports'}).name,'KRU Esports.png');assert.equal(find(images,{Nick:'Test Team',Name:''}).name,'Test-Team.png');
 const ambiguous=catalog([['Test-Team'],['Test_Team']]);assert.equal(find(ambiguous,{Nick:'Test Team',Name:''}),null);
});
test('academy and junior teams are not assigned their senior teams logo',()=>{
 const images=catalog([['TEAM SIPRIT'],['NTAUS VICNEE'],['NTAUS VICNEE JUNIOR']]);assert.equal(find(images,{Nick:'Spirit Academy',Name:'Spirit Academy'}),null);assert.equal(find(images,{Nick:'NAVI Junior',Name:'Natus Vincere Junior'}).name,'NTAUS VICNEE JUNIOR.png');
});
test('similar custom names are not guessed or silently mapped to existing teams',()=>{
 assert.equal(find(catalog([['TEAM SIPRIT']]),{Nick:'Spiriit',Name:'Custom Spirit Club'}),null);assert.equal(teamImageCandidates({Nick:'Spirit',Name:'Team Spirit'})[0],'Spirit');
});
test('game replacement team names can bind a real-name logo and LVG can bind the game logo',()=>{
 assert.equal(find(catalog([['Lyn nison gaming']]),{Nick:'Lynn Vision',Name:'Lynn Vision Gaming'}).name,'Lyn nison gaming.png');assert.equal(find(catalog([['Lynn Vision']]),{Nick:'Lyn nison',Name:'Lyn nison Gaming'}).name,'Lynn Vision.png');
});
