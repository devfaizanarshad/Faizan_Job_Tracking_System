import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createHistoricalPool,createMarketSnapshot,determineLifecycle,distinctOpportunityCount,
  languageObservationStatement,refreshHistoricalIntelligence,scoreEmployer,trendConfidence,vacancyTechnologies
} from './historical-intelligence-engine.js';

const results=[];const record=(key,name,ok,evidence)=>{results.push({key,name,status:ok?'PASS':'FAIL',evidence});if(!ok)throw new Error(`${key}: ${evidence}`);};
const now=new Date('2026-09-04T12:00:00Z');
const base={opportunity_id:900001,employer_id:1,title:'Werkstudent Backend',opportunity_type:'Werkstudent',employment_type:'Student',status:'LIVE',verification_status:'LIVE_VERIFIED',source_date:null,application_deadline:null,first_seen_at:'2026-09-01T12:00:00Z',last_seen_at:'2026-09-04T12:00:00Z',language_bucket:'ENGLISH_EXPLICITLY_ACCEPTED',alert_class:'STRONG_MATCH',latent_fit_class:'STRONG_MATCH',latent_fit_score:90,technology_mentions:['PostgreSQL','Node.js'],enrollment_requirement:'Enrollment required'};
const snaps=[{snapshot_id:1,opportunity_id:base.opportunity_id,observed_at:'2026-09-01T12:00:00Z',snapshot:{status:'LIVE_VERIFIED'}},{snapshot_id:2,opportunity_id:base.opportunity_id,observed_at:'2026-09-03T12:00:00Z',snapshot:{status:'LIVE_VERIFIED'}}];

