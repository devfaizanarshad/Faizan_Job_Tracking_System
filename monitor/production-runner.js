import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { productionLog } from './structured-log.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const passthrough=process.argv.slice(2);
const started=Date.now();
productionLog('scheduler.execution.start',{arguments:passthrough});
const child=spawn(process.execPath,[path.join(here,'automate-run.js'),...passthrough],{cwd:here,env:process.env,windowsHide:true});
let stdout='',stderr='';
child.stdout.on('data',d=>stdout+=d);
child.stderr.on('data',d=>stderr+=d);
child.on('error',error=>{productionLog('scheduler.execution.failure',{error_class:error.name,error_message:error.message},'error');process.exitCode=1;});
child.on('close',code=>{
  let result=null;try{result=JSON.parse(stdout.trim());}catch{}
  productionLog('scheduler.execution.complete',{exit_code:code,duration_ms:Date.now()-started,status:result?.status||result?.monitor?.status||'UNKNOWN',run_id:result?.runId,alerts:result?.alerts?.generated,stderr:stderr.slice(-1000)},code===0?'info':'error');
  if(stdout)process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);process.exitCode=code||0;
});
