import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';
import { productionLog } from './structured-log.js';
import { databaseConfig } from './database-config.js';

const pgTool=name=>path.join(process.env.PG_BIN_DIR||'',process.platform==='win32'?`${name}.exe`:name);
const run=(name,args,options={})=>{const r=spawnSync(pgTool(name),args,{encoding:'utf8',env:process.env,...options});if(r.error||r.status!==0)throw new Error(`${name} failed: ${String(r.error?.message||r.stderr||r.stdout).slice(-1000)}`);return r;};
const dbConfig=databaseConfig({defaultUser:'faizan_monitor',max:1});
const db=dbConfig.database,user=dbConfig.user,host=dbConfig.host,port=dbConfig.port;
const conn=['-h',host,'-p',String(port),'-U',user];
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const filename=`faizan_employer_intelligence_${stamp}.backup`,finalPath=path.join(runtimePaths.backupDir,filename),partial=`${finalPath}.partial`;
const retentionDays=Math.max(1,Number(process.env.BACKUP_RETENTION_DAYS||14));
const restoreVerify=process.argv.includes('--restore-verify')||/^true$/i.test(process.env.BACKUP_RESTORE_VERIFY||'');
await fs.mkdir(runtimePaths.backupDir,{recursive:true,mode:0o750});
const pool=new pg.Pool(dbConfig);
let backupId;
try{
  backupId=(await pool.query("INSERT INTO production_backup_runs(status,backup_filename) VALUES('RUNNING',$1) RETURNING backup_run_id",[filename])).rows[0].backup_run_id;
  run('pg_dump',[...conn,'-d',db,'-Fc','--no-owner','--no-privileges','-f',partial]);
  run('pg_restore',['--list',partial]);
  let lifecycleCount=null;
  if(restoreVerify){
    const verifyDb=`faizan_backup_verify_${process.pid}_${Date.now()}`.toLowerCase();
    const exists=run('psql',[...conn,'-d','postgres','-tAc',`SELECT 1 FROM pg_database WHERE datname='${verifyDb}'`]).stdout.trim();
    if(exists)throw new Error('Generated verification database name unexpectedly exists');
    run('createdb',[...conn,verifyDb]);
    try{
      run('pg_restore',[...conn,'-d',verifyDb,'--no-owner','--no-privileges',partial]);
      const invariant=run('psql',[...conn,'-d',verifyDb,'-tAc',"SELECT count(*) FROM opportunity_lifecycles; SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname LIKE 'v_%';"]).stdout.trim().split(/\s+/).map(Number);
      lifecycleCount=invariant[0];if(!Number.isFinite(lifecycleCount)||lifecycleCount<74)throw new Error(`Restore invariant failed: lifecycles=${lifecycleCount}`);
    }finally{run('dropdb',[...conn,'--if-exists',verifyDb]);}
  }
  await fs.rename(partial,finalPath);
  const bytes=(await fs.stat(finalPath)).size,sha256=crypto.createHash('sha256').update(await fs.readFile(finalPath)).digest('hex');
  await pool.query("UPDATE production_backup_runs SET completed_at=now(),status='SUCCEEDED',backup_bytes=$2,sha256=$3,archive_list_verified=TRUE,restore_verified=$4,restored_lifecycle_count=$5 WHERE backup_run_id=$1",[backupId,bytes,sha256,restoreVerify,lifecycleCount]);
  const cutoff=Date.now()-retentionDays*86400000;
  for(const entry of await fs.readdir(runtimePaths.backupDir,{withFileTypes:true})){if(entry.isFile()&&/^faizan_employer_intelligence_\d{8}T\d{6}Z\.backup$/.test(entry.name)){const p=path.join(runtimePaths.backupDir,entry.name);if((await fs.stat(p)).mtimeMs<cutoff)await fs.unlink(p);}}
  productionLog('backup.complete',{backup_filename:filename,backup_bytes:bytes,sha256,archive_list_verified:true,restore_verified:restoreVerify,restored_lifecycle_count:lifecycleCount,retention_days:retentionDays});
  console.log(JSON.stringify({status:'SUCCEEDED',backupPath:finalPath,bytes,sha256,archiveListVerified:true,restoreVerified:restoreVerify,lifecycleCount},null,2));
}catch(error){
  await fs.rm(partial,{force:true}).catch(()=>{});if(backupId)await pool.query("UPDATE production_backup_runs SET completed_at=now(),status='FAILED',error_class=$2,error_message=$3 WHERE backup_run_id=$1",[backupId,error.name,String(error.message).slice(0,1000)]).catch(()=>{});
  productionLog('backup.failure',{error_class:error.name,error_message:error.message},'error');throw error;
}finally{await pool.end();}
