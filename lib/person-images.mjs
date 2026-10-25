import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync(new URL('./person-image-aliases.json',import.meta.url),'utf8')),fold=value=>String(value??'').normalize('NFKC').toLocaleLowerCase(),indices={};
for(const [table,rows]of Object.entries(data.tables)){
 const index=new Map();for(const row of rows)for(const name of [row.id,row.nick,...row.aliases]){const key=fold(name),old=index.get(key);if(!key)continue;if(old&&old.id!==row.id)index.set(key,null);else if(!index.has(key))index.set(key,row);}indices[table]=index;
}
export function personImageCandidates(table,record){
 const index=indices[table],entry=index?.get(fold(record.Id))||index?.get(fold(record.Nick));
 return [...new Set([record.Id,record.Nick,...(entry?[entry.id,entry.nick,...entry.aliases]:[]),record.Name].filter(Boolean))];
}
export function findPersonImage(table,images,record){
 const direct=[record.Id,record.Nick].filter(Boolean),candidates=personImageCandidates(table,record);let best=null,alias=false,bestTier=-1;
 for(const candidate of candidates){if(candidate===record.Name&&!direct.includes(candidate))continue;const image=images.get(fold(candidate));if(!image)continue;const isDirect=direct.includes(candidate),tier=image.manual||image.kind==='custom'?4:image.custom||image.preferred||image.kind==='project'?3:isDirect&&image.kind!=='game'?2:1;if(tier<bestTier||tier===bestTier&&best&&(best.priority??0)>=(image.priority??0))continue;best=image;alias=!isDirect;bestTier=tier;}
 if(!best&&record.Name)best=images.get(fold(record.Name));
 return best?{...best,match:alias?'alias':'exact',source:best.source+(alias?' · 游戏名称映射':'')}:null;
}
