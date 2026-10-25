import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Editor,atomicWrite,stamp} from './model.mjs';
import {unzip} from './codec.mjs';
import {TABLES,NUMERIC_FIELDS} from './schema.mjs';
import {automaticChanges} from '../public/conflict-values.js';
import {imageType} from './photos.mjs';
import {readDatabase,prepareDatabase,combineDatabases,orderedRoster,digest,folded} from './merge-review.mjs';
import {teamImageCandidates,normalizedTeamImages,findTeamImage} from './team-images.mjs';
import {personImageCandidates,findPersonImage} from './person-images.mjs';
import {CalendarStore} from './calendar.mjs';

const uid=()=>crypto.randomBytes(12).toString('hex');
const folders=new Map(Object.entries(TABLES).map(([name,s])=>[s.folder.toLowerCase(),{table:name,folder:s.folder}]));
// EMSkin uses these semantic directories; images/badges/trophies are interface
// artwork or awards and must not be mistaken for people, sponsors or team logos.
for(const [folder,table]of Object.entries({photos:'Players',staff:'Staff',teamlogos:'Teams',logos:'Tournaments'}))folders.set(folder,{table,folder:TABLES[table].folder});
const readJson=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
function safeImagePath(value){
 const raw=String(value).replaceAll('\\','/');if(raw.startsWith('/')||/^[a-z]:/i.test(raw)||raw.includes('\0')||raw.split('/').includes('..'))throw Error('图片包包含不安全路径');
 const parts=raw.split('/').filter(Boolean),group=folders.get(parts.at(-2)?.toLowerCase());if(!group||!(/\.(png|jpe?g|webp)$/i.test(parts.at(-1)||'')))return null;
 const file=parts.at(-1),stem=path.parse(file).name;if(!stem||/[<>:"/\\|?*\x00-\x1f]/.test(stem)||stem.endsWith('.')||stem.endsWith(' ')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))throw Error('图片文件名不受 Windows 支持：'+file);
 return {...group,stem,key:group.table+'/'+folded(stem)};
}
export function imageEntries(entries,{allowEmpty=false}={}){
 const result=new Map();for(const entry of entries){const info=safeImagePath(entry.name);if(!info)continue;const type=imageType(entry.data);if(!type||entry.data.length>12_000_000)throw Error('图片无效或超过 12 MB：'+entry.name);const image={...info,name:info.stem+type.ext,data:Buffer.from(entry.data)};const old=result.get(info.key);if(old&&!old.data.equals(image.data))throw Error('图片库存在同名不同内容的文件：'+entry.name);result.set(info.key,image);}
 if(!result.size&&!allowEmpty)throw Error('没有找到资料图片。支持 Players / Staffs / Teams / Sponsors / Tournaments，以及 EMSkin 的 photos / staff / teamlogos / logos 目录');return [...result.values()];
}
function overlayImages(root){
 const result=[];for(const [table,s]of Object.entries(TABLES)){const dir=path.join(root,s.folder);if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir))if(/\.(png|jpe?g|webp)$/i.test(f)){const file=path.join(dir,f);if(fs.statSync(file).isFile())result.push({table,folder:s.folder,stem:path.parse(f).name,key:table+'/'+folded(path.parse(f).name),name:f,file});}}return result;
}
export class Library {
 constructor(config){
  this.config=config;this.root=config.projectDir;this.stateFile=path.join(this.root,'workspaces.json');this.workspaceRoot=path.join(this.root,'workspaces');this.stageRoot=path.join(this.root,'.incoming');this.instances=new Map();this.plans=new Map();this.views=new WeakMap();this.calendars=new Map();
  this.state=readJson(this.stateFile,{schema:1,active:'main',workspaces:[{id:'main',name:'初始数据库 · 工作副本',createdAt:new Date().toISOString()}]});
  if(!Array.isArray(this.state.workspaces)||!this.state.workspaces.some(w=>w.id==='main'))throw Error('工作副本目录无效');
  this.activeId=this.state.active||'main';this.editor=this.getEditor(this.activeId);
 }
 workspace(id){const item=this.state.workspaces.find(w=>w.id===id);if(!item||!(/^[a-f0-9]{24}$/.test(id)||id==='main'))throw Error('工作副本不存在');return item;}
 dir(id){this.workspace(id);return id==='main'?this.root:path.join(this.workspaceRoot,id);}
 getEditor(id){
  const item=this.workspace(id);if(!this.instances.has(id)){const dir=this.dir(id),source=id==='main'?this.config.source:path.join(dir,'source.emdb'),editor=new Editor({...this.config,source,projectDir:dir,sharedAssetsDir:this.root,workspaceCreatedAt:id==='main'?null:item.createdAt});if(this.editor)editor.photoCache=this.editor.photoCache;this.instances.set(id,editor);}return this.instances.get(id);
 }
 saveState(){atomicWrite(this.stateFile,JSON.stringify(this.state,null,2));}
 switch(id){const editor=this.getEditor(id);this.activeId=id;this.state.active=id;this.editor=editor;this.saveState();return this.describe(id);}
 describe(id){const item=this.workspace(id),editor=this.getEditor(id),review=this.reviewSummary(id);return {...item,active:this.activeId===id,workFile:editor.workFile,counts:Object.fromEntries(Object.entries(editor.tables).map(([n,t])=>[n,t.rows.length])),images:overlayImages(editor.overlayRoot).length,review};}
 list(){return this.state.workspaces.map(item=>this.describe(item.id));}
 current(){return {...this.workspace(this.activeId),review:this.reviewSummary(this.activeId)};}
 calendar(id=this.activeId){if(!this.calendars.has(id))this.calendars.set(id,new CalendarStore(this.dir(id)));return this.calendars.get(id);}
 create(bytes,name,images=[],plan=null,sources=null,originalBytes=bytes){
  readDatabase(bytes,this.config.key);const id=uid(),dir=path.join(this.workspaceRoot,id);fs.mkdirSync(dir,{recursive:true});atomicWrite(path.join(dir,'source.emdb'),originalBytes);atomicWrite(path.join(dir,'World_Updated_Edited.emdb'),bytes);
  if(this.editor)atomicWrite(path.join(dir,'editor-settings.json'),JSON.stringify(this.editor.preferences));
  for(const image of images){const dest=path.join(dir,'Images',TABLES[image.table].folder,image.name);atomicWrite(dest,image.data||fs.readFileSync(image.file));}
  if(plan){if(sources){for(const side of ['left','right']){atomicWrite(path.join(dir,'merge-inputs',side+'.emdb'),sources[side].bytes);if(sources[side].originalBytes&&!sources[side].originalBytes.equals(sources[side].bytes))atomicWrite(path.join(dir,'merge-inputs',side+'-original.emdb'),sources[side].originalBytes);for(const image of sources[side].images){const target=path.join(dir,'merge-inputs',side,'Images',image.folder,image.name);atomicWrite(target,image.data||fs.readFileSync(image.file));}}}atomicWrite(path.join(dir,'merge-review.json'),JSON.stringify(plan));}
  this.state.workspaces.push({id,name:String(name||'导入的数据库').trim().slice(0,120)||'导入的数据库',createdAt:new Date().toISOString(),kind:plan?.type==='import'?'import':plan?'merge':'import'});this.saveState();this.switch(id);return this.describe(id);
 }
 importDatabase(data){const original=Buffer.from(data.base64||'','base64'),prepared=prepareDatabase(original,this.config.key),images=data.stageId?this.stageImages(data.stageId):[],issues=prepared.conflicts,plan=issues.length?{schema:1,type:'import',createdAt:new Date().toISOString(),leftLabel:'原库中先出现的记录',rightLabel:'原库中重复或缺少 ID 的记录',conflicts:issues,decisions:{}}:null;const workspace=this.create(prepared.bytes,data.name||data.filename,this.canonicalImages(prepared.bytes,this.identityImages(prepared.bytes,images,issues)),plan,null,original);if(data.stageId)this.editor.setPreferences({preferredImageSource:''});return this.describe(workspace.id);}
 previewDatabase(data){const parsed=prepareDatabase(Buffer.from(data.base64||'','base64'),this.config.key);return {version:parsed.doc.version,counts:Object.fromEntries(Object.entries(parsed.tables).map(([name,t])=>[name,t.rows.length])),identityIssues:parsed.conflicts.map(c=>({table:c.table,originalKey:c.originalKey,key:c.key,line:c.line,firstLine:c.firstLine}))};}
 stageDir(id){if(!/^[a-f0-9]{24}$/.test(id))throw Error('图片暂存编号无效');return path.join(this.stageRoot,id);}
 stageImages(id){const dir=this.stageDir(id);if(!fs.existsSync(dir))throw Error('图片暂存不存在');return overlayImages(path.join(dir,'Images'));}
 stage(entries,id=uid()){
  const images=imageEntries(entries,{allowEmpty:true}),dir=this.stageDir(id);const existing=new Map(this.stageImagesIfPresent(id).map(i=>[i.key,i]));for(const image of images){const old=existing.get(image.key);if(old&&!fs.readFileSync(old.file).equals(image.data))throw Error('图片选择中存在同名冲突：'+image.name);}
  fs.mkdirSync(path.join(dir,'Images'),{recursive:true});for(const image of images)atomicWrite(path.join(dir,'Images',image.folder,image.name),image.data);const all=this.stageImages(id);return {stageId:id,count:all.length,ignored:entries.filter(e=>!safeImagePath(e.name)).length,counts:Object.fromEntries(Object.keys(TABLES).map(t=>[t,all.filter(i=>i.table===t).length]))};
 }
 stageImagesIfPresent(id){return fs.existsSync(this.stageDir(id))?this.stageImages(id):[];}
 stageZip(bytes){const entries=unzip(bytes);imageEntries(entries);return this.stage(entries);}
 importImages({stageId,mode='merge'}){
  if(!['merge','replace'].includes(mode))throw Error('图片导入模式无效');const incoming=this.canonicalImages(this.editor.bytes(),this.stageImages(stageId));if(!incoming.length)throw Error('没有暂存的资料图片，请选择支持的分类目录');const editor=this.editor,existing=overlayImages(editor.overlayRoot),keys=new Set(incoming.map(i=>i.key)),affected=mode==='replace'?existing:existing.filter(i=>keys.has(i.key)),backup=path.join(editor.backupDir,'images-'+stamp());
  for(const image of affected)atomicWrite(path.join(backup,image.folder,image.name),fs.readFileSync(image.file));for(const image of affected)fs.unlinkSync(image.file);
  try{for(const image of incoming)atomicWrite(path.join(editor.overlayRoot,image.folder,image.name),fs.readFileSync(image.file));}catch(error){for(const image of incoming){const dest=path.join(editor.overlayRoot,image.folder,image.name);if(fs.existsSync(dest))fs.unlinkSync(dest);}for(const image of affected)atomicWrite(image.file,fs.readFileSync(path.join(backup,image.folder,image.name)));throw error;}
  editor.indexImages();editor.revision++;return {count:incoming.length,backup:affected.length?backup:null};
 }
 canonicalImages(bytes,images){
  const {tables}=readDatabase(bytes,this.config.key),result=new Map(images.map(i=>[i.key,i]));
  for(const [table,s]of Object.entries(TABLES)){
   const own=new Map(images.filter(i=>i.table===table).map(i=>[folded(i.stem),{...i,source:'工作副本图片',priority:1}])),normalized=table==='Teams'?normalizedTeamImages(own):null;
   for(const row of tables[table].rows){let image;const candidates=table==='Teams'?teamImageCandidates(row):table==='Sponsors'?[row.Num,row.CompanyName]:table==='Tournaments'?[row.CupId,row.id,row.Name]:personImageCandidates(table,row);
    if(table==='Teams')image=findTeamImage(own,normalized,row);else if(['Players','Staff'].includes(table))image=findPersonImage(table,own,row);else for(const candidate of candidates){image=own.get(folded(candidate));if(image)break;}
    const id=String(candidates.find(Boolean)||'');if(image){let info;try{info=safeImagePath(s.folder+'/'+id+path.extname(image.name));}catch{continue;}if(info)result.set(info.key,{...image,...info,name:info.stem+path.extname(image.name)});}
   }
  }return [...result.values()];
 }
 identityImages(bytes,images,conflicts){
  if(!conflicts.length)return images;const result=new Map(images.map(i=>[i.key,i]));
  for(const c of conflicts){const s=TABLES[c.table],own=new Map(images.filter(i=>i.table===c.table).map(i=>[folded(i.stem),i]));let image;
   for(const candidate of [c.key,c.right?.Nick,c.right?.Name,c.originalKey]){image=own.get(folded(candidate));if(image)break;}
   if(image){let info;try{info=safeImagePath(s.folder+'/'+c.key+path.extname(image.name));}catch{continue;}if(info)result.set(info.key,{...image,...info,name:c.key+path.extname(image.name)});}
  }return [...result.values()];
 }
 source(input){
  const editor=input.workspaceId?this.getEditor(input.workspaceId):null,originalBytes=editor?editor.bytes():Buffer.from(input.base64||'','base64'),prepared=prepareDatabase(originalBytes,this.config.key),existing=editor?(this.plan(input.workspaceId)?.conflicts||[]).filter(c=>c.kind==='identity'&&this.status(c,input.workspaceId)==='pending'):[],issues=[...existing,...prepared.conflicts],images=editor?overlayImages(editor.overlayRoot):input.stageId?this.stageImages(input.stageId):[];
  return {bytes:prepared.bytes,originalBytes,identityIssues:issues,images:this.canonicalImages(prepared.bytes,this.identityImages(prepared.bytes,images,issues)),label:editor?this.workspace(input.workspaceId).name:input.name||input.filename||'EMDB'};
 }
 merge(input){
  const imagePriority=input.imagePriority||'review';if(!['review','left','right'].includes(imagePriority))throw Error('图片优先库无效');
  const left=this.source(input.left),right=this.source(input.right),merged=combineDatabases(left.bytes,right.bytes,this.config.key,left.label,right.label),images=new Map(left.images.map(i=>[i.key,i]));
  for(const [side,source]of [['left',left],['right',right]])for(const c of source.identityIssues)merged.plan.conflicts.push({...structuredClone(c),id:'identity-'+side+'-'+merged.plan.conflicts.length,sourceLabel:source.label});
  for(const image of right.images){const old=images.get(image.key);if(!old)images.set(image.key,image);else if(!fs.readFileSync(old.file).equals(fs.readFileSync(image.file))){merged.plan.conflicts.push({id:'image-'+merged.plan.conflicts.length,kind:'image',table:image.table,key:image.stem,label:image.stem+' · 图片',left:{folder:old.folder,name:old.name},right:{folder:image.folder,name:image.name}});if(imagePriority==='right')images.set(image.key,image);}}
  merged.plan.imagePriority=imagePriority;const workspace=this.create(merged.bytes,input.name||left.label+' + '+right.label,[...images.values()],merged.plan,{left,right});
  if(imagePriority!=='review'){const chosen=this.plan().conflicts.filter(c=>c.kind==='image');for(const c of chosen){const file=this.imageConflictFile(c.id,'current');this.editor.manualImages[path.relative(this.editor.overlayRoot,file).replaceAll('\\','/').toLowerCase()]=true;}if(chosen.length){atomicWrite(this.editor.manualImagesFile,JSON.stringify(this.editor.manualImages,null,2));this.editor.indexImages();this.editor.revision++;}for(const c of chosen)this.plan().decisions[c.id]={mode:imagePriority,at:new Date().toISOString(),hash:this.fingerprint(c)};this.savePlan();}
  const leftCalendar=input.left.workspaceId?this.calendar(input.left.workspaceId):null;if(leftCalendar?.files().length)this.calendar().importFiles(leftCalendar.exportEntries('').map(e=>({name:e.name.replace(/^\//,''),data:fs.readFileSync(e.file)})),'A 库赛历副本');return this.describe(workspace.id);
 }
 plan(id=this.activeId){if(!this.plans.has(id)){const file=path.join(this.dir(id),'merge-review.json');this.plans.set(id,readJson(file,null));}return this.plans.get(id);}
 savePlan(id=this.activeId){atomicWrite(path.join(this.dir(id),'merge-review.json'),JSON.stringify(this.plan(id)));}
 conflict(id,workspace=this.activeId){const plan=this.plan(workspace),conflict=plan?.conflicts.find(c=>c.id===id);if(!conflict)throw Error('冲突不存在');return conflict;}
 lookup(editor){let view=this.views.get(editor);if(!view||view.revision!==editor.revision||view.tables!==editor.tables){view={revision:editor.revision,tables:editor.tables,rows:Object.fromEntries(Object.entries(editor.tables).map(([name,t])=>[name,new Map(t.rows.map(r=>[folded(r[TABLES[name].key]),r]))])),images:new Map(overlayImages(editor.overlayRoot).map(i=>[i.key,i])),hashes:new Map()};this.views.set(editor,view);}return view;}
 currentValue(conflict,workspace=this.activeId){
  const editor=this.getEditor(workspace),s=TABLES[conflict.table];
  if(conflict.kind==='record'){const row=this.lookup(editor).rows[conflict.table].get(folded(conflict.key));return row?Object.fromEntries(conflict.fields.map(f=>[f.field,row[f.field]??''])):null;}
  if(conflict.kind==='identity'){const rows=this.lookup(editor).rows[conflict.table],row=[...(conflict.keys||[conflict.key])].reverse().map(key=>rows.get(folded(key))).find(Boolean),first=conflict.originalKey?rows.get(folded(conflict.originalKey)):null,clean=r=>r?Object.fromEntries(editor.tables[conflict.table].headers.map(h=>[h,r[h]??''])):null;return {first:clean(first),record:clean(row)};}
  if(conflict.kind==='roster')return orderedRoster(editor,conflict.key,editor.roster[conflict.key]||[]);
  if(conflict.kind==='attachment')return editor.doc.entries.find(e=>e.name===conflict.key)?.data?Buffer.from(editor.doc.entries.find(e=>e.name===conflict.key).data).toString('base64'):null;
  if(conflict.kind==='image'){const image=this.lookup(editor).images.get(conflict.table+'/'+folded(conflict.key));return image?digest(fs.readFileSync(image.file)):null;}
 }
 fingerprint(conflict,workspace=this.activeId){const view=this.lookup(this.getEditor(workspace));if(!view.hashes.has(conflict.id))view.hashes.set(conflict.id,digest(Buffer.from(JSON.stringify(this.currentValue(conflict,workspace)))));return view.hashes.get(conflict.id);}
 status(conflict,workspace=this.activeId){const decision=this.plan(workspace)?.decisions[conflict.id];return decision&&decision.hash===this.fingerprint(conflict,workspace)?'resolved':'pending';}
 reviewSummary(workspace=this.activeId){const plan=this.plan(workspace);if(!plan)return null;let resolved=0;for(const conflict of plan.conflicts)if(this.status(conflict,workspace)==='resolved')resolved++;return {type:plan.type||'merge',total:plan.conflicts.length,resolved,pending:plan.conflicts.length-resolved,leftLabel:plan.leftLabel,rightLabel:plan.rightLabel,counts:plan.counts};}
 reviewList({status='pending',table='',kind='',search='',page=1}={}){
  const plan=this.plan();if(!plan)return {summary:null,items:[],total:0,page:1};const text=String(search).toLocaleLowerCase();const rows=plan.conflicts.map(c=>({id:c.id,kind:c.kind,table:c.table,key:c.key,label:c.label,fields:c.fields?.length||0,status:this.status(c)})).filter(c=>(status==='all'||c.status===status)&&(!table||c.table===table)&&(!kind||c.kind===kind)&&(!text||(c.key+' '+c.label).toLocaleLowerCase().includes(text)));const current=Math.min(Math.max(1,Number(page)||1),Math.max(1,Math.ceil(rows.length/40)));return {summary:this.reviewSummary(),total:rows.length,page:current,items:rows.slice((current-1)*40,current*40)};
 }
 detail(id){
  const c=this.conflict(id),editor=this.editor,current=this.currentValue(c),out={...c,current,status:this.status(c),revision:editor.revision,decision:this.plan().decisions[id]?.mode};
  if(c.kind==='record'){const s=TABLES[c.table],row=editor.tables[c.table].rows.find(r=>folded(r[s.key])===folded(c.key));out.rid=row?._rid;}
  if(c.kind==='identity'){const key=TABLES[c.table].key,row=current.record?this.lookup(editor).rows[c.table].get(folded(current.record[key])):null;out.rid=row?._rid;out.keyField=key;}
  if(c.kind==='roster'){out.left=orderedRoster(editor,c.key,c.left);out.right=orderedRoster(editor,c.key,c.right);}
  if(c.kind==='attachment'){for(const side of ['left','right','current']){const bytes=Buffer.from(out[side]||'','base64');out[side]={size:bytes.length,hash:digest(bytes),text:bytes.subarray(0,20000).toString('utf8')};}}
  return out;
 }
 imageConflictFile(id,side){const c=this.conflict(id);if(c.kind!=='image'||!['left','right','current'].includes(side))throw Error('冲突图片无效');if(side==='current'){const image=this.lookup(this.editor).images.get(c.table+'/'+folded(c.key));if(!image)throw Error('当前图片不存在');return image.file;}return path.join(this.dir(this.activeId),'merge-inputs',side,'Images',c[side].folder,c[side].name);}
 customConflictImage({id,base64,expectedRevision}){if(expectedRevision!==undefined&&expectedRevision!==this.editor.revision)throw Error('数据库已有修改，请刷新冲突');const c=this.conflict(id);if(c.kind!=='image')throw Error('请选择图片冲突');const stage=this.stage([{name:TABLES[c.table].folder+'/'+c.key+'.png',data:Buffer.from(base64||'','base64')}]);this.importImages({stageId:stage.stageId});return this.resolve({id,mode:'current'});}
 recordChange(c,mode,changes={}){const editor=this.editor,s=TABLES[c.table],old=this.lookup(editor).rows[c.table].get(folded(c.key));if(!old)throw Error('记录已删除，请还原记录或在当前冲突选择保留当前');const row={...old};if(mode==='manual'){for(const [field,value]of Object.entries(changes)){if(!c.fields.some(f=>f.field===field))throw Error('只能修改此冲突中列出的字段');row[field]=String(value??'');}}else for(const field of c.fields)row[field.field]=field[mode];editor.validateRecord(c.table,row,old._rid,true);return {old,row};}
 resolve({id,mode,changes={},expectedRevision}){
  if(expectedRevision!==undefined&&expectedRevision!==this.editor.revision)throw Error('当前数据库已修改，请刷新冲突再保存');if(!['left','right','manual','current'].includes(mode))throw Error('冲突处理方式无效');const c=this.conflict(id),editor=this.editor;
  if(mode!=='current'){
   if(c.kind==='identity'){if(mode!=='manual')throw Error('重复 ID 需要逐项设置独立 ID；若要删除记录，请在资料列表中操作');const detail=this.detail(id);if(!detail.rid)throw Error('记录已删除，可确认当前结果或在资料列表还原');if(Object.keys(changes).some(h=>h!==detail.keyField))throw Error('ID 核对只能更改唯一 ID');editor.patch(c.table,detail.rid,changes);const next=editor.record(c.table,detail.rid)[detail.keyField];c.keys=[...new Set([...(c.keys||[c.key]),next])];}
   else if(c.kind==='record'){const {old,row}=this.recordChange(c,mode,changes);editor.transaction('合并冲突 · '+c.label,()=>editor.applyRow(c.table,old,row));}
   else if(c.kind==='roster'){if(mode==='manual')throw Error('阵容冲突请选择 A、B 或保留当前；也可以到战队资料编辑阵容');editor.setRoster(c.key,orderedRoster(editor,c.key,c[mode]));}
   else if(c.kind==='attachment'){if(mode==='manual')throw Error('附加文件请选择 A、B 或保留当前');editor.transaction('合并附加文件 · '+c.key,()=>{const entry=editor.doc.entries.find(e=>e.name===c.key);entry.data=Buffer.from(c[mode],'base64');editor.extrasDirty=true;});}
   else if(c.kind==='image'){if(mode==='manual')throw Error('图片请选择 A、B 或保留当前；也可以在资料中上传后保留当前');const from=this.imageConflictFile(id,mode),bytes=fs.readFileSync(from),dest=path.join(editor.overlayRoot,c[mode].folder,c[mode].name),existing=overlayImages(editor.overlayRoot).filter(i=>i.key===c.table+'/'+folded(c.key));for(const image of existing)if(path.resolve(image.file)!==path.resolve(dest))fs.unlinkSync(image.file);atomicWrite(dest,bytes);editor.markManualImage(dest);editor.indexImages();editor.revision++;}
  }
  this.plan().decisions[id]={mode,at:new Date().toISOString(),hash:this.fingerprint(c)};this.savePlan();return {id,review:this.reviewSummary()};
 }
 resolveAutomaticBatch({mode,ids,scope='pending',expectedRevision}){
  if(!['random','min'].includes(mode)||!['pending','all'].includes(scope))throw Error('自动处理方式或范围无效');const editor=this.editor;
  if(expectedRevision!==undefined&&expectedRevision!==editor.revision)throw Error('数据库已有修改，请刷新后重新批量处理');
  const selection=ids?new Set(ids):null,list=(this.plan()?.conflicts||[]).filter(c=>(!selection||selection.has(c.id))&&(scope==='all'||this.status(c)==='pending')),records=[],errors=[],skipped={nonRecord:0,noNumeric:0};let chosenFields=0,retainedFields=0;
  for(const c of list){if(c.kind!=='record'){skipped.nonRecord++;continue;}const values=automaticChanges(c.fields,mode,{numericFields:NUMERIC_FIELDS});if(!values.chosenFields){skipped.noNumeric++;continue;}
   try{records.push({c,changes:values.changes,...this.recordChange(c,'manual',values.changes)});chosenFields+=values.chosenFields;retainedFields+=values.retainedFields;}catch(error){errors.push({id:c.id,label:c.label,error:error.message});}
  }
  let backup=null;
  if(records.length){
   const before=Object.fromEntries(records.map(({c})=>[c.id,structuredClone(this.plan().decisions[c.id]||null)]));
   backup=path.join(editor.backupDir,'before-auto-'+stamp());atomicWrite(path.join(backup,'database.emdb'),editor.bytes());atomicWrite(path.join(backup,'merge-review.json'),JSON.stringify(this.plan()));
   editor.transaction(mode==='min'?'批量冲突 · 数值取最小值':'批量冲突 · 随机采用 A/B',()=>{for(const {c,old,changes}of records)editor.applyRow(c.table,old,{...old,...changes});});
   const at=new Date().toISOString();for(const {c}of records)this.plan().decisions[c.id]={mode,at,hash:this.fingerprint(c)};
   const after=Object.fromEntries(records.map(({c})=>[c.id,structuredClone(this.plan().decisions[c.id])]));editor.history.at(-1).reviewChanges={before,after};this.savePlan();
  }
  return {count:records.length,errors,skipped,chosenFields,retainedFields,backup,scope,review:this.reviewSummary()};
 }
 historyReview(direction){
  const editor=this.editor,entry=(direction==='undo'?editor.history:editor.future).at(-1),changes=entry?.reviewChanges,label=editor[direction]();
  if(changes){const from=direction==='undo'?changes.after:changes.before,to=direction==='undo'?changes.before:changes.after,plan=this.plan();
   for(const [id,value]of Object.entries(to))if(JSON.stringify(plan.decisions[id]||null)===JSON.stringify(from[id]||null)){if(value)plan.decisions[id]=structuredClone(value);else delete plan.decisions[id];}this.savePlan();
   // Editor creates a new history entry during undo/redo; carry the paired review state.
   (direction==='undo'?editor.future:editor.history).at(-1).reviewChanges=changes;
  }return label;
 }
 resolveBatch({mode='current',ids,scope='pending',expectedRevision}){
  if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw Error('冲突选择无效');
  if(['random','min'].includes(mode))return this.resolveAutomaticBatch({mode,ids,scope,expectedRevision});
  if(!['current','left','right'].includes(mode))throw Error('批量处理方式无效');const list=this.plan()?.conflicts.filter(c=>(!ids||ids.includes(c.id))&&this.status(c)==='pending')||[];let count=0;const errors=[],records=[];
  if(mode!=='current')for(const c of list.filter(c=>c.kind==='record'))try{records.push({c,...this.recordChange(c,mode)});}catch(error){errors.push({id:c.id,label:c.label,error:error.message});}
  if(records.length)this.editor.transaction('批量处理合并冲突',()=>{for(const {c,old,row}of records)this.editor.applyRow(c.table,old,row);});
  for(const c of list){if(errors.some(e=>e.id===c.id))continue;try{if(c.kind==='identity')throw Error('重复或空 ID 请逐项核对，批量处理已跳过');if(mode==='current'||c.kind==='record'){this.plan().decisions[c.id]={mode,at:new Date().toISOString(),hash:this.fingerprint(c)};count++;}else{this.resolve({id:c.id,mode});count++;}}catch(error){errors.push({id:c.id,label:c.label,error:error.message});}}
  this.savePlan();return {count,errors,review:this.reviewSummary()};
 }
}
