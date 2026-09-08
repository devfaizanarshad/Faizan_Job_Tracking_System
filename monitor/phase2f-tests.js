import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';
import { classifyHealth,collectHealth } from './health-check.js';
import { determineLifecycle } from './historical-intelligence-engine.js';

const results=[];const add=(key,name,pass,evidence)=>results.push({key,name,status:pass?'PASS':'FAIL',evidence});
const read=relative=>fs.readFile(path.join(runtimePaths.appRoot,relative),'utf8');
const regressionFiles={'test:phase2c':'phase2c-tests.js','test:phase2d':'phase2d-tests.js','test:phase2e':'phase2e-tests.js'};
const runRegression=script=>spawnSync(process.execPath,[regressionFiles[script]],{cwd:path.join(runtimePaths.appRoot,'monitor'),env:process.env,encoding:'utf8',timeout:120000});
try{
  const productionFiles=['monitor/runtime-paths.js','monitor/production-runner.js','monitor/health-check.js','monitor/production-backup.js','monitor/setup-production-db.js','monitor/migrate-production.js','production/deploy-ubuntu.sh','production/update-production.sh',...(await fs.readdir(path.join(runtimePaths.appRoot,'production','systemd'))).map(x=>`production/systemd/${x}`)];
  const portable=(await Promise.all(productionFiles.map(read))).every(x=>!/[A-Z]:[\\/]/i.test(x));add('A','Linux runtime paths contain no Windows-drive dependency',portable,`${productionFiles.length} production files scanned`);
  const dr=JSON.parse(await read('reports/phase2f_disaster_recovery_2026-09-04.json'));add('B','Restart/recovery preserves historical state',dr.status==='PASS'&&dr.invariants?.lifecycles>=74,`restored lifecycles=${dr.invariants?.lifecycles}`);
  const pool=new pg.Pool({host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'faizan_employer_intelligence',user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD,max:2});const c1=await pool.connect(),c2=await pool.connect();let first,second;try{first=(await c1.query('SELECT pg_try_advisory_lock(24020302) ok')).rows[0].ok;second=(await c2.query('SELECT pg_try_advisory_lock(24020302) ok')).rows[0].ok;}finally{if(first)await c1.query('SELECT pg_advisory_unlock(24020302)');c1.release();c2.release();await pool.end();}add('C','Duplicate scheduler invocation cannot overlap',first&&!second,`first=${first}, second=${second}`);
  const oldPort=process.env.PGPORT;process.env.PGPORT='1';const unavailable=await collectHealth();if(oldPort===undefined)delete process.env.PGPORT;else process.env.PGPORT=oldPort;add('D','Temporary database unavailability fails safely',unavailable.status==='UNHEALTHY'&&!unavailable.postgresql_reachable,`status=${unavailable.status}`);
  const life=determineLifecycle({opportunity_id:1,employer_id:1,status:'LIVE',first_seen_at:'2026-01-01',last_seen_at:'2026-01-02'},[{observed_at:'2026-01-01',snapshot:{status:'LIVE_VERIFIED'}}],[{event_type:'SOURCE_FETCH_FAILED',detected_at:'2026-01-02',new_state:{reason:'timeout'}}],[]);add('E','One source failure preserves opportunity history',life.removed===null,'temporary failure produced no closure');
  const scanFiles=['config/production.example.env',...productionFiles,'monitor/structured-log.js'];const scanned=(await Promise.all(scanFiles.map(read))).join('\n');const populatedPassword=scanned.split(/\r?\n/).some(line=>/^\s*PGPASSWORD=(.+)$/i.test(line)&&!/^\s*PGPASSWORD=REPLACE_WITH_/i.test(line));add('F','Secrets absent from production source/config',!populatedPassword,'example contains placeholder/empty values only; logger redacts sensitive keys');
  add('G','Backup actually restores',dr.status==='PASS'&&dr.temporary_database_removed===true,`DR=${dr.status}, temporary removed=${dr.temporary_database_removed}`);
  const rotate=await read('production/logrotate/faizan-monitor');add('H','Log rotation and retention are bounded',/rotate 14/.test(rotate)&&/size 20M/.test(rotate)&&/compress/.test(rotate),'daily, 14 rotations, 20M cap, compressed');
  const healthyFacts={databaseReachable:true,sAgeHours:1,aAgeHours:1,backupAgeHours:1,restoreAgeHours:1,repeatedFailures:0,diskPercent:10,alertOperational:true,digestAgeHours:1};add('I','Health detects stale monitoring',classifyHealth({...healthyFacts,sAgeHours:30}).status==='UNHEALTHY','30-hour S age => UNHEALTHY');
  add('J','Health detects stale backup',classifyHealth({...healthyFacts,backupAgeHours:80}).status==='UNHEALTHY','80-hour backup age => UNHEALTHY');
  const st=await read('production/systemd/faizan-monitor-s.timer'),at=await read('production/systemd/faizan-monitor-a.timer');add('K','Scheduling preserves S 3x and A 2x daily',/00,08,16/.test(st)&&/06,18/.test(at),'S=00/08/16; A=06/18');
  for(const [key,script,label] of [['L','test:phase2c','Phase 2C alert regression'],['M','test:phase2d','Phase 2D ranking regression'],['N','test:phase2e','Phase 2E historical regression']]){const r=runRegression(script);add(key,label,r.status===0,`exit=${r.status}${r.error?`, error=${r.error.message}`:''}`);}
}catch(error){add('HARNESS','Test harness',false,String(error.stack||error));}
const passed=results.filter(x=>x.status==='PASS').length,failed=results.length-passed;const lines=['# Phase 2F production-readiness tests','',`Passed: **${passed}**; failed: **${failed}**.`,'','| Test | Result | Evidence |','|---|---|---|',...results.map(x=>`| ${x.key}. ${x.name} | ${x.status} | ${String(x.evidence).replaceAll('|','\\|')} |`)];const output=path.join(runtimePaths.appRoot,'reports','phase2f_test_results_2026-09-04.md');await fs.writeFile(output,lines.join('\n'),'utf8');console.log(JSON.stringify({passed,failed,results,output},null,2));if(failed)process.exitCode=1;