try{
  const failureOnly=determineLifecycle(base,snaps,[{event_type:'SOURCE_DOWN',detected_at:'2026-09-04T12:00:00Z'}],[]);
  record('A','Temporary source failure does not close an opportunity',!failureOnly.removed&&!failureOnly.closureEvidenceValid,`removed=${failureOnly.removed}`);
  record('B','FIRST_SEEN is not treated as official posting date',failureOnly.officialPosted===null&&failureOnly.postingDateStatus==='UNKNOWN',`official=${failureOnly.officialPosted}, status=${failureOnly.postingDateStatus}`);
  const baseline=determineLifecycle(base,snaps,[{event_type:'BASELINE_OBSERVED',detected_at:'2026-09-01T12:00:00Z'}],[]);
  record('C','Baseline discovery is not counted as newly posted',baseline.officialPosted===null&&baseline.postingDateStatus==='UNKNOWN',`posting_status=${baseline.postingDateStatus}`);
  record('D','Duplicate observations do not create duplicate opportunities',distinctOpportunityCount([base,base,{...base}])===1,`unique=${distinctOpportunityCount([base,base])}`);
  const statement=languageObservationStatement(1,5);
  record('E','One English vacancy does not label an entire employer English-friendly',statement==='1 of 5 observed relevant vacancies explicitly accepted English.',statement);
  record('F','Insufficient observations cannot produce HIGH trend confidence',trendConfidence(3,5)==='INSUFFICIENT_DATA',`confidence=${trendConfidence(3,5)}`);
  const validClose={event_type:'JOB_REMOVED',detected_at:'2026-09-04T12:00:00Z',new_state:{reason:'Absent from canonical listing in two consecutive successful runs'}};
  const closed=determineLifecycle({...base,status:'UNKNOWN'},snaps,[validClose],[]);
  record('G','Closed lifetime requires valid closure evidence',closed.closureEvidenceValid&&closed.lifetimeConfidence==='KNOWN'&&closed.observedLifetimeDays===3,`valid=${closed.closureEvidenceValid}, lifetime=${closed.observedLifetimeDays}`);
  const activeLow=Array.from({length:5},(_,i)=>({...base,opportunity_id:910000+i,first_seen_at:'2026-09-03T12:00:00Z',latent_fit_score:25,alert_class:'POSSIBLE_MATCH',latent_fit_class:'POSSIBLE_MATCH'}));
  const inactiveHigh=[{...base,opportunity_id:920000,first_seen_at:'2026-01-01T12:00:00Z',latent_fit_score:95}];
  const activeScore=scoreEmployer(activeLow,[],1,now),fitScore=scoreEmployer(inactiveHigh,[],1,now);
  record('H','Employer activity and employer fit remain separate',activeScore.activity>fitScore.activity&&activeScore.fit<fitScore.fit,`active=${activeScore.activity}/${activeScore.fit}, inactive=${fitScore.activity}/${fitScore.fit}`);
  const tech=vacancyTechnologies({...base,technology_mentions:['PostgreSQL'],known_technologies:['AWS','Kubernetes']});
  record('I','Technology counts require vacancy evidence',tech.length===1&&tech[0]==='PostgreSQL',`technologies=${tech.join(',')}`);

  const pool=createHistoricalPool();const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const first=await createMarketSnapshot(client,'2099-12-31');const firstHash=first.snapshot.content_hash;const firstCaptured=String(first.snapshot.captured_at);
    const second=await createMarketSnapshot(client,'2099-12-31');
    const count=(await client.query(`SELECT count(*)::int n FROM market_snapshots WHERE snapshot_date='2099-12-31'`)).rows[0].n;
    record('J','Snapshots do not mutate historical snapshots',first.created&&!second.created&&count===1&&second.snapshot.content_hash===firstHash&&String(second.snapshot.captured_at)===firstCaptured,`created=${first.created}/${second.created}, rows=${count}`);
    await client.query('ROLLBACK');
    record('K','Repeated canonical opportunity does not inflate hiring counts',distinctOpportunityCount([{opportunity_id:7},{opportunity_id:7},{opportunity_id:8}])===2,'3 observations → 2 canonical opportunities');
    const beforeProfile=JSON.stringify((await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE')).rows[0]);
    const beforeRanks=(await client.query(`SELECT md5(string_agg(opportunity_id||':'||latent_fit_score||':'||actionability_score,'|' ORDER BY opportunity_id)) h FROM opportunity_rankings`)).rows[0].h;
    await client.query('BEGIN');
    try{
      await refreshHistoricalIntelligence(client,{now,snapshotDate:'2026-09-04',manageTransaction:false});
      const afterProfile=JSON.stringify((await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE')).rows[0]);
      const afterRanks=(await client.query(`SELECT md5(string_agg(opportunity_id||':'||latent_fit_score||':'||actionability_score,'|' ORDER BY opportunity_id)) h FROM opportunity_rankings`)).rows[0].h;
      record('L','Phase 2D production scores/profile remain unchanged',beforeProfile===afterProfile&&beforeRanks===afterRanks,`profile_same=${beforeProfile===afterProfile}, rankings_same=${beforeRanks===afterRanks}`);
    }finally{await client.query('ROLLBACK');}
  }finally{client.release();await pool.end();}
}catch(error){if(!results.some(x=>x.status==='FAIL'))results.push({key:'HARNESS',name:'Test harness',status:'FAIL',evidence:error.stack||String(error)});}

const passed=results.filter(x=>x.status==='PASS').length,failed=results.filter(x=>x.status==='FAIL').length;
const lines=['# Phase 2E validation','',`Result: **${passed} PASS / ${failed} FAIL**`,'','| Test | Requirement | Result | Evidence |','|---|---|---|---|',...results.map(x=>`| ${x.key} | ${x.name} | ${x.status} | ${String(x.evidence).replaceAll('|','\\|')} |`)];
const output=path.resolve('..','reports','phase2e_test_results_2026-09-04.md');await fs.writeFile(output,lines.join('\n'),'utf8');
console.log(JSON.stringify({passed,failed,results,output},null,2));if(failed)process.exitCode=1;
