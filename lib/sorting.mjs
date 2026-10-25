import {NUMERIC_FIELDS} from './schema.mjs';

export function sortRecords(rows,field,direction=field==='CreatedAt'?'desc':'asc',sourceRows=rows) {
 const dir=direction==='desc'?-1:1;
 if(field==='CreatedAt') {
  // CSV row order preserves insertion order across saves and restarts.
  const positions=new Map(sourceRows.map((row,index)=>[row,index]));
  const dates=new Map(rows.map(row=>[row,Date.parse(row.CreatedAt||'')]));
  return rows.sort((a,b)=>{
   const left=dates.get(a),right=dates.get(b),hasLeft=Number.isFinite(left),hasRight=Number.isFinite(right);
   if(hasLeft!==hasRight)return hasLeft?-1:1;
   return dir*((hasLeft?left-right:0)||(positions.get(a)-positions.get(b)));
  });
 }
 return rows.sort((a,b)=>NUMERIC_FIELDS.has(field)?dir*((Number(a[field])||0)-(Number(b[field])||0)):dir*a[field].localeCompare(b[field],undefined,{numeric:true,sensitivity:'base'}));
}
