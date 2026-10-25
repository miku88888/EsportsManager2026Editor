import fs from 'node:fs';
import path from 'node:path';
import {parseCsv} from './codec.mjs';
import {atomicWrite,stamp} from './model.mjs';
import {digest} from './merge-review.mjs';

export const CALENDAR_LABELS={slot:'槽位 ID',series:'系列 ID',tier:'级别',fmt:'赛制代码',standin:'赛制参数',name:'名称模板',final_2026:'基准决赛日期',lan:'线上 / 线下',city:'城市',country:'国家',y2026:'2026 参数',prize:'奖金',rating:'评级',logo:'赛事标志 ID',teams:'参赛队数',table:'奖金分配规则',qualifies:'晋级关联',region:'地区',replaces:'替换槽位',from:'起始年份',year:'参考年份',y2025:'2025 参数',days:'比赛天数',source:'来源',organizer:'主办方',name_pattern:'Major 名称模板',active:'启用',cities:'城市规则'};
const valid=file=>/^(calendar_t[1-4](?:_\d{4})?\.csv|pool\.csv|majors\.csv|cities\/[a-z0-9_-]+\.csv)$/i.test(file);
const numeric=new Set(['tier','standin','y2026','y2025','prize','rating','teams','from','year','days']);
const cell=value=>/[;"\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
export function parseCalendar(bytes){
 const text=Buffer.isBuffer(bytes)?bytes.toString('utf8'):String(bytes),tokens=[];let begin=0,quoted=false,start=true;
 for(let i=0;i<text.length;i++){
  if(i===begin&&text.slice(i).match(/^(?:\ufeff)?[ \t]*#/)){const end=text.indexOf('\n',i),finish=end<0?text.length:end+1;tokens.push({raw:text.slice(i,finish),data:false});begin=finish;i=finish-1;continue;}
  const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"')i++;else quoted=false;}}
  else if(c==='"'&&start){quoted=true;start=false;}else if(c===';')start=true;
  else if(c==='\n'||c==='\r'){let end=i+1;if(c==='\r'&&text[i+1]==='\n'){end++;i++;}const raw=text.slice(begin,end);tokens.push({raw,data:!!raw.replace(/^\ufeff/,'').trim()});begin=end;start=true;}
  else if(c!=='\ufeff')start=false;
 }
 if(quoted)throw Error('赛历 CSV 引号未闭合');if(begin<text.length){const raw=text.slice(begin);tokens.push({raw,data:!!raw.trim()});}
 const data=tokens.filter(t=>t.data);if(!data.length)throw Error('赛历文件没有表头');const header=data[0].raw.replace(/^\ufeff/,''),parsed=parseCsv(data.map(t=>t.raw).join(''),';',{allowShortRows:true});
 return {...parsed,tokens,header,records:data.slice(1).map((token,i)=>({token,index:i,row:parsed.rows[i]}))};
}
export class CalendarStore{
 constructor(workspace){this.workspace=workspace;this.root=path.join(workspace,'Calendar');this.history=[];this.future=[];}
 safe(file){if(typeof file!=='string'||!valid(file))throw Error('赛历文件路径无效');return path.join(this.root,...file.split('/'));}
 files(){const result=[];if(!fs.existsSync(this.root))return result;for(const name of fs.readdirSync(this.root)){if(valid(name))result.push(name);else if(name==='cities')for(const city of fs.readdirSync(path.join(this.root,name)))if(valid('cities/'+city))result.push('cities/'+city);}return result.sort();}
 table(file){const bytes=fs.readFileSync(this.safe(file));return {...parseCalendar(bytes),bytes,hash:digest(bytes)};}
 summary(){const files=this.files().map(file=>({file,count:this.table(file).rows.length})),count=predicate=>files.filter(f=>predicate(f.file)).reduce((n,f)=>n+f.count,0);return {attached:!!files.length,fixed2026:count(f=>/^calendar_t[1-4]\.csv$/.test(f)),top2027:count(f=>f==='calendar_t1_2027.csv'),pool:count(f=>f==='pool.csv'),files,undo:!!this.history.length,redo:!!this.future.length};}
 importFiles(entries,source='文件夹 / ZIP'){
  const files=new Map();for(const entry of entries){const name=String(entry.name).replaceAll('\\','/'),parts=name.split('/'),at=parts.lastIndexOf('calendar'),file=at>=0?parts.slice(at+1).join('/'):name;if(!valid(file))continue;if(files.has(file))throw Error('赛历包内有同名文件：'+file);const bytes=Buffer.from(entry.data);if(bytes.length>5_000_000)throw Error('赛历文件过大');parseCalendar(bytes);files.set(file,bytes);}
  if(!files.size)throw Error('没有找到 calendar_t*.csv 或 pool.csv 等赛历文件');const backup=path.join(this.workspace,'backups','calendar-import-'+stamp());
  for(const [file,bytes]of files){const dest=this.safe(file);if(fs.existsSync(dest))atomicWrite(path.join(backup,file),fs.readFileSync(dest));const original=path.join(this.workspace,'CalendarOriginals',file);if(!fs.existsSync(original))atomicWrite(original,bytes);atomicWrite(dest,bytes);}
  atomicWrite(path.join(this.workspace,'calendar-source.json'),JSON.stringify({source,importedAt:new Date().toISOString()},null,2));this.history=[];this.future=[];return this.summary();
 }
 connect(directory){const entries=[];for(const file of fs.readdirSync(directory)){const full=path.join(directory,file);if(fs.statSync(full).isFile())entries.push({name:file,data:fs.readFileSync(full)});else if(file==='cities')for(const name of fs.readdirSync(full))entries.push({name:'cities/'+name,data:fs.readFileSync(path.join(full,name))});}return this.importFiles(entries,directory);}
 list({dataset='2026',search='',tier='',file='',page=1}={}){
  const summary=this.summary(),all=[];for(const name of this.files()){const include=file?name===file:dataset==='2026'?/^calendar_t[1-4]\.csv$/.test(name):dataset==='2027'?name==='calendar_t1_2027.csv':dataset==='pool'?name==='pool.csv':dataset==='majors'?name==='majors.csv':name.startsWith('cities/');if(!include)continue;const t=this.table(name);for(const [index,row]of t.rows.entries())if((!tier||row.tier===tier)&&(!search||Object.values(row).join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())))all.push({...row,_file:name,_index:index,_hash:t.hash});}
  all.sort((a,b)=>(a.final_2026||'').localeCompare(b.final_2026||'')||(a.name||a.series||'').localeCompare(b.name||b.series||''));const current=Math.max(1,Math.min(Number(page)||1,Math.ceil(all.length/50)||1));return {summary,total:all.length,page:current,rows:all.slice((current-1)*50,current*50)};
 }
 detail(file,index){const t=this.table(file),row=Number(index)===-1?Object.fromEntries(t.headers.map(h=>[h,''])):t.rows[Number(index)];if(!row)throw Error('赛历记录不存在');return {file,index:Number(index),hash:t.hash,row,fields:t.headers.map(name=>({name,label:CALENDAR_LABELS[name]||name,type:numeric.has(name)?'number':name==='final_2026'?'date':'text'}))};}
 validate(t,row,old={}){for(const field of t.headers){const value=row[field];if(typeof value!=='string'||value.includes('\0'))throw Error('字段内容无效：'+field);if(value===old[field])continue;if(numeric.has(field)&&value!==''&&(!/^\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))))throw Error((CALENDAR_LABELS[field]||field)+' 需要非负数值');if(field==='tier'&&value!==''&&!['1','2','3','4'].includes(value))throw Error('级别应为 1–4');if(field==='final_2026'&&value!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('日期应为有效的 YYYY-MM-DD');}for(const key of ['slot','series'])if(t.headers.includes(key)&&!row[key].trim())throw Error(key+' 不能为空');}
 edit({file,index,changes={},action='update',expectedHash}){
  if(!['update','add','delete'].includes(action))throw Error('赛历操作无效');const t=this.table(file);if(expectedHash!==t.hash)throw Error('赛历文件已变化，请刷新后再修改');const record=t.records[Number(index)];if(action!=='add'&&!record)throw Error('赛历记录不存在');
  const row=action==='add'?Object.fromEntries(t.headers.map(h=>[h,''])):{...record.row};for(const [field,value]of Object.entries(changes)){if(!t.headers.includes(field))throw Error('未知赛历字段：'+field);row[field]=String(value??'');}if(action!=='delete'){this.validate(t,row,record?.row);if(t.headers.includes('slot')&&(action==='add'||row.slot!==record.row.slot)&&t.rows.some((r,i)=>i!==Number(index)&&r.slot.toLocaleLowerCase()===row.slot.toLocaleLowerCase()))throw Error('该赛历文件已有相同槽位 ID');}
  const newline=t.newline||'\n';if(action==='delete')record.token.raw='';else{const raw=t.headers.map(h=>cell(row[h])).join(';')+(action==='add'||/[\r\n]$/.test(record.token.raw)?newline:'');if(action==='add'){if(t.tokens.length&&!/[\r\n]$/.test(t.tokens.at(-1).raw))t.tokens.at(-1).raw+=newline;t.tokens.push({raw,data:true});}else record.token.raw=raw;}
  const next=Buffer.from(t.tokens.map(token=>token.raw).join(''));parseCalendar(next);const backup=path.join(this.workspace,'backups','calendar-'+stamp(),file);atomicWrite(backup,t.bytes);atomicWrite(this.safe(file),next);this.history.push({file,before:t.bytes,after:next});this.future=[];return {backup,calendar:this.summary()};
 }
 historyAction(direction){const from=direction==='undo'?this.history:this.future,to=direction==='undo'?this.future:this.history,item=from.at(-1);if(!item)throw Error('没有可'+(direction==='undo'?'撤销':'重做')+'的赛历操作');const expected=direction==='undo'?item.after:item.before;if(!fs.readFileSync(this.safe(item.file)).equals(expected))throw Error('文件已有其他变化，请先刷新');atomicWrite(this.safe(item.file),direction==='undo'?item.before:item.after);from.pop();to.push(item);return this.summary();}
 exportEntries(prefix='BepInEx/emskin/calendar'){return this.files().map(file=>({name:prefix+'/'+file,file:this.safe(file)}));}
}
