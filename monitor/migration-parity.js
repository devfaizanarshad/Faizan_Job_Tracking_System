import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';

const config=prefix=>({host:process.env[`${prefix}_PGHOST`],port:Number(process.env[`${prefix}_PGPORT`]||5432),database:process.env[`${prefix}_PGDATABASE`]||'faizan_employer_intelligence',user:process.env[`${prefix}_PGUSER`],password:process.env[`${prefix}_PGPASSWORD`],connectionTimeoutMillis:10000,max:1});
const local=new pg.Pool(config('LOCAL')),cloud=new pg.Pool(config('CLOUD'));
const normalized=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?String(v):v])));
async function manifest(pool){
  const client=await pool.connect();
  try{
    await client.query("SET TIME ZONE 'UTC'");
    const q=async sql=>normalized((await client.query(sql)).rows);
    const tables=(await q("SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")).map(x=>x.name);
    const tableData={};
    for(const table of tables){const quoted=`"${table.replaceAll('"','""')}"`;tableData[table]=(await q(`SELECT count(*)::bigint rows,md5(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),'')) content_hash FROM (SELECT md5(row_to_json(t)::text) row_hash FROM ${quoted} t) s`))[0];}
    return {
      server:(await q("SELECT current_database() database,current_user username,current_setting('server_version') server_version,pg_encoding_to_char(encoding) encoding FROM pg_database WHERE datname=current_database()"))[0],
      tables,tableData,
      views:await q("SELECT viewname,regexp_replace(definition,'\\s+',' ','g') definition FROM pg_views WHERE schemaname='public' ORDER BY viewname"),
      sequences:await q("SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename"),
      columns:await q("SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position"),
      constraints:await q("SELECT c.conname,c.contype,cl.relname table_name,pg_get_constraintdef(c.oid,TRUE) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace LEFT JOIN pg_class cl ON cl.oid=c.conrelid WHERE n.nspname='public' AND c.contype<>'n' ORDER BY cl.relname,c.conname"),
      constraintTypeCounts:await q("SELECT contype,count(*)::int count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' GROUP BY contype ORDER BY contype"),
      indexes:await q("SELECT tablename,indexname,regexp_replace(indexdef,'\\s+',' ','g') indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"),
      functions:await q("SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,regexp_replace(pg_get_functiondef(p.oid),'\\s+',' ','g') definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,arguments")
    };
  }finally{client.release();}
}
const [localManifest,cloudManifest]=await Promise.all([manifest(local),manifest(cloud)]);await local.end();await cloud.end();
const categories=['tables','tableData','views','sequences','columns','constraints','indexes','functions'];
const comparisons=Object.fromEntries(categories.map(key=>[key,JSON.stringify(localManifest[key])===JSON.stringify(cloudManifest[key])?'MATCH':'DIFFERENT']));
const baseline={lifecycles:Number(localManifest.tableData.opportunity_lifecycles?.rows||0),employer_histories:Number(localManifest.tableData.employer_historical_metrics?.rows||0),score_states:Number(localManifest.tableData.opportunity_score_history?.rows||0),phase2e_views:localManifest.views.filter(x=>['v_employer_hiring_history','v_employer_activity','v_employer_faizan_fit_history','v_employer_watch_priority','v_role_family_trends','v_technology_demand','v_language_intelligence','v_vacancy_lifetime','v_market_snapshot_latest','v_insufficient_history'].includes(x.viewname)).length};
const table_differences=Object.keys(localManifest.tableData).filter(name=>JSON.stringify(localManifest.tableData[name])!==JSON.stringify(cloudManifest.tableData[name])).map(name=>({table:name,local:localManifest.tableData[name],cloud:cloudManifest.tableData[name]}));
const result={generated_at:new Date().toISOString(),local_server:localManifest.server,cloud_server:cloudManifest.server,baseline,comparisons,all_match:Object.values(comparisons).every(x=>x==='MATCH'),table_differences,constraint_type_counts:{local:localManifest.constraintTypeCounts,cloud:cloudManifest.constraintTypeCounts},comparison_note:"Sessions normalized to UTC. PostgreSQL 18-only contype=n NOT NULL catalog rows are compared through information_schema.columns.is_nullable instead of pg_constraint.",object_counts:{local:{tables:localManifest.tables.length,views:localManifest.views.length,sequences:localManifest.sequences.length,indexes:localManifest.indexes.length,constraints:localManifest.constraints.length,functions:localManifest.functions.length},cloud:{tables:cloudManifest.tables.length,views:cloudManifest.views.length,sequences:cloudManifest.sequences.length,indexes:cloudManifest.indexes.length,constraints:cloudManifest.constraints.length,functions:cloudManifest.functions.length}}};
const output=path.join(runtimePaths.reportDir,'cloud_migration_parity_2026-09-08.json');await fs.writeFile(output,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify({...result,output},null,2));if(!result.all_match)process.exitCode=1;
