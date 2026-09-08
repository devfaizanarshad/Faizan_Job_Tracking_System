import fs from 'node:fs';
import path from 'node:path';
import { runtimePaths } from './runtime-paths.js';

const sensitive=/password|passwd|secret|token|credential|authorization|cookie/i;
export function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':redact(v)]));
  return value;
}
export function productionLog(event,fields={},level='info'){
  const record={timestamp:new Date().toISOString(),level,event,...redact(fields)};
  try{
    fs.mkdirSync(runtimePaths.logDir,{recursive:true,mode:0o750});
    fs.appendFileSync(path.join(runtimePaths.logDir,'production.jsonl'),`${JSON.stringify(record)}\n`,{encoding:'utf8',mode:0o640});
  }catch(error){
    process.stderr.write(`${JSON.stringify({timestamp:record.timestamp,level:'error',event:'logging.failure',error:error.message})}\n`);
  }
  if(/^true$/i.test(process.env.FAIZAN_LOG_STDOUT||''))process.stdout.write(`${JSON.stringify(record)}\n`);
  return record;
}
