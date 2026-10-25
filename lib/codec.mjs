import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const crcTable = Array.from({length:256}, (_,i) => { let c=i; for(let j=0;j<8;j++) c=c&1?0xedb88320^(c>>>1):c>>>1; return c>>>0; });
export function crc32(b) { let c=0xffffffff; for(const v of b)c=crcTable[(c^v)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
export function gameKey(gamePath) {
  try {
    const m=fs.readFileSync(`${gamePath}/EsportsManager_Data/il2cpp_data/Metadata/global-metadata.dat`);
    // Unity 6 metadata v107 uses offsets into a concatenated UTF-8 literal pool.
    if(m.readUInt32LE(4)===107) {
      const off=m.readUInt32LE(8), n=m.readUInt32LE(16), base=m.readUInt32LE(20);
      for(let i=0;i<n-1;i++) {
        const a=m.readUInt32LE(off+i*4), b=m.readUInt32LE(off+i*4+4);
        if(b-a!==64)continue;
        const s=m.subarray(base+a,base+b).toString();
        if(/^[A-F0-9]{64}$/.test(s))return Buffer.from(s,'hex');
      }
    }
  } catch {}
  throw Error('无法读取游戏数据库格式信息，请选择包含 EsportsManager_Data 的游戏安装目录（当前支持 metadata v107）');
}
export function unzip(buffer) {
  let e=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){e=i;break;}
  if(e<0)throw Error('EMDB 内的 ZIP 目录损坏');
  let pos=buffer.readUInt32LE(e+16),total=0; const count=buffer.readUInt16LE(e+10), entries=[];
  if(count>50000)throw Error('ZIP 文件数量过多');
  for(let i=0;i<count;i++) {
    if(buffer.readUInt32LE(pos)!==0x02014b50)throw Error('ZIP 文件头无效');
    const flags=buffer.readUInt16LE(pos+8), method=buffer.readUInt16LE(pos+10), crc=buffer.readUInt32LE(pos+16);
    const size=buffer.readUInt32LE(pos+20), length=buffer.readUInt32LE(pos+24), nl=buffer.readUInt16LE(pos+28), xl=buffer.readUInt16LE(pos+30), cl=buffer.readUInt16LE(pos+32), loc=buffer.readUInt32LE(pos+42);
    total+=length;if(flags&1 || length>100_000_000||total>700_000_000)throw Error('ZIP 内容过大或不受支持');
    const name=buffer.subarray(pos+46,pos+46+nl).toString('utf8');
    if(buffer.readUInt32LE(loc)!==0x04034b50)throw Error('ZIP 本地文件头无效');
    const start=loc+30+buffer.readUInt16LE(loc+26)+buffer.readUInt16LE(loc+28), compressed=buffer.subarray(start,start+size);
    const data=method===0?Buffer.from(compressed):method===8?zlib.inflateRawSync(compressed,{maxOutputLength:100_000_000}):null;
    if(!data || data.length!==length || crc32(data)!==crc)throw Error(`ZIP 校验失败：${name}`);
    entries.push({name,data}); pos+=46+nl+xl+cl;
  }
  return entries;
}
export function zip(entries) {
  const local=[],central=[];let offset=0;
  for(const {name,data} of entries) {
    const nb=Buffer.from(name), packed=zlib.deflateRawSync(data), crc=crc32(data), h=Buffer.alloc(30), c=Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(0x21,12);
    h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(nb.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(0x21,14);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(nb.length,28);c.writeUInt32LE(offset,42);
    local.push(h,nb,packed);central.push(c,nb);offset+=h.length+nb.length+packed.length;
  }
  const cd=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}
export function decodeEmdb(bytes,key) {
  if(bytes.length<34 || bytes.subarray(0,4).toString()!=='EMDB')throw Error('这不是有效的 .emdb 数据库');
  const version=bytes[4];if(![2,3].includes(version))throw Error(`暂不支持 EMDB 版本 ${version}`);
  try {
    const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(5,17));d.setAuthTag(bytes.subarray(-16));
    const payload=Buffer.concat([d.update(bytes.subarray(17,-16)),d.final()]);
    return {version,entries:unzip(payload),original:Buffer.from(bytes)};
  } catch(e) { throw Error(`数据库解码失败：${e.message}`); }
}
export function encodeEmdb(entries,key,version=3) {
  const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv), data=Buffer.concat([c.update(zip(entries)),c.final()]);
  return Buffer.concat([Buffer.from('EMDB'),Buffer.from([version]),iv,data,c.getAuthTag()]);
}
export function parseCsv(text,delimiter=';',{allowShortRows=false,ignoreComments=false}={}) {
  const bom=text.startsWith('\ufeff'), newline=text.includes('\r\n')?'\r\n':'\n';
  if(bom)text=text.slice(1);
  const records=[];let row=[],value='',quoted=false,atStart=true;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else quoted=false;}else value+=c; }
    else if(c==='"'&&atStart){quoted=true;atStart=false;}
    else if(c===delimiter){row.push(value);value='';atStart=true;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(x=>x!==''))records.push(row);row=[];value='';atStart=true;}
    else {value+=c;atStart=false;}
  }
  if(quoted)throw Error('CSV 引号未闭合');
  if(value!==''||row.length){row.push(value);records.push(row);}
  if(ignoreComments)for(let i=records.length-1;i>=0;i--)if(records[i][0].trimStart().startsWith('#'))records.splice(i,1);
  const headers=records.shift()||[];
  if(!headers.length || new Set(headers).size!==headers.length)throw Error('CSV 表头无效或重复');
  for(let i=0;i<records.length;i++){if(allowShortRows&&records[i].length<headers.length)while(records[i].length<headers.length)records[i].push('');if(records[i].length!==headers.length)throw Error(`CSV 第 ${i+2} 行有 ${records[i].length} 列，预期 ${headers.length} 列`);}
  return {headers,rows:records.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]]))),bom,newline,finalNewline:/[\r\n]$/.test(text)};
}
export function writeCsv(table) {
  const cell=v=>/[;"\r\n]/.test(String(v??''))?'"'+String(v??'').replaceAll('"','""')+'"':String(v??'');
  return (table.bom?'\ufeff':'')+[table.headers.map(cell).join(';'),...table.rows.map(r=>table.headers.map(h=>cell(r[h])).join(';'))].join(table.newline||'\n')+(table.finalNewline?(table.newline||'\n'):'');
}
