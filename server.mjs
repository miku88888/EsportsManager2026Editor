import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {Editor,atomicWrite,stamp} from './lib/model.mjs';
import {gameKey,writeCsv} from './lib/codec.mjs';
import {TABLES} from './lib/schema.mjs';
import {sortRecords} from './lib/sorting.mjs';
import {Library} from './lib/library.mjs';
import {ModExportJobs} from './lib/mod-package.mjs';
import {discoverInstall,makeConfiguration} from './lib/setup.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)), token=crypto.randomBytes(24).toString('hex');
const configPath=path.join(ROOT,'settings.json');
if(!fs.existsSync(configPath)){
 const detected=discoverInstall();
 if(!detected.source||!detected.gamePath)throw Error('首次使用请双击 启动编辑器.cmd，在配置向导中选择游戏和数据库；源码用户可按 README 创建 settings.json');
 atomicWrite(configPath,JSON.stringify(makeConfiguration(detected,ROOT),null,2));
}
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(process.env.WORLD_EDITOR_PROJECT_DIR)config.projectDir=path.resolve(process.env.WORLD_EDITOR_PROJECT_DIR);
const library=new Library({...config,key:gameKey(config.gamePath)});let editor=library.editor;
const exportsRoot=path.join(ROOT,'exports');fs.mkdirSync(exportsRoot,{recursive:true});
const modExports=new ModExportJobs(exportsRoot);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){const parts=[];let n=0;for await(const b of req){n+=b.length;if(n>25_000_000)throw Error('请求文件过大（最多 25 MB）');parts.push(b);}const buffer=Buffer.concat(parts);try{return JSON.parse(buffer.toString('utf8'));}catch{throw Error('请求格式无效');}}
async function binaryBody(req){const parts=[];let n=0;for await(const part of req){n+=part.length;if(n>512_000_000)throw Error('ZIP 超过 512 MB，请改用文件夹导入');parts.push(part);}return Buffer.concat(parts);}
function summary(){return {...editor.summary(),workspace:library.current(),calendar:library.calendar().summary(),imageSources:(config.linkedImageRoots||[]).map(r=>({id:r.id,name:r.source,root:r.root})),integration:config.integration?{configured:true,modRoot:config.integration.modRoot,personalImages:config.integration.personalImages}:null};}
function activeDatabase(){try{return JSON.parse(fs.readFileSync(path.join(os.homedir(),'AppData/LocalLow/NeuronaGames/EsportsManager/Save/workshop_database.json'),'utf8'));}catch{return null;}}
function view(name,r){const img=editor.imageSource(name,r);return {...r,_image:img?`/api/image?table=${name}&rid=${encodeURIComponent(r._rid)}&v=${editor.revision}&workspace=${library.activeId}`:null,_imageName:img?.name||null,_imageSource:img?.source||null,_imageKind:img?.kind||null,_imageBinding:editor.imageCandidates(name,r).find(Boolean),_customImage:img?.custom||false};}
function catalog(name,q=''){
 const map=editor.images[name];if(!map)throw Error('未知图片分类');
 return [...map.values()].filter(x=>x.name.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
}
function diff(){
 const result=[];
 for(const [name,t] of Object.entries(editor.tables)){
  const s=TABLES[name],old=new Map(editor.baseTables[name].rows.map(r=>[r[s.key],r]));
  for(const r of t.rows){const before=old.get(r[s.key]);if(!before)result.push({table:name,rid:r._rid,label:r[s.display],kind:'新增',fields:[]});else {const fields=t.headers.filter(h=>r[h]!==before[h]).map(h=>({field:h,before:before[h],after:r[h]}));if(fields.length)result.push({table:name,rid:r._rid,label:r[s.display],kind:'修改',fields});old.delete(r[s.key]);}}
  for(const r of old.values())result.push({table:name,label:r[s.display],kind:'删除',fields:[]});
 }
 return result;
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${server.address().port}`&&req.headers.host!==`localhost:${server.address().port}`){send(res,403,{error:'Host 不允许'});return;}
  const url=new URL(req.url,`http://127.0.0.1`), p=url.pathname, q=url.searchParams;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.headers['x-editor-workspace']&&req.headers['x-editor-workspace']!==library.activeId&&!['/api/bootstrap','/api/library'].includes(p))throw Error('其他窗口已切换工作副本，请刷新页面再操作');
  if(q.get('workspace')&&q.get('workspace')!==library.activeId)throw Error('图片所属工作副本已切换，请刷新页面');
  if(p==='/api/bootstrap'){send(res,200,{token,...summary(),customAssets:editor.customAssets,activeDatabase:activeDatabase(),tables:Object.fromEntries(Object.entries(TABLES).map(([n,s])=>[n,{...s,fields:editor.schema(n).fields}])),version:'1.3.1'});return;}
  if(p==='/api/library'){send(res,200,{workspaces:library.list(),active:library.activeId});return;}
  if(p==='/api/calendar-summary'){send(res,200,library.calendar().summary());return;}
  if(p==='/api/calendar-rows'){send(res,200,library.calendar().list(Object.fromEntries(q)));return;}
  if(p==='/api/calendar-record'){send(res,200,library.calendar().detail(q.get('file'),q.get('index')));return;}
  if(p==='/api/calendar-logo'){const image=editor.images.Tournaments.get((q.get('name')||'').toLocaleLowerCase());if(!image){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(image.file).toLowerCase()]||'image/png','Cache-Control':'no-store'});fs.createReadStream(image.file).pipe(res);return;}
  if(p==='/api/mod-export-status'){send(res,200,modExports.get(q.get('id'),editor.workFile));return;}
  if(p==='/api/merge-conflicts'){send(res,200,library.reviewList(Object.fromEntries(q)));return;}
  if(p==='/api/merge-conflict'){send(res,200,library.detail(q.get('id')));return;}
  if(p==='/api/merge-image'){const file=library.imageConflictFile(q.get('id'),q.get('side'));res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);return;}
  if(p==='/api/assets-zip'&&req.method==='POST'){if(req.headers['x-editor-token']!==token)throw Error('会话失效，请刷新页面');send(res,200,library.stageZip(await binaryBody(req)));return;}
  if(p==='/api/rows'){
   const name=q.get('table')||'Players', t=editor.table(name),text=(q.get('search')||'').trim().toLocaleLowerCase();
   let rows=t.rows.filter(r=>(!text||t.headers.some(h=>String(r[h]).toLocaleLowerCase().includes(text)))&&['Country','Team','Role','Gender','Type','Tier'].every(h=>!q.get(h)|| (q.get(h)==='__empty'?r[h]==='':r[h]===q.get(h)))&&(!q.get('missingImage')||!editor.image(name,r)));
   const sort=q.get('sort')||(t.headers.includes(TABLES[name].display)?TABLES[name].display:TABLES[name].key),dir=q.get('dir')||(sort==='CreatedAt'?'desc':'asc');
   if(!t.headers.includes(sort))throw Error('排序字段无效');
   sortRecords(rows,sort,dir,t.rows);
   const page=Math.max(1,Number(q.get('page'))||1),size=Math.min(200,Math.max(1,Number(q.get('size'))||50));
   send(res,200,{total:rows.length,page,size,rows:rows.slice((page-1)*size,page*size).map(r=>view(name,r)),ids:q.get('ids')==='1'?rows.map(r=>r._rid):undefined});return;
  }
  if(p==='/api/record'){
   const name=q.get('table'),r=editor.record(name,q.get('rid'));
   send(res,200,{record:view(name,r),roster:name==='Teams'?editor.rosterFor(r.Nick).map(p=>view('Players',p)):null,staff:name==='Teams'?editor.tables.Staff.rows.filter(x=>x.Team===r.Nick).map(p=>view('Staff',p)):null});return;
  }
  if(p==='/api/image'){
   const name=q.get('table'),r=editor.record(name,q.get('rid'));let img=editor.image(name,r);
   if(!img&&editor.preferences.remotePhotos)try{img=await editor.photoCache.get(r.PhotoUrl);}catch{res.writeHead(404,{'Cache-Control':'no-store'});res.end();return;}
   if(!img){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':mime[path.extname(img.file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store','X-Photo-Source':encodeURIComponent(img.source||'local')});fs.createReadStream(img.file).pipe(res);return;
  }
  if(p==='/api/media'){
   const entries=catalog(q.get('table'),q.get('search')||''),page=Math.max(1,Number(q.get('page'))||1);
   send(res,200,{total:entries.length,page,images:entries.slice((page-1)*60,page*60).map(x=>({name:x.name,custom:x.custom,source:x.source,url:`/api/media-image?table=${q.get('table')}&name=${encodeURIComponent(x.name)}&v=${editor.revision}`}))});return;
  }
  if(p==='/api/media-image'){
   const img=catalog(q.get('table')).find(x=>x.name===q.get('name'));if(!img)throw Error('图片不存在');res.writeHead(200,{'Content-Type':mime[path.extname(img.file).toLowerCase()],'Cache-Control':'no-store'});fs.createReadStream(img.file).pipe(res);return;
  }
  if(p==='/api/issues'){send(res,200,{issues:editor.inspect()});return;}
  if(p==='/api/diff'){send(res,200,{changes:diff()});return;}
  if(p==='/api/download'){
   const file=path.resolve(exportsRoot,q.get('file')||'');if(!file.startsWith(path.resolve(exportsRoot)+path.sep)||!fs.statSync(file).isFile())throw Error('导出文件不存在');
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`});fs.createReadStream(file).pipe(res);return;
  }
  if(p.startsWith('/api/')&&req.method==='POST'){
   if(req.headers['x-editor-token']!==token)throw Error('会话失效，请刷新页面');
   const data=await body(req);let result;
   if(p==='/api/library-preview'){result=library.previewDatabase(data);}
   else if(p==='/api/calendar-connect'){if(!config.integration?.modRoot)throw Error('请在设置中配置模组目录');result={calendar:library.calendar().connect(path.join(config.integration.modRoot,'calendar'))};}
   else if(p==='/api/calendar-import'){if(!Array.isArray(data.files))throw Error('请选择赛历文件夹');result={calendar:library.calendar().importFiles(data.files.map(f=>({name:f.name,data:Buffer.from(f.base64||'','base64')})))};}
   else if(p==='/api/calendar-edit'){result=library.calendar().edit(data);}
   else if(p==='/api/calendar-history'){if(!['undo','redo'].includes(data.direction))throw Error('赛历操作无效');result={calendar:library.calendar().historyAction(data.direction)};}
   else if(p==='/api/export-mod'){result=modExports.start({editor,calendar:library.calendar(),profile:{...config.integration,imagePriority:editor.preferences.preferredImageSource}});}
   else if(p==='/api/library-import'){const workspace=library.importDatabase(data);editor=library.editor;result={workspace};}
   else if(p==='/api/library-switch'){const workspace=library.switch(data.id);editor=library.editor;result={workspace};}
   else if(p==='/api/assets-stage'){if(!Array.isArray(data.files))throw Error('请选择图片文件');result=library.stage(data.files.map(f=>({name:f.path,data:Buffer.from(f.base64||'','base64')})),data.stageId);}
   else if(p==='/api/library-images'){result=library.importImages(data);}
   else if(p==='/api/merge-create'){const workspace=library.merge(data);editor=library.editor;result={workspace};}
   else if(p==='/api/merge-resolve'){result=library.resolve(data);}
   else if(p==='/api/merge-image-custom'){result=library.customConflictImage(data);}
   else if(p==='/api/merge-resolve-batch'){result=library.resolveBatch(data);}
   else if(p==='/api/update'){const rid=editor.patch(data.table,data.rid,data.changes);result={rid};}
   else if(p==='/api/add'){const rid=editor.add(data.table,data.values,data.cloneRid);result={rid};}
   else if(p==='/api/delete'){editor.remove(data.table,data.rids);result={};}
   else if(p==='/api/batch'){editor.batch(data.table,data.rids,data.field,data.mode,data.value);result={};}
   else if(p==='/api/undo'){result={label:library.historyReview('undo')};}
   else if(p==='/api/redo'){result={label:library.historyReview('redo')};}
   else if(p==='/api/roster'){editor.setRoster(data.team,data.ids);result={};}
   else if(p==='/api/image-upload'){result={path:editor.uploadImage(data.table,data.rid,Buffer.from(data.base64,'base64'))};}
   else if(p==='/api/image-assign'){const r=editor.record(data.table,data.rid),from=catalog(data.table).find(x=>x.name===data.name);if(!from)throw Error('图片不存在');result={path:editor.copyImage(data.table,r,from.file)};}
   else if(p==='/api/import-csv'){result={count:editor.importCsv(data.table,data.text)};}
   else if(p==='/api/import-preview'){result=editor.previewImport(data);}
   else if(p==='/api/import-merge'){result=editor.mergeImport(data);}
   else if(p==='/api/preferences'){result={preferences:editor.setPreferences(data)};}
   else if(p==='/api/refresh-images'){editor.indexImages();editor.revision++;result={};}
   else if(p==='/api/repair-image-bindings'){result=editor.repairImageBindings(data);}
   else if(p==='/api/export-selection'){
    const t=editor.table(data.table);if(!Array.isArray(data.rids)||!data.rids.length)throw Error('请先选择要导出的记录');
    const rows=data.rids.map(id=>editor.record(data.table,id)),file=`${data.table}-selected-${stamp()}.json`;
    atomicWrite(path.join(exportsRoot,file),JSON.stringify({format:'WorldUpdatedRecords',schema:1,tables:{[data.table]:rows.map(r=>Object.fromEntries(t.headers.map(h=>[h,r[h]]))) }},null,2));result={path:path.join(exportsRoot,file),url:`/api/download?file=${encodeURIComponent(file)}`,count:rows.length};
   }
   else if(p==='/api/export-csv'){
    const t=editor.table(data.table),file=`${data.table}-${stamp()}.csv`;atomicWrite(path.join(exportsRoot,file),Buffer.from(writeCsv(t)));result={path:path.join(exportsRoot,file),url:`/api/download?file=${encodeURIComponent(file)}`};
   }
   else if(p==='/api/export'){
    const prefix=`EsportsManager2026-${stamp()}`;
    if(data.package){
     const folder=path.join(exportsRoot,prefix),dbDir=path.join(folder,'DatabasePack'),imageDir=path.join(folder,'ImagesPack');fs.mkdirSync(path.join(dbDir,'Database'),{recursive:true});
     result=editor.exportDatabase(path.join(dbDir,'Database','World_Updated_Edited.emdb'));
     for(const [dir,kind,name] of [[dbDir,'Database','Edited Database'],[imageDir,'Images','Edited Database images']])atomicWrite(path.join(dir,'workshop.json'),JSON.stringify({schema:1,kind,id:'0',name,author:'',gameVersion:'1.1.4',contentVersion:1},null,2));
     for(const [name,s] of Object.entries(TABLES)){
      const dest=path.join(imageDir,s.folder);fs.mkdirSync(dest,{recursive:true});
      for(const img of editor.images[name].values())fs.copyFileSync(img.file,path.join(dest,img.name));
      for(const r of editor.tables[name].rows){const img=editor.image(name,r);if(img)try{fs.copyFileSync(img.file,path.join(dest,editor.safeImageName(name,r)+path.extname(img.file)));}catch{}}
     }
     atomicWrite(path.join(folder,'使用方法.txt'),`在游戏主菜单的数据库页面导入：\r\n${result.path}\r\n\r\nImagesPack 为完整配套图片包，可在游戏图片包功能使用，或将其中 Players、Staffs、Teams、Sponsors、Tournaments 文件夹复制到：\r\n${path.join(os.homedir(),'AppData/LocalLow/NeuronaGames/EsportsManager/CustomAssets')}\r\n\r\n数据库用于新建生涯。游戏当前启用的其他订阅库请在游戏数据库页面手动切换。\r\n`);
     result.packagePath=folder;result.imagePath=imageDir;
    }else {const file=`${prefix}.emdb`;result=editor.exportDatabase(path.join(exportsRoot,file));result.url=`/api/download?file=${encodeURIComponent(file)}`;}
    result.pendingConflicts=library.reviewSummary()?.pending||0;
   }
   else if(p==='/api/overwrite-source'){
    if(data.confirm!==path.basename(editor.source))throw Error('请输入原数据库文件名以确认写回');
    const current=fs.readFileSync(editor.source),backup=path.join(editor.backupDir,`before-writeback-${stamp()}.emdb`);atomicWrite(backup,current);
    result={...editor.exportDatabase(editor.source),backup};
   }
   else if(p==='/api/open'){
    const bytes=Buffer.from(data.base64,'base64'),backup=path.join(editor.backupDir,`before-open-${stamp()}.emdb`);atomicWrite(backup,editor.bytes());
    const oldDoc=editor.doc,oldState=editor.snapshot();
    try{editor.load(bytes);editor.save();editor.history=[];editor.future=[];result={backup};}catch(e){editor.doc=oldDoc;editor.restore(oldState);throw e;}
   }
   else if(p==='/api/shutdown'){send(res,200,{ok:true});setTimeout(()=>{server.close();process.exit(0);},250);return;}
   else if(p==='/api/reveal'){
    const allowed=[exportsRoot,editor.projectDir,editor.source,editor.imageRoot,editor.lastExport].filter(Boolean).map(x=>path.resolve(x));
    const target=path.resolve(data.path||exportsRoot);if(!allowed.some(p=>target===p||target.startsWith(p+path.sep)))throw Error('路径不允许');
    execFile('explorer.exe',fs.existsSync(target)&&fs.statSync(target).isFile()?['/select,',target]:[target]);result={};
   }
   else throw Error('未知操作');
   send(res,200,{...result,summary:{...summary(),tables:Object.fromEntries(Object.entries(TABLES).map(([n,s])=>[n,{...s,fields:editor.schema(n).fields}]))}});return;
  }
  if(req.method!=='GET'){send(res,405,{error:'请求方法不支持'});return;}
  const file=p==='/'?path.join(ROOT,'public/index.html'):path.join(ROOT,'public',p);
  if(!path.resolve(file).startsWith(path.join(ROOT,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)send(res,400,{error:e.message});else res.end();console.error(e.message);}
});
let port=Number(process.env.WORLD_EDITOR_PORT)||27496;
server.on('error',err=>{if(err.code==='EADDRINUSE'&&port<27510){port++;server.listen(port,'127.0.0.1');}else {console.error(err);process.exit(1);}});
server.listen(port,'127.0.0.1',()=>{
 const url=`http://127.0.0.1:${server.address().port}`;atomicWrite(path.join(process.env.WORLD_EDITOR_PROJECT_DIR?config.projectDir:ROOT,'running.json'),JSON.stringify({url,pid:process.pid}));console.log(`电竞经理 2026 数据库编辑器: ${url}`);
 if(process.argv.includes('--open'))execFile('powershell.exe',['-NoProfile','-WindowStyle','Hidden','-Command',`Start-Process '${url}'`]);
});
