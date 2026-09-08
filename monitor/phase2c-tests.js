import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool, decideAlert, getProfile, persistAlertDecision, processRunAlerts, processRunHealth } from './phase2c-engine.js';

const results=[];
const record=(key,name,condition,details) => {
  const status=condition?'PASS':'FAIL'; results.push({key,name,status,details});
  if(!condition) throw new Error(`${key} failed: ${details}`);
};

const pool=createPool(); const client=await pool.connect();
try{
  await client.query('BEGIN');
  const profile=await getProfile(client);
  const employer=(await client.query('SELECT employer_id,company_name FROM employers ORDER BY employer_id LIMIT 1')).rows[0];
  const sources=(await client.query('SELECT monitored_source_id FROM monitored_sources ORDER BY monitored_source_id LIMIT 2')).rows;
  const emptyRun=(await client.query(`INSERT INTO monitoring_runs(run_mode,requested_tiers,status,tool_version,finished_at)
    VALUES('TEST',ARRAY['S'],'SUCCEEDED','0.3.0-test',now()) RETURNING run_id`)).rows[0];

  const empty=await processRunAlerts(client,emptyRun.run_id,{deliver:false});
  record('A','Identical repeat produces zero alerts',empty.generated===0,`generated=${empty.generated}`);

  const opportunity=(await client.query(`INSERT INTO opportunities
    (employer_id,title,location,opportunity_type,status,job_url,verified_at,first_seen_at,source_date,
     application_deadline,eligibility_status,language_bucket,alert_class,latent_fit_class,technical_match,
     technology_mentions,work_model,hours,missing_requirements,canonical_key)
    VALUES($1,'TEST Exceptional Backend Data Role','Hamburg','Full-time','LIVE',$2,current_date,now(),current_date,
      current_date+5,'ELIGIBLE_NOW','ENGLISH_EXPLICITLY_ACCEPTED','EXCEPTIONAL_MATCH','EXCEPTIONAL_MATCH',3,
      ARRAY['PostgreSQL','Node.js','AWS','REST','Docker'],'Hybrid','20 hours/week','Semiconductor domain experience',md5(random()::text))
    RETURNING *`,[employer.employer_id,`https://example.invalid/phase2c-test-${Date.now()}`])).rows[0];
  opportunity.company_name=employer.company_name;
  const event=(await client.query(`INSERT INTO opportunity_change_events
    (run_id,opportunity_id,monitored_source_id,event_type,new_state,alert_class,urgency,is_actionable)
    VALUES($1,$2,$3,'NEW_JOB','{"test":true}','EXCEPTIONAL_MATCH','ACT_NOW',true) RETURNING *`,
    [emptyRun.run_id,opportunity.opportunity_id,sources[0].monitored_source_id])).rows[0];
  const enrolledProfile={...profile,current_status:'Germany',enrollment_status:'ENROLLED'};
  const first=await persistAlertDecision(client,event,opportunity,enrolledProfile);
  record('B','New exceptional match produces exactly one appropriate alert',Boolean(first.alert)&&first.decision.priority==='P0',
    `inserted=${Boolean(first.alert)}, priority=${first.decision.priority}`);
  const second=await persistAlertDecision(client,event,opportunity,enrolledProfile);
  const alertCount=(await client.query('SELECT count(*)::int n FROM alert_decisions WHERE event_id=$1',[event.event_id])).rows[0].n;
  record('C','Same opportunity/event does not duplicate the alert',!second.alert&&alertCount===1,`second_insert=${Boolean(second.alert)}, stored=${alertCount}`);

  const futureOpportunity={...opportunity,opportunity_type:'Werkstudent',enrollment_requirement:'Current university enrollment required'};
  const future=decideAlert(event,futureOpportunity,{...profile,enrollment_status:'NOT_ENROLLED'});
  record('D','Enrollment-required exceptional match becomes FUTURE/PREPARE',future.priority==='P2'&&future.action==='PREPARE / KEEP WATCHING',
    `priority=${future.priority}, action=${future.action}`);

  const closed=decideAlert({...event,event_type:'JOB_CLOSED'},opportunity,enrolledProfile);
  record('E','Closed role produces a closure decision',closed.alertType==='ROLE_CLOSED'&&closed.priority==='P3',
    `type=${closed.alertType}, priority=${closed.priority}`);

  const language=decideAlert({...event,event_type:'LANGUAGE_REQUIREMENT_CHANGED',new_state:{language_bucket:'ENGLISH_EXPLICITLY_ACCEPTED'}},opportunity,enrolledProfile);
  record('F','Language change produces a material decision',language.alertType==='MATERIAL_LANGUAGE_REQUIREMENT_CHANGED'&&language.priority==='P1',
    `type=${language.alertType}, priority=${language.priority}`);

  const healthRun=(await client.query(`INSERT INTO monitoring_runs(run_mode,requested_tiers,status,tool_version,finished_at)
    VALUES('TEST',ARRAY['S'],'PARTIAL','0.3.0-test',now()) RETURNING run_id`)).rows[0];
  await client.query(`INSERT INTO monitoring_fetches(run_id,monitored_source_id,success,http_status,error_message)
    VALUES($1,$2,false,429,'Rate limited during controlled test')`,[healthRun.run_id,sources[0].monitored_source_id]);
  await client.query(`INSERT INTO monitoring_fetches(run_id,monitored_source_id,success,error_class,error_message)
    VALUES($1,$2,false,'SyntaxError','Controlled parser failure')`,[healthRun.run_id,sources[1].monitored_source_id]);
  const before=(await client.query('SELECT status FROM opportunities WHERE opportunity_id=$1',[opportunity.opportunity_id])).rows[0].status;
  const health=await processRunHealth(client,healthRun.run_id);
  const h429=health.events.find(x=>x.health_type==='HTTP_429');
  record('G','HTTP 429 becomes a source-health issue without bypass',Boolean(h429)&&/No bypass attempted/.test(h429.details),
    h429?.details||'HTTP_429 event missing');
  const parser=health.events.find(x=>x.health_type==='PARSER_FAILURE');
  const after=(await client.query('SELECT status FROM opportunities WHERE opportunity_id=$1',[opportunity.opportunity_id])).rows[0].status;
  record('H','Parser failure is recorded without deleting opportunity history',Boolean(parser)&&before===after,
    `parser=${Boolean(parser)}, before=${before}, after=${after}`);

  const lockKey=24020301;
  await client.query('SELECT pg_advisory_lock($1)',[lockKey]);
  const secondClient=await pool.connect();
  try{
    const acquired=(await secondClient.query('SELECT pg_try_advisory_lock($1) acquired',[lockKey])).rows[0].acquired;
    record('I','Second monitoring process cannot overlap',acquired===false,`second_lock_acquired=${acquired}`);
  }finally{secondClient.release();await client.query('SELECT pg_advisory_unlock($1)',[lockKey]);}

  await client.query('ROLLBACK');
}catch(error){
  await client.query('ROLLBACK');
  if(!results.some(x=>x.status==='FAIL')) results.push({key:'HARNESS',name:'Test harness',status:'FAIL',details:error.stack||String(error)});
}finally{client.release();await pool.end();}

const passed=results.filter(x=>x.status==='PASS').length;
const failed=results.filter(x=>x.status==='FAIL').length;
const lines=['# Phase 2C controlled tests','',`Result: **${passed} PASS / ${failed} FAIL**`,'',
  '| Test | Requirement | Result | Evidence |','|---|---|---|---|',
  ...results.map(x=>`| ${x.key} | ${x.name} | ${x.status} | ${String(x.details).replaceAll('|','\\|')} |`)];
const output=path.resolve('..','reports','phase2c_test_results_2026-08-31.md');
await fs.writeFile(output,lines.join('\n'),'utf8');
console.log(JSON.stringify({passed,failed,results,output},null,2));
if(failed) process.exitCode=1;
