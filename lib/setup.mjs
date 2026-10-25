import fs from 'node:fs';
import path from 'node:path';
import {gameKey,decodeEmdb} from './codec.mjs';
import {atomicWrite} from './model.mjs';

const imageFolders={Players:'photos',Staff:'staff',Teams:'teamlogos',Tournaments:'logos'};
export function steamCandidates(extra=[]){
 const roots=new Set([...extra,process.env.STEAM_PATH,process.env['ProgramFiles(x86)']&&path.join(process.env['ProgramFiles(x86)'],'Steam'),'C:/Program Files (x86)/Steam','C:/Steam','D:/Steam'].filter(Boolean).map(p=>path.resolve(p)));
 for(const root of [...roots])try{for(const m of fs.readFileSync(path.join(root,'steamapps/libraryfolders.vdf'),'utf8').matchAll(/"path"\s*"([^"]+)"/g))roots.add(path.resolve(m[1].replaceAll('\\\\','/')));}catch{}
 return [...roots];
}
export function discoverInstall(extra=[]){
 const found={gamePath:'',source:'',imageRoot:'',modRoot:'',skinRoot:''};
 for(const root of steamCandidates(extra)){
  const game=path.join(root,'steamapps/common/Esports Manager 2026');if(fs.existsSync(path.join(game,'EsportsManager_Data')))found.gamePath=game;
  const workshop=path.join(root,'steamapps/workshop/content/2749950');
  if(!fs.existsSync(workshop))continue;
  for(const id of fs.readdirSync(workshop))try{
   const folder=path.join(workshop,id),meta=JSON.parse(fs.readFileSync(path.join(folder,'workshop.json'),'utf8'));
   if(meta.kind==='Database'&&/^world\s*updated$/i.test(meta.name)){const filename=fs.readdirSync(path.join(folder,'Database')).find(f=>/\.emdb$/i.test(f));if(filename)found.source=path.join(folder,'Database',filename);}
   if(meta.kind==='Images'&&/^world\s*updated\s*images$/i.test(meta.name))found.imageRoot=folder;
  }catch{}
 }
 return found;
}
export function emskinRoot(value){
 const root=path.resolve(value);
 for(const dir of [path.join(root,'BepInEx/emskin'),path.join(root,'emskin'),root])if(path.basename(dir).toLowerCase()==='emskin'&&fs.existsSync(path.join(dir,'database')))return dir;
 throw Error('请选择包含 BepInEx/emskin/database 的模组目录，或 emskin 目录本身');
}
export function makeConfiguration(input,root){
 const resolve=(value)=>path.resolve(root,String(value||'').trim());
 if(!input.gamePath?.trim())throw Error('请选择游戏安装文件夹');
 const gamePath=resolve(input.gamePath),key=gameKey(gamePath);
 if(!input.source?.trim())throw Error('请选择 .emdb 数据库');
 const source=resolve(input.source);if(!/\.emdb$/i.test(source)||!fs.existsSync(source))throw Error('数据库文件不存在，或扩展名不是 .emdb');
 decodeEmdb(fs.readFileSync(source),key);
 const projectDir=path.join(root,'project'),imageRoot=input.imageRoot?.trim()?resolve(input.imageRoot):path.join(projectDir,'ExternalImages');
 if(input.imageRoot?.trim()&&!fs.statSync(imageRoot).isDirectory())throw Error('图片根目录必须是文件夹');
 const config={source,imageRoot,gamePath,projectDir,linkedImageRoots:[]};
 let mod=input.modRoot?.trim();if(!mod&&path.basename(path.dirname(source)).toLowerCase()==='database'&&path.basename(path.dirname(path.dirname(source))).toLowerCase()==='emskin')mod=path.dirname(path.dirname(source));
 const skin=input.skinRoot?.trim();
 if(mod){const modRoot=emskinRoot(resolve(mod)),skinRoot=skin?emskinRoot(resolve(skin)):'';config.integration={modRoot,skinRoot};config.linkedImageRoots.push({id:'mod',root:modRoot,source:'模组图片',folders:imageFolders});if(skinRoot)config.linkedImageRoots.push({id:'skin',root:skinRoot,source:'皮肤图片包',folders:imageFolders});}
 else if(skin)throw Error('使用皮肤叠加前，请先选择原模组目录');
 if(['photos','teamlogos','logos'].some(name=>fs.existsSync(path.join(imageRoot,name))))config.linkedImageRoots.push({id:'imported',root:imageRoot,source:'初始配套图片',folders:imageFolders});
 return config;
}
export function saveConfiguration(input,root){
 if(fs.existsSync(path.join(root,'settings.json')))throw Error('已有配置。请直接在编辑器中导入、切换副本；此向导只用于首次启动');
 const config=makeConfiguration(input,root);atomicWrite(path.join(root,'settings.json'),JSON.stringify(config,null,2));return config;
}
