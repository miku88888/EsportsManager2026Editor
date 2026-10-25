import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {writeZipFiles} from '../lib/archive.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const allow=['lib','public','scripts','test','.github','.gitignore','server.mjs','package.json','README.md','LICENSE','CHANGELOG.md','THIRD_PARTY_NOTICES.md','settings.example.json','Start.ps1','Setup.ps1','启动编辑器.cmd','启动编辑器.vbs','停止编辑器.ps1','停止编辑器.vbs'];
export function releaseEntries(base=root){
 const entries=[];
 function add(relative){const file=path.join(base,relative),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('发行文件不允许符号链接：'+relative);if(stat.isDirectory()){for(const name of fs.readdirSync(file).sort())add(relative+'/'+name);}else{
  if(/\.(emdb|dll|png|jpg|jpeg|webp|log|zip)$/i.test(relative)||/(^|\/)(settings\.json|running\.json|\.env[^/]*|project|exports|node_modules)(\/|$)/i.test(relative))throw Error('发行清单包含运行数据：'+relative);
  const text=fs.readFileSync(file,'utf8');if(/github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|[A-Z]:[\\/]Users[\\/](?!Public\b)[^\\/\s]+[\\/]/.test(text))throw Error('发行文件包含凭据或个人路径：'+relative);
  entries.push({name:'EsportsManager2026Editor/'+relative.replaceAll('\\','/'),file});
 }}
 for(const name of allow)if(fs.existsSync(path.join(base,name)))add(name);return entries;
}
export async function build(){
 const out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});const source=releaseEntries(),files=[];
 async function write(kind,entries){const file='EsportsManager2026Editor-v'+version+'-'+kind+'.zip',dest=path.join(out,file);const result=await writeZipFiles(entries,dest);files.push(file);console.log(JSON.stringify({file,bytes:result.bytes,files:result.files}));}
 await write('source',source);
 if(fs.existsSync(path.join(root,'runtime/node.exe'))){if(!fs.existsSync(path.join(root,'runtime/LICENSE.txt'))||fs.statSync(path.join(root,'runtime/LICENSE.txt')).size<1000)throw Error('打包运行环境前必须提供完整 runtime/LICENSE.txt');await write('windows-x64',[...source,...['node.exe','LICENSE.txt'].map(name=>({name:'EsportsManager2026Editor/runtime/'+name,file:path.join(root,'runtime',name)}))]);}
 fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),files.map(file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')+'  '+file).join('\n')+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
