import fs from 'node:fs';

const data=JSON.parse(fs.readFileSync(new URL('./team-image-aliases.json',import.meta.url),'utf8'));
export const normalizeTeamImageName=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const aliases=new Map();
for(const team of data.teams)for(const name of [team.nick,team.name,...team.aliases]){
 const key=normalizeTeamImageName(name);if(!key)continue;
 const existing=aliases.get(key);if(existing&&existing.nick!==team.nick)aliases.set(key,null);else if(!aliases.has(key))aliases.set(key,team);
}
export function teamImageCandidates(record){
 const result=[record.Nick,record.Name];
 for(const name of result.slice()){const entry=aliases.get(normalizeTeamImageName(name));if(entry)result.push(entry.nick,entry.name,...entry.aliases);}
 return [...new Set(result.filter(Boolean))];
}
export function normalizedTeamImages(images){
 const result=new Map();
 for(const [key,image]of images){const normalized=normalizeTeamImageName(key);if(!normalized)continue;const previous=result.get(normalized);if(previous&&previous.key!==key)result.set(normalized,null);else if(!result.has(normalized))result.set(normalized,{key,image});}
 return result;
}
export function findTeamImage(images,normalized,record){
 let best=null,match=null;
 const direct=[record.Nick,record.Name].filter(Boolean);
 for(const candidate of teamImageCandidates(record)){
  const exact=images.get(candidate.toLocaleLowerCase()),image=exact||normalized.get(normalizeTeamImageName(candidate))?.image;
  if(!image||best&&(best.priority??0)>=(image.priority??0))continue;
  best=image;match=direct.includes(candidate)?(exact?'exact':'normalized'):'alias';
 }
 return best?{...best,match,source:best.source+(match==='alias'?' · 游戏名称映射':match==='normalized'?' · 文件名格式匹配':'')}:null;
}
