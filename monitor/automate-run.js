import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPool, generateDailyDigest, processRunAlerts, processRunHealth } from './phase2c-engine.js';
import { calculateRankings } from './ranking-engine.js';
import { refreshHistoricalIntelligence } from './historical-intelligence-engine.js';

const AUTOMATION_LOCK_KEY = 24020302;
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = name => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const tiers = (arg('tiers') || 'S').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const trigger = (arg('trigger') || 'SCHEDULED').toUpperCase();
const mode = (arg('mode') || (trigger === 'TEST' ? 'TEST' : trigger === 'MANUAL' ? 'MANUAL' : 'SCHEDULED')).toUpperCase();
const scheduledStart = arg('scheduled-start') || new Date().toISOString();
const force = process.argv.includes('--force');

function runMonitor() {
  const args = [path.join(here,'run-monitor.js'),`--tiers=${tiers.join(',')}`,`--mode=${mode}`];
  if (force) args.push('--force');
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,args,{cwd:here,env:{...process.env,MONITOR_REQUEST_GAP_MS:process.env.MONITOR_REQUEST_GAP_MS || '750'},windowsHide:true});
    let stdout=''; let stderr='';
    child.stdout.on('data',d=>{stdout+=d;process.stdout.write(d);});
    child.stderr.on('data',d=>{stderr+=d;process.stderr.write(d);});
    child.on('error',reject);
    child.on('close',code=>{
      if(code!==0) return reject(new Error(`Monitor exited ${code}: ${stderr.slice(-2000)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`Could not parse monitor result: ${stdout.slice(-2000)}`)); }
    });
  });
}

const pool=createPool();
const client=await pool.connect();
let executionId; let lockAcquired=false;
try {
  ({rows:[{automation_execution_id:executionId}]}=await client.query(`INSERT INTO automation_executions
    (scheduled_start,requested_tiers,trigger_type,status) VALUES($1,$2,$3,'SCHEDULED') RETURNING automation_execution_id`,
    [scheduledStart,tiers,trigger]));
  const lock=await client.query('SELECT pg_try_advisory_lock($1) acquired',[AUTOMATION_LOCK_KEY]);
  lockAcquired=lock.rows[0].acquired;
  if(!lockAcquired){
    await client.query(`UPDATE automation_executions SET actual_start=now(),completed_at=now(),duration_ms=0,
      status='SKIPPED_OVERLAP',notes='Another automation execution holds the advisory lock' WHERE automation_execution_id=$1`,[executionId]);
    console.log(JSON.stringify({executionId,status:'SKIPPED_OVERLAP'},null,2));
  } else {
    await client.query(`UPDATE automation_executions SET actual_start=now(),status='RUNNING' WHERE automation_execution_id=$1`,[executionId]);
    const result=await runMonitor();
    if(result.skipped) throw new Error(result.reason);
    const runId=Number(result.runId);
    const alerts=await processRunAlerts(client,runId,{deliver:true});
    const health=await processRunHealth(client,runId);
    const rankings=await calculateRankings(client);
    const history=await refreshHistoricalIntelligence(client);
    const digest=await generateDailyDigest(client);
    const finalStatus=result.status==='SUCCEEDED'?'SUCCEEDED':result.status==='PARTIAL'?'PARTIAL':'FAILED';
    await client.query(`UPDATE automation_executions SET completed_at=now(),
      duration_ms=round(extract(epoch FROM(now()-actual_start))*1000),status=$2,monitoring_run_ids=ARRAY[$3]::bigint[],
      sources_attempted=$4,sources_succeeded=$5,sources_failed=$6,opportunities_observed=$7,events_generated=$8,
      alerts_generated=$9,alerts_delivered=$10,notes=$11 WHERE automation_execution_id=$1`,
      [executionId,finalStatus,runId,result.attempted,result.succeeded,result.errors,result.observed,result.events,
        alerts.generated,alerts.delivered,`Health events: ${health.generated}; rankings: ${rankings.output.CURRENT.length}; historical employers: ${history.employers}; digest: ${digest.outputPath}`]);
    console.log(JSON.stringify({executionId,runId,status:finalStatus,monitor:result,alerts,health,history,digest:{...digest,content:undefined}},null,2));
  }
} catch(error) {
  if(executionId) await client.query(`UPDATE automation_executions SET completed_at=now(),
    duration_ms=CASE WHEN actual_start IS NULL THEN 0 ELSE round(extract(epoch FROM(now()-actual_start))*1000) END,
    status='FAILED',notes=$2 WHERE automation_execution_id=$1`,[executionId,String(error.stack||error).slice(0,4000)]);
  throw error;
} finally {
  if(lockAcquired) await client.query('SELECT pg_advisory_unlock($1)',[AUTOMATION_LOCK_KEY]);
  client.release(); await pool.end();
}
