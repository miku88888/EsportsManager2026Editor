import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {TABLES} from './schema.mjs';
import {writeZipFiles} from './archive.mjs';
import {stamp,atomicWrite} from './model.mjs';
export function modPackageEntries({editor,calendar,profile}){
 if(!profile?.modRoot||!fs.existsSync(profile.modRoot))throw Error('尚未配置 iamgri 模组来源目录');const entries=new Map(),put=(name,item)=>entries.set(name.toLocaleLowerCase(),{name,...item}),tree=(root,prefix)=>{for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const full=path.join(root,entry.name),name=prefix+'/'+entry.name;if(entry.isDirectory())tree(full,name);else if(entry.isFile())put(name,{file:full});}};
 tree(path.dirname(profile.modRoot),'BepInEx');if(profile.skinRoot&&fs.existsSync(profile.skinRoot))tree(path.dirname(profile.skinRoot),'BepInEx');
 for(const entry of calendar.exportEntries())put(entry.name,{data:fs.readFileSync(entry.file)});put('BepInEx/emskin/database/iamgri mod.emdb',{data:editor.bytes()});
 const directories={Players:'photos',Staff:'staff',Teams:'teamlogos',Tournaments:'logos'},canonical=new Set(),aliases=[],stem=name=>name.toLocaleLowerCase().replace(/\.(png|jpe?g|webp)$/,''),putImage=entry=>{const key=stem(entry.name);for(const ext of ['.png','.jpg','.jpeg','.webp'])entries.delete(key+ext);const stat=fs.statSync(entry.file);put(entry.name,{file:entry.file,expectedSize:stat.size,expectedMtime:stat.mtimeMs});};
 for(const [table,folder]of Object.entries(directories))for(const row of editor.tables[table].rows){const image=editor.image(table,row);if(!image)continue;let id;try{id=editor.safeImageName(table,row);}catch{continue;}const ext=path.extname(image.file),name='BepInEx/emskin/'+folder+'/'+id+ext;canonical.add(stem(name));putImage({name,file:image.file});const candidates=editor.imageCandidates(table,row).filter(n=>n&&(['Players','Staff'].includes(table)?n!==row.Name:true)&&!/[<>:"/\\|?*\x00-\x1f]/.test(n)&&!n.endsWith('.')&&!n.endsWith(' '));for(const alias of candidates)aliases.push({name:'BepInEx/emskin/'+folder+'/'+alias+ext,file:image.file});}
 for(const entry of aliases)if(!canonical.has(stem(entry.name)))putImage(entry);
 put('使用说明.txt',{data:Buffer.from('将 ZIP 中的 BepInEx 文件夹整体复制到已安装原 iamgri 模组的游戏目录，合并覆盖即可。\r\n数据库、配套图片与 calendar 赛历已按此工作副本一起打包，无需逐个分类导入。\r\n这是模组内容包；游戏和 BepInEx 运行环境沿用原安装。\r\n备份原 BepInEx 内容后再替换。数据库更改用于新建生涯，已有生涯数据不会自动重建。\r\n')});
 put('整合包清单.json',{data:Buffer.from(JSON.stringify({schema:1,createdAt:new Date().toISOString(),database:editor.workFile,calendar:calendar.summary(),imageSourcePriority:profile.imagePriority||'personal',sources:{mod:profile.modRoot,skin:profile.skinRoot,personal:profile.personalImages}},null,2))});return [...entries.values()];
}
export class ModExportJobs{
 constructor(exportsRoot){this.root=exportsRoot;this.stateFile=path.join(exportsRoot,'.mod-export-jobs.json');this.jobs=new Map();try{for(const job of JSON.parse(fs.readFileSync(this.stateFile,'utf8')))this.jobs.set(job.id,job.status==='running'?{...job,status:'error',error:'上次导出被中断，请重新导出'}:job);}catch{}}
 save(){atomicWrite(this.stateFile,JSON.stringify([...this.jobs.values()].slice(-20),null,2));}
 start(options){for(const job of this.jobs.values())if(job.status==='running')throw Error('已有整合包正在导出，请等待完成');const entries=modPackageEntries(options),id=crypto.randomBytes(12).toString('hex'),file='iamgri-整合包-'+stamp()+'.zip',job={id,status:'running',completed:0,total:entries.length,workspaceFile:options.editor.workFile};this.jobs.set(id,job);this.save();writeZipFiles(entries,path.join(this.root,file),p=>Object.assign(job,p)).then(result=>{Object.assign(job,{status:'complete',result:{...result,url:'/api/download?file='+encodeURIComponent(file)}});this.save();}).catch(error=>{Object.assign(job,{status:'error',error:error.message});this.save();});return {...job};}
 get(id,workspaceFile){const job=id?this.jobs.get(id):[...this.jobs.values()].reverse().find(j=>j.workspaceFile===workspaceFile);if(!job){if(!id)return {status:'none'};throw Error('导出任务不存在');}return {...job};}
}
