import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {decodeEmdb,encodeEmdb,parseCsv,writeCsv} from './codec.mjs';
import {TABLES,ATTRIBUTE_FIELDS,NUMERIC_FIELDS,BOOLEAN_FIELDS,fieldInfo} from './schema.mjs';
import {photoRoots,PhotoCache,validPhotoUrl,imageType,CUSTOM_ASSETS} from './photos.mjs';
import {teamImageCandidates,normalizedTeamImages,findTeamImage} from './team-images.mjs';
import {personImageCandidates,findPersonImage} from './person-images.mjs';

export function atomicWrite(file,bytes) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp-'+crypto.randomBytes(4).toString('hex');
  try {fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,file);} finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
export class Editor {
 constructor({source,imageRoot,gamePath,projectDir,key,customAssets=CUSTOM_ASSETS,sharedAssetsDir=projectDir,linkedImageRoots=[],workspaceCreatedAt=null}) {
  Object.assign(this,{source,imageRoot,gamePath,projectDir,key,customAssets,sharedAssetsDir,linkedImageRoots,workspaceCreatedAt});
  this.workFile=path.join(projectDir,'World_Updated_Edited.emdb');this.backupDir=path.join(projectDir,'backups');this.overlayRoot=path.join(projectDir,'Images');
  fs.mkdirSync(this.backupDir,{recursive:true});fs.mkdirSync(this.overlayRoot,{recursive:true});
  this.preferences={editMode:'dialog',otherImagePacks:true,remotePhotos:true,preferredImageSource:linkedImageRoots.some(r=>r.id==='personal')?'personal':''};
  this.preferencesFile=path.join(projectDir,'editor-settings.json');
  try{Object.assign(this.preferences,JSON.parse(fs.readFileSync(this.preferencesFile,'utf8')));}catch{}
  this.photoCache=new PhotoCache(path.join(sharedAssetsDir,'PhotoCache'));
  const sourceBytes=fs.readFileSync(source), hash=crypto.createHash('sha256').update(sourceBytes).digest('hex');
  this.sourceHash=hash; const backup=path.join(this.backupDir,`original-${hash.slice(0,12)}.emdb`);
  if(!fs.existsSync(backup))fs.writeFileSync(backup,sourceBytes);
  this.sourceBackup=backup;this.base=decodeEmdb(sourceBytes,key);
  this.baseTables=Object.fromEntries(Object.entries(TABLES).map(([name,s])=>[name,parseCsv(this.base.entries.find(e=>e.name===s.file).data.toString('utf8'))]));
  this.sequence=0;this.history=[];this.future=[];this.revision=0;this.log=[];this.lastExport=null;
  this.load(fs.existsSync(this.workFile)?fs.readFileSync(this.workFile):sourceBytes);
  this.loadManualImages();this.indexImages();
  if(!fs.existsSync(this.workFile))atomicWrite(this.workFile,sourceBytes);
  this.lastSaved=fs.statSync(this.workFile).mtime.toISOString();
 }
 load(bytes) {
  this.doc=decodeEmdb(bytes,this.key);this.tables={};
  for(const [name,s] of Object.entries(TABLES)) {
   const e=this.doc.entries.find(e=>e.name===s.file);if(!e)throw Error(`缺少 ${s.file}`);
   const t=parseCsv(e.data.toString('utf8'));if(!t.headers.includes(s.key))throw Error(`${s.file} 缺少关键字段 ${s.key}`);
   t.rows.forEach(r=>r._rid=`${name}-${++this.sequence}`);t.dirty=false;this.tables[name]=t;
  }
  this.rosterEntry=this.doc.entries.find(e=>e.name==='roster_order.json');
  this.roster=this.rosterEntry?JSON.parse(this.rosterEntry.data.toString('utf8')):{};this.rosterDirty=false;
  this.extrasDirty=false;
 }
 indexImages() {
  this.images={};
  this.imageRoots=photoRoots(this.imageRoot,this.overlayRoot,this.preferences.otherImagePacks,this.customAssets,path.join(this.sharedAssetsDir,'GameImages'),this.linkedImageRoots,this.preferences.preferredImageSource);
  for(const [name,s] of Object.entries(TABLES)){
   const map=new Map();
   for(const [priority,{root,source,kind,folders,preferred}] of this.imageRoots.entries()) {
    const folder=path.join(root,folders?.[name]||s.folder);if(!fs.existsSync(folder))continue;
    for(const f of fs.readdirSync(folder))if(/\.(png|jpg|jpeg|webp)$/i.test(f)){const file=path.join(folder,f),custom=root===this.overlayRoot,manual=custom&&!!this.manualImages?.[path.relative(this.overlayRoot,file).replaceAll('\\','/').toLowerCase()],score=priority+(manual||kind==='custom'?10000:0),key=path.parse(f).name.toLocaleLowerCase();if((map.get(key)?.priority??-1)>score)continue;map.set(key,{file,name:f,source,kind,priority:score,custom,manual,preferred:!!preferred});}
   }
   this.images[name]=map;
  }
  this.normalizedTeamImages=normalizedTeamImages(this.images.Teams);
 }
 loadManualImages(){
  this.manualImagesFile=path.join(this.projectDir,'manual-images.json');if(fs.existsSync(this.manualImagesFile)){this.manualImages=JSON.parse(fs.readFileSync(this.manualImagesFile,'utf8'));return;}this.manualImages={};const automatic=new Map();
  for(const name of fs.readdirSync(this.backupDir).filter(n=>/^image-bindings-.*\.json$/.test(n)))try{for(const entry of JSON.parse(fs.readFileSync(path.join(this.backupDir,name),'utf8')).files||[])automatic.set(path.resolve(entry.dest).toLowerCase(),entry.sha256);}catch{}
  for(const s of Object.values(TABLES)){const dir=path.join(this.overlayRoot,s.folder);if(!fs.existsSync(dir))continue;for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(!fs.statSync(file).isFile())continue;const previous=automatic.get(path.resolve(file).toLowerCase()),auto=previous&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===previous;if(!auto&&(!this.workspaceCreatedAt||fs.statSync(file).mtimeMs>Date.parse(this.workspaceCreatedAt)))this.manualImages[path.relative(this.overlayRoot,file).replaceAll('\\','/').toLowerCase()]=true;}}
  atomicWrite(this.manualImagesFile,JSON.stringify(this.manualImages,null,2));
 }
 markManualImage(file){this.manualImages[path.relative(this.overlayRoot,file).replaceAll('\\','/').toLowerCase()]=true;atomicWrite(this.manualImagesFile,JSON.stringify(this.manualImages,null,2));}
 imageCandidates(name,r) {
  if(name==='Teams')return teamImageCandidates(r);
  if(name==='Sponsors')return [r.Num,r.CompanyName];
  if(name==='Tournaments')return [r.CupId,r.id,r.Name];
  return personImageCandidates(name,r);
 }
 image(name,r) {if(name==='Teams')return findTeamImage(this.images.Teams,this.normalizedTeamImages,r)||this.photoCache.cached(r.PhotoUrl);if(['Players','Staff'].includes(name))return findPersonImage(name,this.images[name],r)||this.photoCache.cached(r.PhotoUrl);for(const x of this.imageCandidates(name,r)){if(!x)continue;const found=this.images[name].get(x.toLocaleLowerCase());if(found)return found;}return this.photoCache.cached(r.PhotoUrl);}
 imageSource(name,r){return this.image(name,r)||(this.preferences.remotePhotos&&validPhotoUrl(r.PhotoUrl)?{name:'数据库图片链接',source:'数据库 PhotoUrl（在线补全）',kind:'remote',url:r.PhotoUrl}:null);}
 setPreferences(changes){
  if(Object.keys(changes).some(k=>!['editMode','otherImagePacks','remotePhotos','preferredImageSource'].includes(k)))throw Error('未知设置');
  if(changes.preferredImageSource!==undefined&&!['','world',...this.linkedImageRoots.map(r=>r.id)].includes(changes.preferredImageSource))throw Error('图片优先来源无效');
  if(changes.editMode!==undefined&&!['dialog','sidebar'].includes(changes.editMode))throw Error('编辑布局无效');
  for(const k of ['otherImagePacks','remotePhotos'])if(changes[k]!==undefined&&typeof changes[k]!=='boolean')throw Error('图片设置无效');
  this.preferences={...this.preferences,...changes};atomicWrite(this.preferencesFile,JSON.stringify(this.preferences,null,2));this.indexImages();return this.preferences;
 }
 table(name) {if(!Object.hasOwn(TABLES,name))throw Error('未知数据表');return this.tables[name];}
 record(name,rid){const r=this.table(name).rows.find(x=>x._rid===rid);if(!r)throw Error('记录不存在，请刷新列表');return r;}
 state(){return {tables:this.tables,roster:this.roster,rosterDirty:this.rosterDirty,docEntries:this.doc.entries,extrasDirty:this.extrasDirty};}
 snapshot(){return structuredClone(this.state());}
 restore(s){this.tables=s.tables;this.roster=s.roster;this.rosterDirty=s.rosterDirty;if(s.docEntries)this.doc.entries=s.docEntries;this.extrasDirty=s.extrasDirty||false;}
 entries(){const entries=this.doc.entries.map(e=>{const name=Object.keys(TABLES).find(n=>TABLES[n].file===e.name);if(name&&this.tables[name].dirty)return {name:e.name,data:Buffer.from(writeCsv(this.tables[name]))};if(e.name==='roster_order.json'&&this.rosterDirty)return {name:e.name,data:Buffer.from(JSON.stringify(this.roster))};return e;});if(this.rosterDirty&&!entries.some(e=>e.name==='roster_order.json'))entries.push({name:'roster_order.json',data:Buffer.from(JSON.stringify(this.roster))});return entries;}
 bytes(){if(!Object.values(this.tables).some(t=>t.dirty)&&!this.rosterDirty&&!this.extrasDirty)return this.doc.original;return encodeEmdb(this.entries(),this.key,this.doc.version);}
 save(){const bytes=this.bytes();decodeEmdb(bytes,this.key);atomicWrite(this.workFile,bytes);this.lastSaved=new Date().toISOString();this.revision++;return bytes;}
 transaction(label,fn) {
  const before=this.snapshot();
  try {const result=fn();this.save();this.history.push({label,state:before});if(this.history.length>60)this.history.shift();this.future=[];this.log.unshift({label,at:this.lastSaved});this.log=this.log.slice(0,60);return result;}
  catch(e){this.restore(before);throw e;}
 }
 undo(){if(!this.history.length)throw Error('没有可撤销的修改');const old=this.history.pop(),now=this.snapshot();try{this.restore(old.state);this.save();this.future.push({label:old.label,state:now});return old.label;}catch(e){this.restore(now);this.history.push(old);throw e;}}
 redo(){if(!this.future.length)throw Error('没有可重做的修改');const next=this.future.pop(),now=this.snapshot();try{this.restore(next.state);this.save();this.history.push({label:next.label,state:now});return next.label;}catch(e){this.restore(now);this.future.push(next);throw e;}}
 validateRecord(name,r,excludeRid=null,allowExisting=false,teamNames=null) {
  const t=this.table(name), key=TABLES[name].key, old=excludeRid?t.rows.find(x=>x._rid===excludeRid):null;
  for(const h of t.headers)if(typeof r[h]!=='string')throw Error(`字段 ${h} 必须是文本值`);
  if(!r[key].trim())throw Error(`${key} 不能为空`);
  if((!old||r[key]!==old[key])&&t.rows.some(x=>x._rid!==excludeRid&&x[key].toLocaleLowerCase()===r[key].toLocaleLowerCase()))throw Error(`唯一 ID 已存在：${r[key]}`);
  for(const h of t.headers) {
   const v=r[h];if(allowExisting&&old&&v===old[h])continue;
   if(v.includes('\0'))throw Error(`${h} 含无效字符`);
   if(NUMERIC_FIELDS.has(h)&&v!==''&&(!/^-?\d+(\.\d+)?$/.test(v)||!Number.isFinite(Number(v))))throw Error(`${h} 必须是有效数字，或留空`);
   if(ATTRIBUTE_FIELDS.has(h)&&v!==''&&(Number(v)<0||Number(v)>(h==='PR'?100:20)||!Number.isInteger(Number(v))))throw Error(`${h} 应为 0–${h==='PR'?100:20} 的整数，或留空`);
   if(['Earnings','ERS','Prizefund','Num','Rating'].includes(h)&&v!==''&&Number(v)<0)throw Error(`${h} 不能为负数`);
   if(['Earnings','ERS','Prizefund','Num'].includes(h)&&v!==''&&!Number.isSafeInteger(Number(v)))throw Error(`${h} 应为整数`);
   if(BOOLEAN_FIELDS.has(h)&&v!==''&&!['0','1','true','false','True','False'].includes(v))throw Error(`${h} 应为 0、1 或留空`);
   if(h==='Birthdate'&&v!=='') {const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);if(!m)throw Error('出生日期格式应为 日.月.年，例如 09.11.2000');const d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));if(d.getUTCFullYear()!==+m[3]||d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[1])throw Error('出生日期不存在');}
   if(h==='BgColor'&&v!==''&&!/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/.test(v))throw Error('颜色应为 #RRGGBB 或 #RRGGBBAA');
   if(['Team','Academy'].includes(h)&&v!==''&&!(teamNames?teamNames.has(v):this.tables.Teams.rows.some(x=>x.Nick===v)))throw Error(`战队不存在：${v}，请先创建战队或一起导入战队`);
  }
 }
 patch(name,rid,changes) {
  const row=this.record(name,rid), t=this.table(name), r={...row};
  for(const [k,v] of Object.entries(changes)){if(!t.headers.includes(k))throw Error(`未知字段 ${k}`);r[k]=String(v??'');}
  this.validateRecord(name,r,rid,true);
  return this.transaction(`修改${TABLES[name].label} ${row[TABLES[name].display]}`,()=>{this.applyRow(name,row,r);return r._rid;});
 }
 touch(name){this.tables[name].dirty=true;}
 applyRow(name,old,r) {
  const key=TABLES[name].key, oldKey=old[key], newKey=r[key], img=this.image(name,old);
  if(name==='Teams'&&oldKey!==newKey) {
   for(const n of ['Players','Staff'])for(const p of this.tables[n].rows)if(p.Team===oldKey){p.Team=newKey;this.touch(n);}
   for(const team of this.tables.Teams.rows)if(team.Academy===oldKey)team.Academy=newKey;
   if(Object.hasOwn(this.roster,oldKey)){this.roster[newKey]=this.roster[oldKey];delete this.roster[oldKey];this.rosterDirty=true;}
  }
  if(name==='Players') {
   if(oldKey!==newKey){for(const list of Object.values(this.roster))for(let i=0;i<list.length;i++)if(list[i]===oldKey)list[i]=newKey;this.rosterDirty=true;}
   if(old.Team!==r.Team){
    for(const [team,list] of Object.entries(this.roster))this.roster[team]=list.filter(x=>x!==oldKey&&x!==newKey);
    if(r.Team){const list=this.roster[r.Team]??=[];if(!list.includes(newKey))list.push(newKey);}
    this.rosterDirty=true;
   }
   for(const team of this.tables.Teams.rows)if(team.StartIGL===oldKey||team.StartIGL===old.Nick){
    const next=team.Nick===r.Team?(team.StartIGL===oldKey?newKey:r.Nick):'';
    if(next!==team.StartIGL){team.StartIGL=next;this.touch('Teams');}
   }
  }
  Object.assign(old,r);this.touch(name);
  // Renamed records keep their portrait through the project's game-compatible image overlay.
  if(img&&oldKey!==newKey)this.copyImage(name,r,img.file);
 }
 add(name,values={},cloneRid=null) {
  const t=this.table(name), r=Object.fromEntries(t.headers.map(h=>[h,'']));
  if(cloneRid)Object.assign(r,this.record(name,cloneRid));
  delete r._rid;
  for(const [k,v] of Object.entries(values)){if(!t.headers.includes(k))throw Error(`未知字段 ${k}`);r[k]=String(v??'');}
  if(t.headers.includes('CreatedAt')&&!String(values.CreatedAt??'').trim())r.CreatedAt=new Date().toISOString();
  r._rid=`${name}-${++this.sequence}`;this.validateRecord(name,r,null,false);
  const clonedImage=cloneRid?this.image(name,this.record(name,cloneRid)):null;
  return this.transaction(`新增${TABLES[name].label} ${r[TABLES[name].display]}`,()=>{t.rows.push(r);this.touch(name);if(name==='Players'&&r.Team){(this.roster[r.Team]??=[]).push(r.Id);this.rosterDirty=true;}if(clonedImage)this.copyImage(name,r,clonedImage.file);return r._rid;});
 }
 remove(name,rids) {
  const t=this.table(name);if(!Array.isArray(rids)||!rids.length||new Set(rids).size!==rids.length)throw Error('请选择不重复的记录');const rows=rids.map(rid=>this.record(name,rid));
  return this.transaction(`删除 ${rows.length} 条${TABLES[name].label}`,()=>{
   for(const r of rows) {
    if(name==='Teams'){
     for(const n of ['Players','Staff'])for(const p of this.tables[n].rows)if(p.Team===r.Nick){p.Team='';this.touch(n);}
     for(const team of this.tables.Teams.rows)if(team.Academy===r.Nick)team.Academy='';
     delete this.roster[r.Nick];this.rosterDirty=true;
    }
    if(name==='Players'){
     for(const team of this.tables.Teams.rows)if(team.StartIGL===r.Id||team.StartIGL===r.Nick){team.StartIGL='';this.touch('Teams');}
     for(const team of Object.keys(this.roster))this.roster[team]=this.roster[team].filter(x=>x!==r.Id);
     this.rosterDirty=true;
    }
   }
   t.rows=t.rows.filter(r=>!rids.includes(r._rid));this.touch(name);
  });
 }
 batch(name,rids,field,mode,value) {
  const t=this.table(name);if(!t.headers.includes(field)||field===TABLES[name].key)throw Error('批量修改不支持此字段');
  if(!rids.length||new Set(rids).size!==rids.length)throw Error('请选择不重复的记录');
  const updates=rids.map(id=>{const old=this.record(name,id),r={...old};if(mode==='set')r[field]=String(value);else {if(!NUMERIC_FIELDS.has(field)||!['add','multiply'].includes(mode)||!Number.isFinite(Number(value))||value==='')throw Error('数值操作无效');r[field]=String(mode==='add'?Number(r[field]||0)+Number(value):Number(r[field]||0)*Number(value));}this.validateRecord(name,r,id,true);return {old,r};});
  return this.transaction(`批量修改 ${updates.length} 条${TABLES[name].label} · ${field}`,()=>{updates.forEach(({old,r})=>this.applyRow(name,old,r));});
 }
 setRoster(team,ids) {
  if(!this.tables.Teams.rows.some(x=>x.Nick===team))throw Error('战队不存在');
  const members=this.tables.Players.rows.filter(x=>x.Team===team).map(x=>x.Id);
  if(ids.length!==members.length||new Set(ids).size!==ids.length||ids.some(id=>!members.includes(id)))throw Error('阵容必须恰好包含该战队所有选手，且不能重复');
  return this.transaction(`调整 ${team} 阵容顺序`,()=>{this.roster[team]=ids;this.rosterDirty=true;});
 }
 rosterFor(team) {
  const members=this.tables.Players.rows.filter(x=>x.Team===team), order=this.roster[team]||[];
  return [...members].sort((a,b)=>{const x=order.indexOf(a.Id),y=order.indexOf(b.Id);return (x<0?1e6:x)-(y<0?1e6:y);});
 }
 safeImageName(name,r){const id=this.imageCandidates(name,r).find(Boolean);if(!id||/[<>:"/\\|?*\x00-\x1f]/.test(id)||id.endsWith('.')||id.endsWith(' '))throw Error('该 ID 含 Windows 文件名不支持的字符，请先修改 ID');return id;}
 saveImage(name,r,bytes) {
  const type=imageType(bytes);if(bytes.length>12_000_000||!type)throw Error('请使用不超过 12 MB 的 PNG、JPG 或 WEBP 图片');
  const id=this.safeImageName(name,r),folder=path.join(this.overlayRoot,TABLES[name].folder),dest=path.join(folder,id+type.ext);
  atomicWrite(dest,bytes);
  this.markManualImage(dest);
  // Keep one project binding per ID so a stale extension cannot win on rescan.
  for(const file of fs.readdirSync(folder))if(/\.(png|jpg|jpeg|webp)$/i.test(file)&&path.parse(file).name.toLocaleLowerCase()===id.toLocaleLowerCase()&&path.resolve(folder,file)!==path.resolve(dest))fs.unlinkSync(path.join(folder,file));
  this.indexImages();this.revision++;return dest;
 }
 copyImage(name,r,from) {return this.saveImage(name,r,fs.readFileSync(from));}
 uploadImage(name,rid,bytes) {return this.saveImage(name,this.record(name,rid),bytes);}
 repairImageBindings({dryRun=false,expectedRevision}={}) {
  if(expectedRevision!==undefined&&expectedRevision!==this.revision)throw Error('数据库已有修改，请刷新后修复图片');
  const entries=[],seen=new Set(),byTable={},errors=[];let preserved=0,missing=0,aligned=0;
  for(const [name,t]of Object.entries(this.tables)){byTable[name]=0;for(const row of t.rows){
   try{const id=this.safeImageName(name,row),binding=name+'/'+id.toLocaleLowerCase();if(seen.has(binding))continue;seen.add(binding);
    if(this.images[name].get(id.toLocaleLowerCase())?.custom){preserved++;continue;}
    const image=this.image(name,row);if(!image){missing++;continue;}if(path.parse(image.file).name.toLocaleLowerCase()===id.toLocaleLowerCase()){aligned++;continue;}const bytes=fs.readFileSync(image.file),type=imageType(bytes);if(!type||bytes.length>12_000_000)throw Error('图片内容无效或超过 12 MB');
    const dest=path.join(this.overlayRoot,TABLES[name].folder,id+type.ext);entries.push({table:name,id,source:image.file,dest,bytes});byTable[name]++;
   }catch(error){errors.push({table:name,id:row[TABLES[name].key],error:error.message});}
  }}
  let manifest=null;if(entries.length&&!dryRun){manifest=path.join(this.backupDir,'image-bindings-'+stamp()+'.json');atomicWrite(manifest,JSON.stringify({createdAt:new Date().toISOString(),method:'Copy verified local image to the current database ID; existing custom ID bindings remain unchanged.',files:entries.map(({bytes,...entry})=>({...entry,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))},null,2));for(const entry of entries)atomicWrite(entry.dest,entry.bytes);this.indexImages();this.revision++;}
  return {count:entries.length,byTable,preserved,aligned,missing,errors,dryRun,manifest};
 }
 inspect() {
  const issues=[],teams=new Set(this.tables.Teams.rows.map(r=>r.Nick)),players=new Set(this.tables.Players.rows.map(r=>r.Id));
  for(const [name,t] of Object.entries(this.tables)){
   const seen=new Set(),key=TABLES[name].key;
   for(const r of t.rows){
    const add=(level,message)=>issues.push({table:name,rid:r._rid,label:r[TABLES[name].display],level,message});
    if(!r[key]||seen.has(r[key].toLowerCase()))add('error',`唯一 ID 为空或重复：${r[key]}`);seen.add(r[key].toLowerCase());
    if(r.Team&&!teams.has(r.Team))add('warning',`所属战队不存在：${r.Team}`);
    if(r.Academy&&!teams.has(r.Academy))add('warning',`青训队不存在：${r.Academy}`);
    if(name==='Players'&&r.Skill&&r.Potential&&+r.Skill>+r.Potential)add('warning','当前能力高于潜力（原库允许保留，建议核对）');
    if(name==='Teams'&&r.StartIGL&&!this.tables.Players.rows.some(p=>p.Team===r.Nick&&(p.Id===r.StartIGL||p.Nick===r.StartIGL)))add('warning',`首发指挥不在本队：${r.StartIGL}`);
   }
  }
  for(const [team,ids] of Object.entries(this.roster))for(const id of ids)if(!players.has(id)||!teams.has(team)||!this.tables.Players.rows.some(p=>p.Id===id&&p.Team===team))issues.push({table:'Teams',rid:this.tables.Teams.rows.find(r=>r.Nick===team)?._rid,label:team,level:'warning',message:`阵容引用不匹配：${id}`});
  return issues;
 }
 summary(){
  const counts={},coverage={};for(const [n,t] of Object.entries(this.tables)){counts[n]=t.rows.length;coverage[n]={matched:t.rows.filter(r=>this.image(n,r)).length,total:t.rows.length,assets:this.images[n].size};}
  return {counts,coverage,preferences:this.preferences,imageRoots:this.imageRoots.map(x=>({path:x.root,source:x.source,kind:x.kind})),source:this.source,imageRoot:this.imageRoot,workFile:this.workFile,backup:this.sourceBackup,gamePath:this.gamePath,lastSaved:this.lastSaved,revision:this.revision,undo:this.history.at(-1)?.label,redo:this.future.at(-1)?.label,log:this.log,lastExport:this.lastExport,formatVersion:this.doc.version,entries:this.doc.entries.map(e=>e.name)};
 }
 schema(name){const t=this.table(name);return {name,...TABLES[name],fields:t.headers.map(h=>{const f=fieldInfo(name,h,t.rows);if(['Team','Academy'].includes(h))f.choices=this.tables.Teams.rows.map(r=>r.Nick).sort((a,b)=>a.localeCompare(b));return f;}),headers:t.headers};}
 importCsv(name,text) {
  const result=this.mergeImport({format:'csv',table:name,text,overwriteEmpty:true});return result.total;
 }
 parseImport(input) {
  const tables={};
  if(input.format==='csv'){this.table(input.table);let table=parseCsv(input.text);if(table.headers.length===1&&table.headers[0].includes(','))table=parseCsv(input.text,',');tables[input.table]=table;}
  else if(input.format==='emdb'){
   const doc=decodeEmdb(Buffer.from(input.base64,'base64'),this.key);
   for(const [name,s] of Object.entries(TABLES)){const entry=doc.entries.find(e=>e.name===s.file);if(entry)tables[name]=parseCsv(entry.data.toString('utf8'));}
  }else if(input.format==='json'){
   let data=JSON.parse(input.text);if(Array.isArray(data))data={[input.table||'Players']:data};else data=data.tables||data;
   for(const [name,rows] of Object.entries(data)){
    if(!Object.hasOwn(TABLES,name)){if(['schema','format','version','images'].includes(name))continue;throw Error(`未知数据表：${name}`);}
    if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error(`${name} 应为记录数组`);
    const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];tables[name]={headers,rows};
   }
  }else throw Error('支持 .emdb、分号分隔 CSV 和 JSON 记录包');
  if(!Object.keys(tables).length)throw Error('文件中没有可导入的数据表');
  return tables;
 }
 planImport(input) {
  const incoming=this.parseImport(input), chosen=input.tables||Object.keys(incoming), plans=[],errors=[],totals={added:0,updated:0,unchanged:0,total:0};
  if(!Array.isArray(chosen)||chosen.some(n=>!Object.hasOwn(incoming,n)))throw Error('导入数据表选择无效');
  const teamNames=new Set(this.tables.Teams.rows.map(t=>t.Nick));
  if(chosen.includes('Teams'))for(const r of incoming.Teams.rows)if(r.Nick)teamNames.add(String(r.Nick));
  const byTable={};
  for(const name of chosen){
   const target=this.table(name), key=TABLES[name].key, file=incoming[name], seen=new Set(), counts={added:0,updated:0,unchanged:0,total:file.rows.length};
   if(file.headers.some(h=>!target.headers.includes(h)))throw Error(`${TABLES[name].label} 含未知字段：${file.headers.filter(h=>!target.headers.includes(h)).join('、')}`);
   if(!file.headers.includes(key))throw Error(`${TABLES[name].label} 导入必须包含唯一 ID 字段 ${key}`);
   const existing=new Map(target.rows.map(r=>[r[key].toLocaleLowerCase(),r]));
   for(const [index,partial] of file.rows.entries()){
    const id=String(partial[key]??'').trim(), normalized=id.toLocaleLowerCase();
    if(!id||seen.has(normalized)){errors.push({table:name,id,line:index+2,message:!id?`${key} 不能为空`:`导入文件有重复 ID：${id}`});continue;}seen.add(normalized);
    const old=existing.get(normalized), r=old?{...old}:Object.fromEntries(target.headers.map(h=>[h,'']));
    for(const h of target.headers)if(Object.hasOwn(partial,h)){
     const value=partial[h];if(value!==null&&typeof value==='object'){errors.push({table:name,id,message:`字段 ${h} 不能是对象`});continue;}
     const text=String(value??'');if(old&&!input.overwriteEmpty&&text==='')continue;r[h]=text;
    }
    r[key]=old?old[key]:id;if(!old&&!r[TABLES[name].display])r[TABLES[name].display]=id;
    try{this.validateRecord(name,r,old?._rid,true,teamNames);}catch(e){errors.push({table:name,id,line:index+2,message:e.message});}
    const fields=target.headers.filter(h=>!old||r[h]!==old[h]),kind=!old?'added':fields.length?'updated':'unchanged';
    counts[kind]++;plans.push({table:name,id,oldRid:old?._rid,row:r,kind,fields});
   }
   byTable[name]=counts;for(const k of Object.keys(totals))totals[k]+=counts[k];
  }
  return {plans,errors,totals,byTable,available:Object.fromEntries(Object.entries(incoming).map(([n,t])=>[n,t.rows.length])),revision:this.revision};
 }
 previewImport(input){const plan=this.planImport(input);return {totals:plan.totals,byTable:plan.byTable,available:plan.available,errors:plan.errors,revision:plan.revision,records:plan.plans.slice(0,100).map(p=>({table:p.table,id:p.id,label:p.row[TABLES[p.table].display],kind:p.kind,fields:p.fields}))};}
 mergeImport(input) {
  if(input.expectedRevision!==undefined&&input.expectedRevision!==this.revision)throw Error('数据库在预览后已有修改，请重新预览再导入');
  const plan=this.planImport(input);if(plan.errors.length)throw Error(plan.errors.slice(0,5).map(e=>`${e.id||'空 ID'}：${e.message}`).join('；'));
  if(!plan.totals.added&&!plan.totals.updated)return {...plan.totals,byTable:plan.byTable};
  const backup=path.join(this.backupDir,`before-merge-${stamp()}.emdb`);atomicWrite(backup,this.bytes());
  this.transaction(`合并导入 · 新增 ${plan.totals.added} / 更新 ${plan.totals.updated}`,()=>{
   for(const name of ['Teams','Players','Staff','Sponsors','Tournaments'])for(const p of plan.plans.filter(p=>p.table===name&&p.kind!=='unchanged')){
    if(p.oldRid)this.applyRow(name,this.record(name,p.oldRid),p.row);
    else {const r={...p.row,_rid:`${name}-${++this.sequence}`};this.tables[name].rows.push(r);this.touch(name);if(name==='Players'&&r.Team){(this.roster[r.Team]??=[]).push(r.Id);this.rosterDirty=true;}}
   }
  });return {...plan.totals,byTable:plan.byTable,backup};
 }
 exportDatabase(dest) {
  const issues=this.inspect();if(issues.some(x=>x.level==='error'))throw Error('请先修复唯一 ID 错误再导出');
  const bytes=this.bytes();decodeEmdb(bytes,this.key);atomicWrite(dest,bytes);this.lastExport=dest;return {path:dest,size:bytes.length,warnings:issues.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 }
}
