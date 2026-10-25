// Shared by the form preview and the saved batch operation.
const number=value=>{const text=String(value??'').trim();return /^[-+]?\d+(?:\.\d+)?$/.test(text)&&Number.isFinite(Number(text))?Number(text):null;};
export function automaticChanges(fields,mode,{numericFields=[],random=Math.random}={}){
 if(!['random','min'].includes(mode))throw Error('自动选值方式无效');
 const numeric=new Set(numericFields),changes={};
 for(const field of fields){
  if(mode==='random')changes[field.field]=random()<0.5?field.left:field.right;
  else if(numeric.has(field.field)){const a=number(field.left),b=number(field.right);if(a!==null&&b!==null)changes[field.field]=a<=b?field.left:field.right;}
 }
 return {changes,chosenFields:Object.keys(changes).length,retainedFields:fields.length-Object.keys(changes).length};
}
