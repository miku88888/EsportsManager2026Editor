import crypto from 'node:crypto';
import {decodeEmdb,encodeEmdb,parseCsv,writeCsv} from './codec.mjs';
import {TABLES} from './schema.mjs';

export const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
export const folded=value=>String(value??'').toLocaleLowerCase();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const cleanRow=(row,headers)=>Object.fromEntries(headers.map(h=>[h,String(row[h]??'')]));
export function readDatabase(bytes,key,{allowDuplicateIds=false}={}){
 const doc=decodeEmdb(bytes,key),tables={};
 if(new Set(doc.entries.map(e=>e.name)).size!==doc.entries.length)throw Error('数据库包内有重复文件名');
 for(const [name,s]of Object.entries(TABLES)){
  const entry=doc.entries.find(e=>e.name===s.file);if(!entry)throw Error(`完整数据库缺少 ${s.file}`);
  const table=parseCsv(entry.data.toString('utf8'));if(!table.headers.includes(s.key))throw Error(`${s.file} 缺少 ${s.key}`);
  const seen=new Set();for(const row of table.rows){const id=folded(row[s.key]);if(!allowDuplicateIds&&(!id.trim()||seen.has(id)))throw Error(`${s.file} 的 ID 为空或重复：${row[s.key]}`);seen.add(id);}tables[name]=table;
 }
 const entry=doc.entries.find(e=>e.name==='roster_order.json'),roster=entry?JSON.parse(entry.data.toString('utf8')):{};
 if(!roster||typeof roster!=='object'||Array.isArray(roster)||Object.values(roster).some(v=>!Array.isArray(v)||v.some(id=>typeof id!=='string')))throw Error('阵容文件格式无效');
 return {doc,tables,roster};
}
// Some community databases reuse IDs for different people. Repair only the working
// copy and retain every row; the original bytes and review items remain available.
export function prepareDatabase(bytes,key){
 const parsed=readDatabase(bytes,key,{allowDuplicateIds:true}),conflicts=[],changed=new Set();let rosterChanged=false;
 for(const [name,s]of Object.entries(TABLES)){
  const table=parsed.tables[name],reserved=new Set(table.rows.map(r=>folded(r[s.key]))),seen=new Map();
  let number=Math.max(0,...(name==='Sponsors'?table.rows.map(r=>Number(r[s.key])).filter(Number.isSafeInteger):[]));
  for(const [index,row]of table.rows.entries()){
   const originalKey=row[s.key],id=folded(originalKey),first=seen.get(id);if(id.trim()&&!first){seen.set(id,{row:{...row},line:index+2});continue;}
   const base=originalKey.trim()||String(row[s.display]||name).trim()||name;let next,sequence=2;
   do{next=name==='Sponsors'?String(++number):`${base}__${sequence++}`;}while(reserved.has(folded(next)));reserved.add(folded(next));
   const original={...row};row[s.key]=next;changed.add(name);
   conflicts.push({id:'identity-'+(conflicts.length+1),kind:'identity',table:name,key:next,originalKey,keys:[next],line:index+2,firstLine:first?.line||null,label:(row[s.display]||base)+' · ID 核对',left:first?.row||null,right:original,fields:table.headers.map(field=>({field,left:first?.row[field]??'',right:original[field]??''}))});
   if(name==='Players'&&row.Team){const list=parsed.roster[row.Team]??=[];if(!list.includes(next))list.push(next);rosterChanged=true;}
  }
 }
 if(!conflicts.length)return {...parsed,bytes:Buffer.from(bytes),conflicts};
 const entries=parsed.doc.entries.map(e=>{const name=Object.keys(TABLES).find(n=>TABLES[n].file===e.name);if(changed.has(name))return {name:e.name,data:Buffer.from(writeCsv(parsed.tables[name]))};if(e.name==='roster_order.json'&&rosterChanged)return {name:e.name,data:Buffer.from(JSON.stringify(parsed.roster))};return e;});
 if(rosterChanged&&!entries.some(e=>e.name==='roster_order.json'))entries.push({name:'roster_order.json',data:Buffer.from(JSON.stringify(parsed.roster))});
 return {...parsed,bytes:encodeEmdb(entries,key,parsed.doc.version),conflicts};
}
export function orderedRoster(editor,team,preferred=[]){
 const members=editor.tables.Players.rows.filter(r=>r.Team===team),ids=new Map(members.map(r=>[folded(r.Id),r.Id])),result=[];
 for(const id of [...preferred,...members.map(r=>r.Id)]){const real=ids.get(folded(id));if(real&&!result.includes(real))result.push(real);}return result;
}
export function combineDatabases(leftBytes,rightBytes,key,leftLabel='A',rightLabel='B'){
 const left=readDatabase(leftBytes,key),right=readDatabase(rightBytes,key),tables={},conflicts=[],counts={};let sequence=0;
 const canonical={};for(const [name,s]of Object.entries(TABLES)){const map=new Map();for(const row of [...left.tables[name].rows,...right.tables[name].rows])if(!map.has(folded(row[s.key])))map.set(folded(row[s.key]),row[s.key]);canonical[name]=map;}
 const normalize=(name,row,headers)=>{const out=cleanRow(row,headers);out[TABLES[name].key]=canonical[name].get(folded(out[TABLES[name].key]));for(const field of ['Team','Academy'])if(out[field])out[field]=canonical.Teams.get(folded(out[field]))||out[field];if(name==='Teams'&&out.StartIGL)out.StartIGL=canonical.Players.get(folded(out.StartIGL))||out.StartIGL;return out;};
 for(const [name,s]of Object.entries(TABLES)){
  const a=left.tables[name],b=right.tables[name],headers=[...new Set([...a.headers,...b.headers])],rows=a.rows.map(r=>normalize(name,r,headers)),map=new Map(rows.map(r=>[folded(r[s.key]),r])),stats={left:a.rows.length,right:b.rows.length,added:0,identical:0,conflicts:0};
  for(const source of b.rows){const row=normalize(name,source,headers),old=map.get(folded(row[s.key]));if(!old){rows.push(row);map.set(folded(row[s.key]),row);stats.added++;continue;}
   const fields=headers.filter(h=>h!==s.key&&old[h]!==row[h]).map(field=>({field,left:old[field],right:row[field]}));
   if(fields.length){conflicts.push({id:'c'+(++sequence),kind:'record',table:name,key:old[s.key],label:old[s.display]||old[s.key],fields});stats.conflicts++;}else stats.identical++;
  }tables[name]={...a,headers,rows};counts[name]=stats;
 }
 const roster={},aRosters=new Map(Object.entries(left.roster).map(([team,ids])=>[canonical.Teams.get(folded(team))||team,ids])),bRosters=new Map(Object.entries(right.roster).map(([team,ids])=>[canonical.Teams.get(folded(team))||team,ids]));
 for(const team of tables.Teams.rows){const nick=team.Nick,a=aRosters.get(nick)||[],b=bRosters.get(nick)||[];roster[nick]=orderedRoster({tables},nick,[...a,...b]);if(aRosters.has(nick)&&bRosters.has(nick)&&!equal(a,b))conflicts.push({id:'c'+(++sequence),kind:'roster',table:'Teams',key:nick,label:nick+' · 阵容顺序',left:a,right:b});}
 const known=new Set([...Object.values(TABLES).map(s=>s.file),'roster_order.json']),extras=new Map(left.doc.entries.filter(e=>!known.has(e.name)).map(e=>[e.name,e]));
 for(const entry of right.doc.entries.filter(e=>!known.has(e.name))){const old=extras.get(entry.name);if(!old)extras.set(entry.name,entry);else if(!old.data.equals(entry.data))conflicts.push({id:'c'+(++sequence),kind:'attachment',table:'',key:entry.name,label:entry.name,left:old.data.toString('base64'),right:entry.data.toString('base64')});}
 const entries=Object.entries(TABLES).map(([name,s])=>({name:s.file,data:Buffer.from(writeCsv(tables[name]))}));entries.push({name:'roster_order.json',data:Buffer.from(JSON.stringify(roster))},...extras.values());
 return {bytes:encodeEmdb(entries,key,Math.max(left.doc.version,right.doc.version)),plan:{schema:1,createdAt:new Date().toISOString(),leftLabel,rightLabel,counts,conflicts,decisions:{}}};
}
