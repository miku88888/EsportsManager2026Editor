import test from 'node:test';
import assert from 'node:assert/strict';
import {sortRecords} from '../lib/sorting.mjs';

const ids=rows=>rows.map(r=>r.Id);
test('creation sorting defaults to 3, 2, 1 for records created on the same day',()=>{
 const rows=['1','2','3'].map(Id=>({Id,CreatedAt:'2026-10-18'}));
 assert.deepEqual(ids(sortRecords([...rows],'CreatedAt',undefined,rows)),['3','2','1']);
 assert.deepEqual(ids(sortRecords([...rows],'CreatedAt','asc',rows)),['1','2','3']);
 assert.deepEqual(ids(rows),['1','2','3']);
});
test('identical creation timestamps use insertion order after filtering and reloading',()=>{
 const rows=['1','2','3','4'].map(Id=>({Id,CreatedAt:'2026-10-18T04:05:06.123Z'})),reloaded=JSON.parse(JSON.stringify(rows));
 assert.deepEqual(ids(sortRecords(reloaded.filter(r=>r.Id!=='2'),'CreatedAt','desc',reloaded)),['4','3','1']);
});
test('creation sorting compares actual times including timezone offsets',()=>{
 const rows=[{Id:'old',CreatedAt:'2026-10-18T15:00:00+08:00'},{Id:'new',CreatedAt:'2026-10-18T08:01:00.123456789Z'},{Id:'middle',CreatedAt:'2026-10-18T08:00:00Z'}];
 assert.deepEqual(ids(sortRecords([...rows],'CreatedAt','desc',rows)),['new','middle','old']);
 assert.deepEqual(ids(sortRecords([...rows],'CreatedAt','asc',rows)),['old','middle','new']);
});
test('unknown creation times stay at the end and still respect insertion order',()=>{
 const rows=[{Id:'unknown1',CreatedAt:''},{Id:'known',CreatedAt:'2026-10-18'},{Id:'unknown2',CreatedAt:'invalid'}];
 assert.deepEqual(ids(sortRecords([...rows],'CreatedAt','desc',rows)),['known','unknown2','unknown1']);
 assert.deepEqual(ids(sortRecords([...rows],'CreatedAt','asc',rows)),['known','unknown1','unknown2']);
});
test('numeric and natural name sorting retain their existing behavior',()=>{
 const rows=[{Id:'2',Skill:'9'},{Id:'10',Skill:'20'},{Id:'1',Skill:'10'}];
 assert.deepEqual(ids(sortRecords([...rows],'Skill','desc')),['10','1','2']);
 assert.deepEqual(ids(sortRecords([...rows],'Id','asc')),['1','2','10']);
});
