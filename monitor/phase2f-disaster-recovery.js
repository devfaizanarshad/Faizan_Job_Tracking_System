import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';

const tool=name=>path.join(process.env.PG_BIN_DIR||'',process.platform==='win32'?`${name}.exe`:name);
const run=(command,args,env=process.env)=>{const r=spawnSync(command,args,{cwd:path.join(runtimePaths.appRoot,'monitor'),env,encoding:'utf8',timeout:180000});if(r.error||r.status!==0)throw new Error(`${path.basename(command)} failed (${r.status}): ${String(r.error?.message||r.stderr||r.stdout).slice(-2000)}`);return r.stdout.trim();};
const db=`faizan_phase2f_dr_${process.pid}_${Date.now()}`.toLowerCase();
const base=['-h',process.env.PGHOST||'localhost','-p',String(process.env.PGPORT||5432),'-U',process.env.PGUSER||'postgres'];
const backup=path.join(runtimePaths.appRoot,'exports','faizan_employer_intelligence_phase2e_2026-09-04.backup');
const outDir=path.join(runtimePaths.tempDir,'phase2f-dr');await fs.mkdir(outDir,{recursive:true});
const evidence={database:db,source_backup:backup,source_database_modified:false,steps:[],started_at:new Date().toISOString()};
let created=false;
try{
  if(run(tool('psql'),[...base,'-d','postgres','-tAc',`SELECT 1 FROM pg_database WHERE datname='${db}'`]))throw new Error('Generated DR database already exists; refusing to overwrite it');
  run(tool('createdb'),[...base,db]);created=true;evidence.steps.push('temporary database created');
  run(tool('pg_restore'),[...base,'-d',db,'--exit-on-error','--no-owner','--no-privileges',backup]);evidence.steps.push('Phase 2E custom archive restored');
  const env={...process.env,PGDATABASE:db,PGADMINHOST:process.env.PGHOST||'localhost',PGADMINUSER:process.env.PGUSER||'postgres',PGADMINPASSWORD:process.env.PGPASSWORD,FAIZAN_APP_ROOT:runtimePaths.appRoot,FAIZAN_LOG_DIR:path.join(outDir,'logs'),FAIZAN_REPORT_DIR:path.join(outDir,'reports'),FAIZAN_BACKUP_DIR:path.join(outDir,'backups'),FAIZAN_EXPORT_DIR:path.join(outDir,'exports'),FAIZAN_TEMP_DIR:path.join(outDir,'tmp'),MONITOR_SOURCE_LIMIT:'1'};
  run(process.execPath,[path.join(runtimePaths.appRoot,'monitor','migrate-production.js')],env);evidence.steps.push('production migrations applied');
  evidence.monitor_output=JSON.parse(run(process.execPath,['run-monitor.js','--tiers=S','--mode=TEST','--force'],env));evidence.steps.push('one-source safe TEST monitoring completed');
  run(process.execPath,['ranking-engine.js'],env);evidence.steps.push('ranking refresh completed');
  run(process.execPath,['historical-intelligence-engine.js'],env);evidence.steps.push('historical refresh completed');
  run(process.execPath,['phase2c-engine.js','--digest-only'],env);evidence.steps.push('digest generated');
  const client=new pg.Client({host:env.PGHOST||'localhost',port:Number(env.PGPORT||5432),database:db,user:env.PGUSER||'postgres',password:env.PGPASSWORD});await client.connect();
  try{evidence.invariants=(await client.query(`SELECT (SELECT count(*) FROM opportunity_lifecycles)::int lifecycles,(SELECT count(*) FROM opportunities o WHERE EXISTS(SELECT 1 FROM opportunity_sources s WHERE s.opportunity_id=o.opportunity_id))::int canonical,(SELECT count(*) FROM opportunity_rankings)::int rankings,(SELECT count(*) FROM employer_historical_metrics)::int employers,(SELECT count(*) FROM daily_digest_runs)::int digests,(SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN('v_employer_hiring_history','v_employer_activity','v_employer_faizan_fit_history','v_employer_watch_priority','v_role_family_trends','v_technology_demand','v_language_intelligence','v_vacancy_lifetime','v_market_snapshot_latest','v_insufficient_history'))::int phase2e_views`)).rows[0];}finally{await client.end();}
  if(evidence.invariants.lifecycles<74||evidence.invariants.canonical<74||evidence.invariants.rankings<74||evidence.invariants.phase2e_views!==10)throw new Error(`DR invariants failed: ${JSON.stringify(evidence.invariants)}`);
  evidence.status='PASS';evidence.completed_at=new Date().toISOString();
}catch(error){evidence.status='FAIL';evidence.error=String(error.stack||error);process.exitCode=1;}
finally{if(created){try{run(tool('dropdb'),[...base,'--if-exists',db]);evidence.temporary_database_removed=true;}catch(error){evidence.temporary_database_removed=false;evidence.cleanup_error=error.message;process.exitCode=1;}}}
const reportPath=path.join(runtimePaths.appRoot,'reports','phase2f_disaster_recovery_2026-09-04.json');await fs.writeFile(reportPath,JSON.stringify(evidence,null,2),'utf8');console.log(JSON.stringify({...evidence,reportPath},null,2));
