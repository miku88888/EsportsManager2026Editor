import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CalendarStore,parseCalendar} from '../lib/calendar.mjs';
import {parseCsv} from '../lib/codec.mjs';
const csv='\ufeff# calendar source stays intact\r\nslot;tier;name;final_2026;prize;logo;from\r\na;1;Cup {year};2026-01-04;100;IEM\r\n# retained comment\r\nb;2;Second;2026-02-05;200;PGL;2027\r\n';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'world-calendar-')),store=new CalendarStore(path.join(root,'workspace'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,store};}
test('calendar parser accepts optional trailing columns, comments and BOM without weakening native CSV parsing',()=>{
 assert.throws(()=>parseCsv('a;b\nx'));const t=parseCalendar(csv);assert.equal(t.rows.length,2);assert.equal(t.rows[0].from,'');assert.equal(t.tokens.map(t=>t.raw).join(''),csv);assert.throws(()=>parseCalendar('a;b\nx;y;extra'));
});
test('calendar edits preserve comments and untouched records, guard stale forms and undo exact original bytes',t=>{
 const {store}=fixture(t);store.importFiles([{name:'calendar/calendar_t1.csv',data:Buffer.from(csv)}]);const before=store.table('calendar_t1.csv'),result=store.edit({file:'calendar_t1.csv',index:0,expectedHash:before.hash,changes:{prize:'0',name:'含;分号 "赛"'}});assert.ok(fs.existsSync(result.backup));assert.equal(store.table('calendar_t1.csv').rows[0].prize,'0');assert.ok(store.table('calendar_t1.csv').bytes.toString().includes('# retained comment\r\nb;2;Second;2026-02-05;200;PGL;2027\r\n'));assert.throws(()=>store.edit({file:'calendar_t1.csv',index:0,expectedHash:before.hash,changes:{prize:'100'}}));store.historyAction('undo');assert.deepEqual(store.table('calendar_t1.csv').bytes,before.bytes);store.historyAction('redo');assert.equal(store.table('calendar_t1.csv').rows[0].name,'含;分号 "赛"');assert.deepEqual(fs.readFileSync(path.join(store.workspace,'CalendarOriginals/calendar_t1.csv')),Buffer.from(csv));
});
test('calendar add/delete, validation, scope and file boundaries preserve a valid working library',t=>{
 const {store}=fixture(t);store.importFiles([{name:'calendar_t1.csv',data:Buffer.from(csv)},{name:'pool.csv',data:Buffer.from('series;tier;name\np;3;Pool\n')}]);const get=()=>store.table('calendar_t1.csv');assert.equal(store.summary().fixed2026,2);assert.equal(store.summary().pool,1);assert.equal(store.list({search:'Second'}).total,1);assert.equal(store.list({dataset:'pool'}).total,1);assert.throws(()=>store.detail('../settings.json',0));assert.throws(()=>store.edit({file:'calendar_t1.csv',index:0,expectedHash:get().hash,changes:{tier:'5'}}));assert.throws(()=>store.edit({file:'calendar_t1.csv',index:0,expectedHash:get().hash,changes:{final_2026:'2026-02-30'}}));assert.throws(()=>store.edit({file:'calendar_t1.csv',action:'add',expectedHash:get().hash,changes:{slot:'a'}}));store.edit({file:'calendar_t1.csv',action:'add',expectedHash:get().hash,changes:{slot:'c',tier:'4',name:'Third',prize:'500'}});assert.equal(get().rows.length,3);store.edit({file:'calendar_t1.csv',index:2,action:'delete',expectedHash:get().hash});assert.equal(get().rows.length,2);assert.equal(store.detail('calendar_t1.csv',-1).row.slot,'');
});
