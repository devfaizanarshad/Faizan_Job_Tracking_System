import fs from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';
import { productionLog } from './structured-log.js';
import { databaseConfig } from './database-config.js';

const {Pool}=pg;
const hoursSince=(v,now=new Date())=>v?(now-new Date(v))/3600000:Infinity;
async function directoryBytes(root){
  let total=0;try{for(const e of await fs.readdir(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isDirectory())total+=await directoryBytes(p);else total+=(await fs.stat(p)).size;}}catch(error){if(error.code!=='ENOENT')throw error;}return total;
}
export function classifyHealth(facts,limits={sHours:12,aHours:18,backupHours:36,restoreHours:192}){
  const checks=[];const add=(name,state,value)=>checks.push({name,state,value:Number.isFinite(value)?Math.round(value*100)/100:value===Infinity?'NO_SUCCESSFUL_RECORD':value});
  if(!facts.databaseReachable)add('postgresql','UNHEALTHY','unreachable');
  else add('postgresql','HEALTHY','reachable');
  add('s_scheduler',facts.sAgeHours>limits.sHours*2?'UNHEALTHY':facts.sAgeHours>limits.sHours?'DEGRADED':'HEALTHY',facts.sAgeHours);
  add('a_scheduler',facts.aAgeHours>limits.aHours*2?'UNHEALTHY':facts.aAgeHours>limits.aHours?'DEGRADED':'HEALTHY',facts.aAgeHours);
  add('backup_freshness',facts.backupAgeHours>limits.backupHours*2?'UNHEALTHY':facts.backupAgeHours>limits.backupHours?'DEGRADED':'HEALTHY',facts.backupAgeHours);
  add('restore_verification',facts.restoreAgeHours>limits.restoreHours*2?'UNHEALTHY':facts.restoreAgeHours>limits.restoreHours?'DEGRADED':'HEALTHY',facts.restoreAgeHours);
  add('source_failures',facts.repeatedFailures>=10?'UNHEALTHY':facts.repeatedFailures>0?'DEGRADED':'HEALTHY',facts.repeatedFailures);
  add('disk',facts.diskPercent>=90?'UNHEALTHY':facts.diskPercent>=80?'DEGRADED':'HEALTHY',facts.diskPercent);
  add('alert_engine',facts.alertOperational?'HEALTHY':'UNHEALTHY',facts.alertOperational);
  add('digest',facts.digestAgeHours>48?'DEGRADED':'HEALTHY',facts.digestAgeHours);
  const status=checks.some(x=>x.state==='UNHEALTHY')?'UNHEALTHY':checks.some(x=>x.state==='DEGRADED')?'DEGRADED':'HEALTHY';
  return {status,checks};
}

export async function collectHealth(now=new Date()){
  const pool=new Pool(databaseConfig({defaultUser:'faizan_monitor',connectionTimeoutMillis:Number(process.env.PGCONNECT_TIMEOUT_MS||5000),max:1}));
  const resources={memory_total_bytes:os.totalmem(),memory_free_bytes:os.freemem(),process_rss_bytes:process.memoryUsage().rss};
  try{
    const disk=await fs.statfs(runtimePaths.appRoot);resources.disk_total_bytes=Number(disk.blocks*disk.bsize);resources.disk_free_bytes=Number(disk.bavail*disk.bsize);
  }catch{resources.disk_total_bytes=0;resources.disk_free_bytes=0;}
  for(const [name,dir] of Object.entries({logs:runtimePaths.logDir,reports:runtimePaths.reportDir,backups:runtimePaths.backupDir,exports:runtimePaths.exportDir}))resources[`${name}_bytes`]=await directoryBytes(dir);
  let client;
  try{
    client=await pool.connect();
    const one=async(sql)=>(await client.query(sql)).rows[0];
    const s=await one("SELECT max(finished_at) last FROM monitoring_runs WHERE status='SUCCEEDED' AND requested_tiers @> ARRAY['S']::text[]");
    const a=await one("SELECT max(finished_at) last FROM monitoring_runs WHERE status='SUCCEEDED' AND requested_tiers @> ARRAY['A']::text[]");
    const sources=await one('SELECT count(*)::int enabled,count(*) FILTER(WHERE consecutive_errors>=3)::int repeated FROM monitored_sources WHERE enabled');
    const digest=await one('SELECT max(generated_at) last FROM daily_digest_runs');
    const backup=await one("SELECT max(completed_at) FILTER(WHERE status='SUCCEEDED') last,max(completed_at) FILTER(WHERE status='SUCCEEDED' AND restore_verified) restored FROM production_backup_runs");
    const db=await one('SELECT pg_database_size(current_database())::bigint bytes');
    const alert=await one("SELECT to_regclass('public.alert_decisions') IS NOT NULL AND to_regclass('public.source_health_events') IS NOT NULL operational");
    const diskPercent=resources.disk_total_bytes?100*(resources.disk_total_bytes-resources.disk_free_bytes)/resources.disk_total_bytes:0;
    const facts={databaseReachable:true,sAgeHours:hoursSince(s.last,now),aAgeHours:hoursSince(a.last,now),backupAgeHours:hoursSince(backup.last,now),restoreAgeHours:hoursSince(backup.restored,now),repeatedFailures:sources.repeated,diskPercent,alertOperational:alert.operational,digestAgeHours:hoursSince(digest.last,now)};
    const result=classifyHealth(facts,{sHours:Number(process.env.HEALTH_S_MAX_HOURS||12),aHours:Number(process.env.HEALTH_A_MAX_HOURS||18),backupHours:Number(process.env.HEALTH_BACKUP_MAX_HOURS||36),restoreHours:Number(process.env.HEALTH_RESTORE_MAX_HOURS||192)});
    return {...result,checked_at:now.toISOString(),scheduler_alive:Math.max(facts.sAgeHours,facts.aAgeHours)<=36,last_successful_s_run:s.last,last_successful_a_run:a.last,postgresql_reachable:true,enabled_sources:sources.enabled,repeated_source_failures:sources.repeated,last_digest_generated:digest.last,last_successful_backup:backup.last,last_restore_verification:backup.restored,alert_engine_operational:alert.operational,database_bytes:Number(db.bytes),resources};
  }catch(error){return {status:'UNHEALTHY',checked_at:now.toISOString(),postgresql_reachable:false,error_class:error.name,error_message:String(error.message).slice(0,300),resources};}
  finally{client?.release();await pool.end();}
}

async function cli(){const result=await collectHealth();productionLog('health.check',{status:result.status,postgresql_reachable:result.postgresql_reachable});console.log(JSON.stringify(result,null,2));if(!process.argv.includes('--systemd'))process.exitCode=result.status==='HEALTHY'?0:result.status==='DEGRADED'?1:2;}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))cli().catch(error=>{productionLog('health.failure',{error_class:error.name,error_message:error.message},'error');console.error(error);process.exitCode=2;});
