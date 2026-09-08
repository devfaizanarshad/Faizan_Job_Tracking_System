import fs from 'node:fs/promises';
import path from 'node:path';
import { createRankingPool, scoreOpportunity } from './ranking-engine.js';

const now=new Date('2026-09-04T12:00:00Z');
const current={current_status:'Outside Germany',expected_move:'Germany',target_university:'Universität zu Lübeck',enrollment_status:'NOT_ENROLLED',german_level:'A2',target_german_level:'B1',timezone:'Europe/Berlin'};
const enrolledB1={...current,current_status:'Germany',enrollment_status:'ENROLLED',german_level:'B1',target_german_level:'B1'};
const base={opportunity_id:999999,title:'Backend Software Engineer',location:'Hamburg',opportunity_type:'Full-time',employment_type:'Employee',status:'LIVE',verification_status:'LIVE_VERIFIED',language_bucket:'NO_GERMAN_THRESHOLD_STATED',alert_class:'STRONG_MATCH',latent_fit_class:'STRONG_MATCH',technical_match:3,technology_mentions:['PostgreSQL','Node.js','AWS','REST'],technical_requirements:'PostgreSQL Node.js REST APIs',role_description:'Backend engineering',first_seen_at:'2026-09-04T08:00:00Z',source_date:null,source_tier:'A',pattern_observations:0,eligibility_status:'ELIGIBLE_NOW',work_model:'Hybrid'};
const results=[];
function check(key,name,condition,evidence){results.push({key,name,status:condition?'PASS':'FAIL',evidence});if(!condition)throw new Error(`${key}: ${evidence}`);}

try{
  const futureRole={...base,title:'Werkstudent (m/w/d) Geoinformatik / Informatik',opportunity_type:'Werkstudent',employment_type:'Student',enrollment_requirement:'Current enrollment required',language_bucket:'ENGLISH_EXPLICITLY_ACCEPTED',technology_mentions:['PostgreSQL','PostGIS','GIS','Python'],technical_requirements:'PostGIS GIS backend database',role_description:'Technical GIS student role'};
  const currentScore=scoreOpportunity(futureRole,current,{now});
  check('A','Enrollment-required exceptional role keeps high latent fit and low actionability',currentScore.latentFitScore>=80&&currentScore.actionabilityScore<=35,`latent=${currentScore.latentFitScore}, actionability=${currentScore.actionabilityScore}`);
  const enrolledScore=scoreOpportunity(futureRole,enrolledB1,{now});
  check('B','Enrollment simulation raises actionability appropriately',enrolledScore.actionabilityScore-currentScore.actionabilityScore>=50&&enrolledScore.actionabilityScore>=80,`current=${currentScore.actionabilityScore}, enrolled=${enrolledScore.actionabilityScore}`);

  const c1=scoreOpportunity({...base,language_bucket:'C1',german_requirement_raw:'German C1 required'},enrolledB1,{now});
  check('C','C1-required role remains non-actionable under B1',c1.actionabilityScore<=20&&c1.blockers.some(x=>x.kind==='German'&&x.severity==='HARD'),`actionability=${c1.actionabilityScore}, blocker=${c1.explanation.primary_blocker}`);

  const english=scoreOpportunity({...base,language_bucket:'ENGLISH_EXPLICITLY_ACCEPTED',english_requirement_raw:'English accepted'},enrolledB1,{now});
  check('D','Explicit-English role receives no German penalty',english.components.language_compatibility.score===8&&!english.blockers.some(x=>x.kind==='German'),`language=${english.components.language_compatibility.score}, German blockers=${english.blockers.filter(x=>x.kind==='German').length}`);

  const prestige=scoreOpportunity({...base,title:'Generic IT Support Consultant',source_tier:'S',technical_match:0,technology_mentions:[],technical_requirements:null,role_description:'General support and consulting'},enrolledB1,{now});
  const strongA=scoreOpportunity({...base,source_tier:'A'},enrolledB1,{now});
  check('E','Employer prestige cannot outrank much stronger technical fit',strongA.latentFitScore>prestige.latentFitScore,`strong A=${strongA.latentFitScore}, generic S=${prestige.latentFitScore}`);

  const unknownPosted=scoreOpportunity({...base,source_date:null,first_seen_at:'2026-09-04T11:00:00Z'},enrolledB1,{now});
  check('F','Crawler discovery is not labeled as newly posted',unknownPosted.freshnessBasis==='FIRST_SEEN_BY_SYSTEM_ONLY'&&!unknownPosted.isOfficiallyNew,`basis=${unknownPosted.freshnessBasis}, officially_new=${unknownPosted.isOfficiallyNew}`);

  const closed=scoreOpportunity({...base,status:'CLOSED',verification_status:'CLOSED'},enrolledB1,{now});
  check('G','Closed opportunity has zero actionability',closed.actionabilityScore===0,`actionability=${closed.actionabilityScore}`);

  const irrelevant=scoreOpportunity({...base,alert_class:'NOT_RELEVANT',latent_fit_class:'NOT_RELEVANT'},enrolledB1,{now});
  check('H','NOT_RELEVANT opportunity cannot achieve a technical top score',irrelevant.latentFitScore<=25,`latent=${irrelevant.latentFitScore}`);

  const deterministic1=scoreOpportunity(base,enrolledB1,{now});
  const deterministic2=scoreOpportunity(base,enrolledB1,{now});
  check('I','Unchanged input produces a deterministic score',JSON.stringify(deterministic1)===JSON.stringify(deterministic2),`score=${deterministic1.latentFitScore}/${deterministic1.actionabilityScore}`);

  const pool=createRankingPool();const client=await pool.connect();
  try{
    const closedInView=(await client.query(`SELECT count(*)::int n FROM v_top_current_actionable v JOIN opportunities o USING(opportunity_id) WHERE o.status<>'LIVE'`)).rows[0].n;
    const irrelevantInTracks=(await client.query(`SELECT count(*)::int n FROM (
      SELECT opportunity_id FROM v_top_backend UNION SELECT opportunity_id FROM v_top_data UNION SELECT opportunity_id FROM v_top_gis UNION SELECT opportunity_id FROM v_top_security
    ) t JOIN opportunities o USING(opportunity_id) WHERE o.alert_class='NOT_RELEVANT'`)).rows[0].n;
    if(closedInView!==0||irrelevantInTracks!==0) throw new Error(`Live view guard failed: closed=${closedInView}, irrelevant=${irrelevantInTracks}`);
  }finally{client.release();await pool.end();}
}catch(error){
  if(!results.some(x=>x.status==='FAIL'))results.push({key:'HARNESS',name:'Database view guards',status:'FAIL',evidence:error.stack||String(error)});
}

const passed=results.filter(x=>x.status==='PASS').length;const failed=results.filter(x=>x.status==='FAIL').length;
const lines=['# Phase 2D validation','',`Result: **${passed} PASS / ${failed} FAIL**`,'','| Test | Requirement | Result | Evidence |','|---|---|---|---|',...results.map(x=>`| ${x.key} | ${x.name} | ${x.status} | ${String(x.evidence).replaceAll('|','\\|')} |`)];
const output=path.resolve('..','reports','phase2d_test_results_2026-09-04.md');
await fs.writeFile(output,lines.join('\n'),'utf8');
console.log(JSON.stringify({passed,failed,results,output},null,2));
if(failed)process.exitCode=1;
