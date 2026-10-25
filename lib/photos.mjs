import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

export const CUSTOM_ASSETS=path.join(os.homedir(),'AppData/LocalLow/NeuronaGames/EsportsManager/CustomAssets');
export function photoRoots(imageRoot,overlayRoot,otherPacks=true,customRoot=CUSTOM_ASSETS,gameImagesRoot=null,linkedRoots=[],preferred='') {
 const roots=[];
 if(gameImagesRoot&&fs.existsSync(gameImagesRoot))roots.push({root:gameImagesRoot,source:'游戏内置图片',kind:'game'});
 if(otherPacks){
  const workshop=path.dirname(imageRoot);
  for(const id of fs.existsSync(workshop)?fs.readdirSync(workshop).sort():[])try{
   const root=path.join(workshop,id);if(path.resolve(root)===path.resolve(imageRoot))continue;
   const meta=JSON.parse(fs.readFileSync(path.join(root,'workshop.json'),'utf8'));
   if(meta.kind==='Images')roots.push({root,source:meta.name,kind:'workshop'});
  }catch{}
 }
 // Last root wins for the same file ID. Explicit project bindings have highest priority.
 const choices=[{root:imageRoot,source:'初始配套图片',kind:'world',id:'world'},...linkedRoots.filter(r=>r&&typeof r.root==='string'&&fs.existsSync(r.root)).map(r=>({...r,kind:'linked'}))],selected=choices.find(r=>r.id===preferred);
 roots.push(...choices.filter(r=>r!==selected),{root:customRoot,source:'游戏 CustomAssets',kind:'custom'},{root:overlayRoot,source:'本项目绑定图片',kind:'project'});if(selected)roots.push({...selected,preferred:true});
 return roots;
}
export function validPhotoUrl(value) {
 try{const u=new URL(value),host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');if(u.protocol!=='https:'||u.username||u.password||u.port)return null;if(net.isIP(host))return isPublicAddress(host)?u.href:null;if(!host.includes('.')||/\.(local|localhost|internal|lan|home|test|invalid)$/.test(host))return null;return u.href;}catch{return null;}
}
function isTunnelAddress(address){return /^(198\.18\.|198\.19\.|2001:2:)/i.test(address);}
export function isPublicAddress(address) {
 if(net.isIPv4(address)){
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));
 }
 if(net.isIPv6(address)){
  const a=address.toLowerCase();
  if(a.startsWith('::ffff:')){const tail=a.slice(7);return net.isIPv4(tail)?isPublicAddress(tail):false;}
  return /^[23]/.test(a)&&!a.startsWith('2001:db8:')&&!a.startsWith('2001:2:');
 }
 return false;
}
export function imageType(bytes) {
 if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return {ext:'.png',mime:'image/png'};
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {ext:'.jpg',mime:'image/jpeg'};
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return {ext:'.webp',mime:'image/webp'};
 return null;
}
export function photoUrlCandidates(value){
 const safe=validPhotoUrl(value);if(!safe)return [];
 const result=[safe],url=new URL(safe);
 if(url.hostname==='imgs.search.brave.com')try{const encoded=url.pathname.split('/g:ce/')[1];if(encoded&&encoded.length<8192){const original=validPhotoUrl(Buffer.from(encoded.replaceAll('/',''),'base64url').toString('utf8'));if(original&&!result.includes(original))result.push(original);}}catch{}
 return result;
}
export class PhotoCache {
 constructor(root){this.root=root;fs.mkdirSync(root,{recursive:true});this.inflight=new Map();this.failed=new Map();this.files=new Map(fs.readdirSync(root).filter(f=>/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(f)).map(f=>[path.parse(f).name,path.join(root,f)]));}
 cached(url){const safe=validPhotoUrl(url);if(!safe)return null;const hash=crypto.createHash('sha256').update(safe).digest('hex'),file=this.files.get(hash);return file?{file,name:'在线图片缓存'+path.extname(file),source:'数据库 PhotoUrl（已缓存）',kind:'cache',url:safe}:null;}
 async get(url){
  const safe=validPhotoUrl(url);if(!safe)throw Error('数据库图片链接不是有效的 HTTPS 地址');
  const cached=this.cached(safe);if(cached)return cached;
  if(this.failed.get(safe)>Date.now())throw Error('图片站点暂时不可用');
  if(this.inflight.has(safe))return this.inflight.get(safe);
  const promise=(async()=>{try{
   let bytes,type,lastError;for(const candidate of photoUrlCandidates(safe))try{bytes=await this.download(candidate);type=imageType(bytes);if(!type)throw Error('图片站点未返回 PNG、JPEG 或 WebP 图片');break;}catch(error){lastError=error;}
   if(!type)throw lastError||Error('图片下载失败');
   const hash=crypto.createHash('sha256').update(safe).digest('hex'),file=path.join(this.root,hash+type.ext),temp=file+'.tmp';fs.writeFileSync(temp,bytes);fs.renameSync(temp,file);this.files.set(hash,file);
   return this.cached(safe);
  }catch(e){this.failed.set(safe,Date.now()+120_000);throw e;}finally{this.inflight.delete(safe);}})();this.inflight.set(safe,promise);return promise;
 }
 async download(value,redirects=0) {
  const safe=validPhotoUrl(value);if(!safe||redirects>3)throw Error('图片链接或跳转无效');const url=new URL(safe);
  const addresses=await dns.lookup(url.hostname,{all:true});
  // This computer's tunnel DNS assigns synthetic addresses to public hostnames.
  // Permit those transport addresses only for domain URLs; TLS still verifies the original hostname.
  const domain=!net.isIP(url.hostname),allowed=addresses.filter(x=>isPublicAddress(x.address)||domain&&isTunnelAddress(x.address));
  if(!allowed.length||addresses.some(x=>!isPublicAddress(x.address)&&!(domain&&isTunnelAddress(x.address))))throw Error('图片链接必须指向公网图片站点');
  return new Promise((resolve,reject)=>{
   const req=https.get(url,{headers:{'User-Agent':'Mozilla/5.0 EsportsManager2026Editor/1.3.1','Accept':'image/png,image/jpeg,image/webp'},lookup:(_host,opt,cb)=>opt.all?cb(null,allowed):cb(null,allowed[0].address,allowed[0].family)},res=>{
    if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();this.download(new URL(res.headers.location,url).href,redirects+1).then(resolve,reject);return;}
    if(res.statusCode!==200){res.resume();reject(Error(`图片站点返回 ${res.statusCode}`));return;}
    const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>12_000_000){req.destroy(Error('图片超过 12 MB'));return;}chunks.push(chunk);});res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);
   });req.setTimeout(8000,()=>req.destroy(Error('图片站点响应超时')));req.on('error',reject);
  });
 }
}
