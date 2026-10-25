import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {once} from 'node:events';
import {crc32} from './codec.mjs';
export async function writeZipFiles(entries,dest,progress=()=>{}){
 if(entries.length>60000)throw Error('整合包文件数量超过 ZIP 上限');const names=new Set();for(const e of entries){if(!e.name||e.name.startsWith('/')||/^[a-z]:/i.test(e.name)||e.name.split('/').includes('..')||names.has(e.name.toLocaleLowerCase()))throw Error('ZIP 路径重复或无效：'+e.name);names.add(e.name.toLocaleLowerCase());}
 fs.mkdirSync(path.dirname(dest),{recursive:true});const temp=dest+'.writing',stream=fs.createWriteStream(temp),central=[];let offset=0,completed=0,failure=null;stream.on('error',error=>{failure=error;});const write=async bytes=>{if(failure)throw failure;if(!stream.write(bytes))await once(stream,'drain');};
 try{for(const entry of entries){if(entry.expectedMtime!==undefined){const stat=await fs.promises.stat(entry.file);if(stat.mtimeMs!==entry.expectedMtime||stat.size!==entry.expectedSize)throw Error('打包期间图片发生变化，请重新导出：'+entry.name);}const data=entry.data?Buffer.from(entry.data):await fs.promises.readFile(entry.file),packed=zlib.deflateRawSync(data,{level:1}),compressed=packed.length<data.length?packed:data,method=compressed===data?0:8,nb=Buffer.from(entry.name),crc=crc32(data),h=Buffer.alloc(30),c=Buffer.alloc(46);if(offset+compressed.length>0xfffffff0)throw Error('整合包超过 4 GB，请减少图片');
   h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(method,8);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(nb.length,26);
   c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(nb.length,28);c.writeUInt32LE(offset,42);central.push(c,nb);await write(h);await write(nb);await write(compressed);offset+=h.length+nb.length+compressed.length;if(++completed%50===0||completed===entries.length)progress({completed,total:entries.length,file:entry.name});
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);await write(cd);await write(end);stream.end();await once(stream,'finish');await fs.promises.rename(temp,dest);return {path:dest,files:entries.length,size:fs.statSync(dest).size};
 }catch(error){stream.destroy();try{await fs.promises.unlink(temp);}catch{}throw error;}
}
