import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gameKey,encodeEmdb,decodeEmdb} from '../lib/codec.mjs';
import {makeConfiguration,saveConfiguration,emskinRoot,steamCandidates} from '../lib/setup.mjs';

export function setupFixture(root){
 const key=Buffer.alloc(32,6),gamePath=path.join(root,'Game'),metadata=path.join(gamePath,'EsportsManager_Data/il2cpp_data/Metadata/global-metadata.dat');
 const bytes=Buffer.alloc(192);bytes.writeUInt32LE(107,4);bytes.writeUInt32LE(64,8);bytes.writeUInt32LE(2,16);bytes.writeUInt32LE(128,20);bytes.writeUInt32LE(0,64);bytes.writeUInt32LE(64,68);bytes.write(key.toString('hex').toUpperCase(),128);fs.mkdirSync(path.dirname(metadata),{recursive:true});fs.writeFileSync(metadata,bytes);
 const modRoot=path.join(root,'Mod/BepInEx/emskin'),source=path.join(modRoot,'database/test.emdb');fs.mkdirSync(path.dirname(source),{recursive:true});
 const entries=[['Players.csv','Id;Nick;Team;Skill\np;Test;T;10\n'],['Staff.csv','Id;Nick;Team\n'],['Teams.csv','Nick;Name;Country\nT;Test Team;China\n'],['Sponsors.csv','Num;CompanyName\n'],['Tournaments.csv','id;Name;CupId\n'],['roster_order.json','{"T":["p"]}']].map(([name,text])=>({name,data:Buffer.from(text)}));fs.writeFileSync(source,encodeEmdb(entries,key));return {key,gamePath,source,modRoot};
}
test('first-use configuration validates local game/database, detects EMSkin and never overwrites an existing configuration',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'world-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const fixture=setupFixture(root),original=fs.readFileSync(fixture.source);
 assert.deepEqual(gameKey(fixture.gamePath),fixture.key);assert.throws(()=>gameKey(path.join(root,'missing')));
 const config=saveConfiguration({...fixture,imageRoot:fixture.modRoot},root);assert.equal(config.integration.modRoot,fixture.modRoot);assert.equal(config.projectDir,path.join(root,'project'));assert.equal(config.linkedImageRoots[0].id,'mod');assert.deepEqual(fs.readFileSync(fixture.source),original);assert.ok(decodeEmdb(original,fixture.key).entries.length===6);
 assert.throws(()=>saveConfiguration(fixture,root),/已有配置/);assert.throws(()=>makeConfiguration({...fixture,source:path.join(root,'none.emdb')},root));assert.throws(()=>makeConfiguration({...fixture,gamePath:''},root));assert.throws(()=>emskinRoot(root));assert.equal(emskinRoot(path.join(root,'Mod')),fixture.modRoot);
});
test('Steam discovery follows a selected libraryfolders file',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'world-steam-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const steam=path.join(root,'Steam'),library=path.join(root,'Library');fs.mkdirSync(path.join(steam,'steamapps'),{recursive:true});fs.writeFileSync(path.join(steam,'steamapps/libraryfolders.vdf'),'"path" "'+library.replaceAll('\\','\\\\')+'"');assert.ok(steamCandidates([steam]).includes(library));
});
