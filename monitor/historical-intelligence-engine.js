import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

const {Pool}=pg;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const uniq=a=>[...new Set(a.filter(Boolean))];
const days=(a,b)=>(new Date(b)-new Date(a))/86400000;
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const relevant=o=>o.alert_class!=='NOT_RELEVANT'&&o.latent_fit_class!=='NOT_RELEVANT';

export function roleClassification(o){
  const t=`${o.title||''} ${o.opportunity_type||''} ${o.employment_type||''}`;
  if(/werkstudent|working student/i.test(t))return 'WERKSTUDENT';
  if(/hiwi|studentische hilfskraft|student assistant|research assistant|wissenschaftliche hilfskraft/i.test(t))return 'HIWI_RESEARCH';
  if(/internship|praktikum|intern\b/i.test(t))return 'INTERNSHIP';
  if(/thesis|abschlussarbeit/i.test(t))return 'THESIS';
  if(/\bstudents?\b|studenten|student/i.test(t)||o.enrollment_requirement)return 'STUDENT_OTHER';
  return 'FULL_TIME';
}

export function classifyRoleFamilies(o){
  const title=clean(o.title);const text=clean(`${title} ${o.role_family} ${o.department} ${(o.technology_mentions||[]).join(' ')} ${o.technical_requirements} ${o.role_description}`);
  const out=[];const add=(family,evidence)=>out.push({family,evidence,confidence:'OBSERVED'});
  if(/backend|back-end|softwareentwick|software engineer|\.net|spring boot|\bjava\b|node\.?(?:js)?|\bapi\b/i.test(text))add('BACKEND','Vacancy title/requirements mention backend or software-engineering evidence.');
  if(/full.?stack/i.test(text))add('FULLSTACK','Vacancy explicitly indicates full-stack work.');
  if(/frontend|front-end|react|typescript|angular|next\.?(?:js)?/i.test(text))add('FRONTEND','Vacancy explicitly mentions frontend technology/work.');
  if(/data engineer|data platform|etl|data pipeline/i.test(text))add('DATA_ENGINEERING','Vacancy explicitly indicates data-engineering work.');
  if(/data analy|analytics|business intelligence|power bi|reporting/i.test(text))add('DATA_ANALYTICS','Vacancy explicitly indicates analytics/BI work.');
  if(/database|datenbank|postgres|\bsql\b/i.test(text))add('DATABASE','Vacancy explicitly mentions database technology/work.');
  if(/postgis|\bgis\b|geoinformat|geospatial|spatial|mapping|geomatik|geodäs/i.test(text))add('GIS_GEOSPATIAL','Vacancy explicitly mentions GIS/geospatial work.');
  if(/\bsecurity\b|it.?sicherheit|cyber/i.test(text))add('SECURITY','Vacancy explicitly mentions security work.');
  if(/appsec|application security/i.test(text))add('APPSEC','Vacancy explicitly mentions AppSec.');
  if(/devsecops/i.test(text))add('DEVSECOPS','Vacancy explicitly mentions DevSecOps.');
  if(/cloud|devops|aws|azure|kubernetes|docker|ci\/cd/i.test(text))add('CLOUD_DEVOPS','Vacancy explicitly mentions cloud/DevOps technology.');
  if(/qa|quality assurance|test automation|testautomatis|validation|verification/i.test(text))add('QA_AUTOMATION','Vacancy explicitly mentions QA/test automation or validation.');
  if(/machine learning|\bml\b|artificial intelligence|künstliche intelligenz|generative ai|genai/i.test(text))add('AI_ML','Vacancy explicitly mentions AI/ML.');
  if(/technical support|customer support|helpdesk|service desk/i.test(text))add('TECHNICAL_SUPPORT','Vacancy explicitly indicates technical support.');
  if(/product manager|product owner|product technical/i.test(text))add('PRODUCT_TECHNICAL','Vacancy explicitly indicates technical product work.');
  if(/hiwi|studentische hilfskraft|research|forschung|wissenschaftliche/i.test(text))add('RESEARCH_HIWI','Vacancy explicitly indicates research/HiWi work.');
  return out.length?out:[{family:'OTHER',evidence:`No supported normalized family beyond source title: ${title}`,confidence:'OBSERVED'}];
}

export function languageCategory(o){
  const bucket=o.language_bucket||'UNKNOWN';
  if(bucket==='ENGLISH_EXPLICITLY_ACCEPTED')return 'EXPLICIT_ENGLISH_OK';
  if(bucket==='A2')return 'GERMAN_A2';if(bucket==='B1')return 'GERMAN_B1';if(bucket==='B2')return 'GERMAN_B2';if(bucket==='C1')return 'GERMAN_C1';
  if(bucket==='C2')return 'GERMAN_C1';
  if(bucket==='GERMAN_REQUIRED_UNSPECIFIED_LEVEL')return 'GERMAN_REQUIRED_UNSPECIFIED';
  if(o.english_requirement_raw&&/english.{0,30}(required|fluent|business|excellent)|(?:required|fluent|business|excellent).{0,30}english/i.test(o.english_requirement_raw))return 'ENGLISH_REQUIRED';
  return 'LANGUAGE_NOT_STATED';
}

export function validClosureEvent(event){
  if(event.event_type==='JOB_CLOSED')return true;
  return event.event_type==='JOB_REMOVED'&&/two consecutive successful runs/i.test(JSON.stringify(event.new_state||{}));
}

export function determineLifecycle(o,snapshots=[],events=[],scoreHistory=[]){
  const liveSnapshots=snapshots.filter(s=>/^LIVE/.test(s.snapshot?.status||''));
  const validClosures=events.filter(validClosureEvent).sort((a,b)=>new Date(a.detected_at)-new Date(b.detected_at));
  const removed=validClosures.at(-1)?.detected_at||null;
  const reopened=removed?liveSnapshots.filter(s=>new Date(s.observed_at)>new Date(removed)).sort((a,b)=>new Date(a.observed_at)-new Date(b.observed_at))[0]?.observed_at||null:null;
  const firstConfirmed=liveSnapshots.sort((a,b)=>new Date(a.observed_at)-new Date(b.observed_at))[0]?.observed_at||null;
  const lastConfirmed=[...liveSnapshots].sort((a,b)=>new Date(b.observed_at)-new Date(a.observed_at))[0]?.observed_at||null;
  const closedWithEvidence=Boolean(removed&&!reopened&&o.status!=='LIVE');
  const lifetime=closedWithEvidence&&firstConfirmed?Math.max(0,days(firstConfirmed,removed)):null;
  const materialTypes=new Set(['JOB_DESCRIPTION_CHANGED','LANGUAGE_REQUIREMENT_CHANGED','DEADLINE_CHANGED','LOCATION_CHANGED','WORK_MODE_CHANGED']);
  const families=classifyRoleFamilies(o).map(x=>x.family);const category=languageCategory(o);
  const exactLanguage=clean(o.german_requirement_raw||o.english_requirement_raw||o.language_requirement)||null;
  return {
    opportunityId:o.opportunity_id,employerId:o.employer_id,
    firstSeen:o.first_seen_at||snapshots[0]?.observed_at||o.last_seen_at,lastSeen:o.last_seen_at||lastConfirmed||o.first_seen_at,
    officialPosted:o.source_date||null,officialDeadline:o.application_deadline||null,
    firstConfirmed,lastConfirmed,removed,reopened,observations:snapshots.length,
    materialChanges:events.filter(e=>materialTypes.has(e.event_type)).length,
    observedLifetimeDays:lifetime===null?null:Math.round(lifetime*100)/100,
    lifetimeConfidence:closedWithEvidence&&snapshots.length>=2?'KNOWN':snapshots.length>=2?'OBSERVED':'INSUFFICIENT_DATA',
    postingDateStatus:o.source_date?'KNOWN':'UNKNOWN',closureEvidenceValid:closedWithEvidence,
    roleClassification:roleClassification(o),roleFamilies:families,languageCategory:category,languageEvidence:exactLanguage,
    latentFitHistory:scoreHistory.map(x=>({captured_at:x.captured_at,score:Number(x.latent_fit_score),model_version:x.model_version})),
    actionabilityHistory:scoreHistory.map(x=>({captured_at:x.captured_at,score:Number(x.actionability_score),model_version:x.model_version}))
  };
}

export function historyConfidence(relevantCount,spanDays,successRatio){
  if(relevantCount>=12&&spanDays>=90&&successRatio>=0.8)return 'HIGH';
  if(relevantCount>=6&&spanDays>=60&&successRatio>=0.7)return 'MEDIUM';
  if(relevantCount>=3&&spanDays>=14)return 'LOW';
  return 'INSUFFICIENT_DATA';
}

export function trendConfidence(count,spanDays){
  if(count>=12&&spanDays>=120)return 'HIGH';
  if(count>=8&&spanDays>=60)return 'MEDIUM';
  if(count>=4&&spanDays>=30)return 'LOW';
  return 'INSUFFICIENT_DATA';
}

export function distinctOpportunityCount(rows){return new Set(rows.map(x=>String(x.opportunity_id))).size;}
export function vacancyTechnologies(o){return uniq((o.technology_mentions||[]).map(clean));}
export function languageObservationStatement(explicit,total){return `${explicit} of ${total} observed relevant vacancies explicitly accepted English.`;}

export function scoreEmployer(opps,lifecycles,successRatio,now){
  const rel=opps.filter(relevant);const student=rel.filter(o=>roleClassification(o)!=='FULL_TIME');
  // A baseline observation proves that a vacancy was visible, not that it was newly posted.
  // Only discoveries first recorded after baseline contribute to the "recent activity" factor.
  const postBaseline=rel.filter(o=>o.discovery_run_mode&&o.discovery_run_mode!=='BASELINE');
  const recent=postBaseline.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)>=0&&days(o.first_seen_at,now)<=30).length;
  const familyCounts=new Map();for(const o of rel)for(const f of classifyRoleFamilies(o))familyCounts.set(f.family,(familyCounts.get(f.family)||0)+1);
  const repeatedFamilies=[...familyCounts.values()].filter(n=>n>=2).length;
  const latest=postBaseline.map(o=>o.first_seen_at).filter(Boolean).sort().at(-1);const recency=latest?(days(latest,now)<=7?10:days(latest,now)<=30?6:2):0;
  const activityComponents={distinct_relevant_observed:Math.min(35,rel.length*5),recent_nonbaseline_discoveries:Math.min(20,recent*4),repeated_student_routes:Math.min(15,student.length*3),repeated_role_families:Math.min(15,repeatedFamilies*5),postbaseline_discovery_recency:recency,source_coverage:Math.round((successRatio||0)*5)};
  const activity=Math.min(100,Object.values(activityComponents).reduce((a,b)=>a+b,0));
  const scores=rel.map(o=>Number(o.latent_fit_score||0));const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;const max=scores.length?Math.max(...scores):0;const strong=scores.filter(x=>x>=70).length;
  const strongShare=scores.length?strong/scores.length:0;
  const fitComponents={average_latent_fit:Math.round(avg*0.6),strong_match_share:Math.round(strongShare*25),maximum_observed_fit:Math.round(max*0.15)};
  const fit=Math.min(100,Object.values(fitComponents).reduce((a,b)=>a+b,0));
  const historyScore=Math.min(100,Math.round(avg*0.5+strongShare*30+Math.min(20,rel.length*2)));
  const studentEvidence=Math.min(10,student.length*2);const watchComponents={faizan_fit:Math.round(historyScore*0.45),observed_activity:Math.round(activity*0.30),recency:Math.round(recency*1.5),student_routes:studentEvidence};
  const watch=Math.min(100,Object.values(watchComponents).reduce((a,b)=>a+b,0));
  return {activity,activityComponents,fit,fitComponents,historyScore,watch,watchComponents};
}

export async function createMarketSnapshot(client,snapshotDate){
  const date=snapshotDate||new Date().toISOString().slice(0,10);
  const {rows:opps}=await client.query(`SELECT o.opportunity_id,o.employer_id,o.status,o.alert_class,o.opportunity_type,o.employment_type,o.enrollment_requirement,o.technology_mentions,r.latent_fit_score
    FROM opportunities o LEFT JOIN opportunity_rankings r USING(opportunity_id) WHERE EXISTS(SELECT 1 FROM opportunity_sources os WHERE os.opportunity_id=o.opportunity_id) ORDER BY o.opportunity_id`);
  const live=opps.filter(o=>o.status==='LIVE'),rel=live.filter(relevant),strong=rel.filter(o=>Number(o.latent_fit_score)>=70),student=rel.filter(o=>roleClassification(o)!=='FULL_TIME');
  const payload={total_live:live.length,relevant_live:rel.length,strong_live:strong.length,student_live:student.length};
  const digest=hash(JSON.stringify(payload));
  const inserted=await client.query(`INSERT INTO market_snapshots(snapshot_date,observation_period_start,observation_period_end,total_live_opportunities,relevant_live_opportunities,strong_live_opportunities,student_live_opportunities,snapshot_payload,content_hash)
    VALUES($1,(SELECT min(first_seen_at) FROM opportunity_lifecycles),(SELECT max(last_seen_at) FROM opportunity_lifecycles),$2,$3,$4,$5,$6,$7)
    ON CONFLICT(snapshot_date) DO NOTHING RETURNING market_snapshot_id`,[date,live.length,rel.length,strong.length,student.length,JSON.stringify(payload),digest]);
  if(!inserted.rowCount){const existing=(await client.query('SELECT * FROM market_snapshots WHERE snapshot_date=$1',[date])).rows[0];return {created:false,snapshot:existing};}
  const id=inserted.rows[0].market_snapshot_id;
  await client.query(`INSERT INTO market_snapshot_employers(market_snapshot_id,employer_id,relevant_live_opportunities,activity_score,fit_history_score,watch_priority_score)
    SELECT $1,e.employer_id,count(DISTINCT o.opportunity_id) FILTER(WHERE o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT'),s.employer_activity_score,s.faizan_opportunity_history_score,s.watch_priority_score
    FROM employers e JOIN employer_intelligence_scores s USING(employer_id) LEFT JOIN opportunities o USING(employer_id)
    GROUP BY e.employer_id,s.employer_activity_score,s.faizan_opportunity_history_score,s.watch_priority_score`,[id]);
  await client.query(`INSERT INTO market_snapshot_role_families(market_snapshot_id,role_family,live_opportunities)
    SELECT $1,rf.role_family,count(DISTINCT rf.opportunity_id) FROM opportunity_role_families rf JOIN opportunities o USING(opportunity_id)
    WHERE o.status='LIVE' GROUP BY rf.role_family`,[id]);
  await client.query(`INSERT INTO market_snapshot_technologies(market_snapshot_id,technology,live_opportunities)
    SELECT $1,t,count(DISTINCT o.opportunity_id) FROM opportunities o CROSS JOIN LATERAL unnest(o.technology_mentions)t
    WHERE o.status='LIVE' GROUP BY t`,[id]);
  return {created:true,snapshot:(await client.query('SELECT * FROM market_snapshots WHERE market_snapshot_id=$1',[id])).rows[0]};
}

export function createHistoricalPool(){return new Pool(databaseConfig());}

export async function refreshHistoricalIntelligence(client,{now=new Date(),snapshotDate,manageTransaction=true}={}){
  const {rows:opps}=await client.query(`SELECT o.*,e.company_name,r.latent_fit_score,r.actionability_score,r.overall_score,
    (SELECT mr.run_mode FROM opportunity_change_events ev JOIN monitoring_runs mr ON mr.run_id=ev.run_id
      WHERE ev.opportunity_id=o.opportunity_id AND ev.event_type IN('NEW_JOB','BASELINE_OBSERVED')
      ORDER BY ev.detected_at,ev.event_id LIMIT 1) discovery_run_mode
    FROM opportunities o JOIN employers e USING(employer_id) LEFT JOIN opportunity_rankings r USING(opportunity_id)
    WHERE EXISTS(SELECT 1 FROM opportunity_sources os WHERE os.opportunity_id=o.opportunity_id) ORDER BY o.opportunity_id`);
  const snapshots=(await client.query('SELECT * FROM opportunity_snapshots ORDER BY observed_at')).rows;
  const events=(await client.query('SELECT * FROM opportunity_change_events ORDER BY detected_at')).rows;
  const scores=(await client.query('SELECT * FROM opportunity_score_history ORDER BY captured_at')).rows;
  const ratios=(await client.query(`SELECT ms.employer_id,avg(CASE WHEN mf.success THEN 1.0 ELSE 0.0 END)::numeric ratio,
    min(mf.fetched_at) first_fetch,max(mf.fetched_at) last_fetch
    FROM monitored_sources ms JOIN monitoring_fetches mf USING(monitored_source_id) GROUP BY ms.employer_id`)).rows;
  const monitoredEmployers=(await client.query(`SELECT DISTINCT e.employer_id,e.company_name FROM monitored_sources ms JOIN employers e USING(employer_id) WHERE ms.enabled ORDER BY e.employer_id`)).rows;
  const by=(rows,key)=>{const m=new Map();for(const r of rows){const k=String(r[key]);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
  const snapBy=by(snapshots,'opportunity_id'),eventBy=by(events,'opportunity_id'),scoreBy=by(scores,'opportunity_id');
  const coverageMap=new Map(ratios.map(x=>[String(x.employer_id),{ratio:Number(x.ratio),first:x.first_fetch,last:x.last_fetch}]));
  const lifecycleRows=opps.map(o=>({o,l:determineLifecycle(o,snapBy.get(String(o.opportunity_id))||[],eventBy.get(String(o.opportunity_id))||[],scoreBy.get(String(o.opportunity_id))||[])}));
  if(manageTransaction)await client.query('BEGIN');
  try{
    await client.query('DELETE FROM opportunity_role_families');
    for(const {o,l} of lifecycleRows){
      await client.query(`INSERT INTO opportunity_lifecycles
        (opportunity_id,employer_id,first_seen_at,last_seen_at,official_posted_date,official_deadline,first_confirmed_live_at,last_confirmed_live_at,removed_at,reopened_at,monitoring_observations,material_changes,observed_lifetime_days,lifetime_confidence,posting_date_status,closure_evidence_valid,role_classification,role_families,language_category,language_evidence,work_mode,location,latent_fit_history,actionability_history)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        ON CONFLICT(opportunity_id) DO UPDATE SET employer_id=EXCLUDED.employer_id,first_seen_at=EXCLUDED.first_seen_at,last_seen_at=EXCLUDED.last_seen_at,
        official_posted_date=EXCLUDED.official_posted_date,official_deadline=EXCLUDED.official_deadline,first_confirmed_live_at=EXCLUDED.first_confirmed_live_at,
        last_confirmed_live_at=EXCLUDED.last_confirmed_live_at,removed_at=EXCLUDED.removed_at,reopened_at=EXCLUDED.reopened_at,
        monitoring_observations=EXCLUDED.monitoring_observations,material_changes=EXCLUDED.material_changes,observed_lifetime_days=EXCLUDED.observed_lifetime_days,
        lifetime_confidence=EXCLUDED.lifetime_confidence,posting_date_status=EXCLUDED.posting_date_status,closure_evidence_valid=EXCLUDED.closure_evidence_valid,
        role_classification=EXCLUDED.role_classification,role_families=EXCLUDED.role_families,language_category=EXCLUDED.language_category,
        language_evidence=EXCLUDED.language_evidence,work_mode=EXCLUDED.work_mode,location=EXCLUDED.location,latent_fit_history=EXCLUDED.latent_fit_history,
        actionability_history=EXCLUDED.actionability_history,refreshed_at=now()`,[l.opportunityId,l.employerId,l.firstSeen,l.lastSeen,l.officialPosted,l.officialDeadline,l.firstConfirmed,l.lastConfirmed,l.removed,l.reopened,l.observations,l.materialChanges,l.observedLifetimeDays,l.lifetimeConfidence,l.postingDateStatus,l.closureEvidenceValid,l.roleClassification,l.roleFamilies,l.languageCategory,l.languageEvidence,o.work_model,o.location,JSON.stringify(l.latentFitHistory),JSON.stringify(l.actionabilityHistory)]);
      for(const f of classifyRoleFamilies(o))await client.query(`INSERT INTO opportunity_role_families(opportunity_id,role_family,evidence,confidence) VALUES($1,$2,$3,$4)`,[o.opportunity_id,f.family,f.evidence,f.confidence]);
    }
    for(const s of snapshots){
      const data=s.snapshot||{};const category=languageCategory({language_bucket:data.language_bucket,german_requirement_raw:data.german_requirement_raw,english_requirement_raw:data.english_requirement_raw});
      const evidence=clean(data.german_requirement_raw||data.english_requirement_raw)||null;const evidenceHash=hash(`${category}|${evidence||''}`);
      await client.query(`INSERT INTO language_evidence_observations(opportunity_id,snapshot_id,language_category,exact_evidence,observed_at,evidence_hash)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[s.opportunity_id,s.snapshot_id,category,evidence,s.observed_at,evidenceHash]);
    }
    const employerGroups=by(opps,'employer_id');
    for(const employerRow of monitoredEmployers){
      const employerId=String(employerRow.employer_id);const all=employerGroups.get(employerId)||[];
      const rel=all.filter(relevant);const lrows=lifecycleRows.filter(x=>String(x.o.employer_id)===employerId).map(x=>x.l);
      const familyCount=f=>new Set(rel.filter(o=>classifyRoleFamilies(o).some(x=>x.family===f)).map(o=>o.opportunity_id)).size;
      const categoryCount=c=>rel.filter(o=>languageCategory(o)===c).length;
      const coverage=coverageMap.get(employerId)||{};const first=coverage.first||lrows.map(x=>x.firstSeen).filter(Boolean).sort()[0]||null;
      const last=coverage.last||lrows.map(x=>x.lastSeen).filter(Boolean).sort().at(-1)||null;
      const span=first&&last?Math.max(0,Math.floor(days(first,last))):0;const success=coverage.ratio||0;
      const confidentLifetimes=lrows.filter(x=>x.lifetimeConfidence==='KNOWN').map(x=>x.observedLifetimeDays);
      const student=rel.filter(o=>roleClassification(o)!=='FULL_TIME');const strong=rel.filter(o=>Number(o.latent_fit_score)>=70);
      const german=rel.filter(o=>/^GERMAN_/.test(languageCategory(o)));
      const metric={total:distinctOpportunityCount(all),relevant:distinctOpportunityCount(rel),strong:distinctOpportunityCount(strong),student:distinctOpportunityCount(student),
        werk:rel.filter(o=>roleClassification(o)==='WERKSTUDENT').length,hiwi:rel.filter(o=>roleClassification(o)==='HIWI_RESEARCH').length,
        internThesis:rel.filter(o=>['INTERNSHIP','THESIS'].includes(roleClassification(o))).length,
        english:categoryCount('EXPLICIT_ENGLISH_OK'),german:german.length,enrollment:rel.filter(o=>o.enrollment_requirement||['WERKSTUDENT','HIWI_RESEARCH','STUDENT_OTHER'].includes(roleClassification(o))).length,
        remote:rel.filter(o=>/remote|hybrid|mobile work|home.?office/i.test(`${o.location} ${o.work_model}`)).length,
        recent30:rel.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)>=0&&days(o.first_seen_at,now)<=30).length,recent60:rel.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)>=0&&days(o.first_seen_at,now)<=60).length,recent90:rel.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)>=0&&days(o.first_seen_at,now)<=90).length,
        recentNonBaseline:rel.filter(o=>o.discovery_run_mode&&o.discovery_run_mode!=='BASELINE'&&o.first_seen_at&&days(o.first_seen_at,now)>=0&&days(o.first_seen_at,now)<=30).length,
        official30:rel.filter(o=>o.source_date&&days(o.source_date,now)>=0&&days(o.source_date,now)<=30).length};
      const conf=historyConfidence(metric.relevant,span,success);const lifeMedian=confidentLifetimes.length>=3?median(confidentLifetimes):null;
      await client.query(`INSERT INTO employer_historical_metrics VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,now())
        ON CONFLICT(employer_id) DO UPDATE SET total_unique_opportunities=EXCLUDED.total_unique_opportunities,relevant_opportunities=EXCLUDED.relevant_opportunities,
        strong_excellent_matches=EXCLUDED.strong_excellent_matches,student_opportunities=EXCLUDED.student_opportunities,werkstudent_opportunities=EXCLUDED.werkstudent_opportunities,
        hiwi_research_opportunities=EXCLUDED.hiwi_research_opportunities,internship_thesis_opportunities=EXCLUDED.internship_thesis_opportunities,
        backend_roles=EXCLUDED.backend_roles,fullstack_roles=EXCLUDED.fullstack_roles,data_database_roles=EXCLUDED.data_database_roles,gis_roles=EXCLUDED.gis_roles,
        security_roles=EXCLUDED.security_roles,cloud_devops_roles=EXCLUDED.cloud_devops_roles,explicit_english_opportunities=EXCLUDED.explicit_english_opportunities,
        german_required_opportunities=EXCLUDED.german_required_opportunities,enrollment_required_opportunities=EXCLUDED.enrollment_required_opportunities,
        remote_hybrid_opportunities=EXCLUDED.remote_hybrid_opportunities,median_confident_lifetime_days=EXCLUDED.median_confident_lifetime_days,
        lifetime_metric_status=EXCLUDED.lifetime_metric_status,most_recent_relevant_at=EXCLUDED.most_recent_relevant_at,relevant_first_seen_30d=EXCLUDED.relevant_first_seen_30d,
        relevant_first_seen_60d=EXCLUDED.relevant_first_seen_60d,relevant_first_seen_90d=EXCLUDED.relevant_first_seen_90d,official_postings_30d=EXCLUDED.official_postings_30d,
        first_observed_at=EXCLUDED.first_observed_at,last_observed_at=EXCLUDED.last_observed_at,observation_span_days=EXCLUDED.observation_span_days,
        source_success_ratio=EXCLUDED.source_success_ratio,confidence=EXCLUDED.confidence,refreshed_at=now()`,[Number(employerId),metric.total,metric.relevant,metric.strong,metric.student,metric.werk,metric.hiwi,metric.internThesis,familyCount('BACKEND'),familyCount('FULLSTACK'),familyCount('DATA_ENGINEERING')+familyCount('DATA_ANALYTICS')+familyCount('DATABASE'),familyCount('GIS_GEOSPATIAL'),familyCount('SECURITY')+familyCount('APPSEC')+familyCount('DEVSECOPS'),familyCount('CLOUD_DEVOPS'),metric.english,metric.german,metric.enrollment,metric.remote,lifeMedian,lifeMedian===null?'INSUFFICIENT_DATA':'KNOWN',rel.map(o=>o.first_seen_at).filter(Boolean).sort().at(-1)||null,metric.recent30,metric.recent60,metric.recent90,metric.official30,first,last,span,success,conf]);
      const scored=scoreEmployer(all,lrows,success,now);
      await client.query(`INSERT INTO employer_intelligence_scores(employer_id,employer_activity_score,employer_fit_score,faizan_opportunity_history_score,watch_priority_score,activity_components,fit_components,watch_components,confidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(employer_id) DO UPDATE SET employer_activity_score=EXCLUDED.employer_activity_score,
        employer_fit_score=EXCLUDED.employer_fit_score,faizan_opportunity_history_score=EXCLUDED.faizan_opportunity_history_score,watch_priority_score=EXCLUDED.watch_priority_score,
        activity_components=EXCLUDED.activity_components,fit_components=EXCLUDED.fit_components,watch_components=EXCLUDED.watch_components,confidence=EXCLUDED.confidence,refreshed_at=now()`,[Number(employerId),scored.activity,scored.fit,scored.historyScore,scored.watch,JSON.stringify(scored.activityComponents),JSON.stringify(scored.fitComponents),JSON.stringify(scored.watchComponents),conf]);
      const explicit=metric.english;const levels=rel.map(o=>languageCategory(o)).filter(x=>/^GERMAN_[ABC]/.test(x));const levelOrder=['GERMAN_A2','GERMAN_B1','GERMAN_B2','GERMAN_C1'];const strongest=levels.sort((a,b)=>levelOrder.indexOf(b)-levelOrder.indexOf(a))[0]||null;
      const statement=languageObservationStatement(explicit,metric.relevant);
      await client.query(`INSERT INTO employer_language_intelligence(employer_id,relevant_vacancies_observed,explicit_english_roles,english_required_roles,german_required_roles,strongest_german_threshold,student_roles_with_english_evidence,observation_statement,confidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(employer_id) DO UPDATE SET relevant_vacancies_observed=EXCLUDED.relevant_vacancies_observed,
        explicit_english_roles=EXCLUDED.explicit_english_roles,english_required_roles=EXCLUDED.english_required_roles,german_required_roles=EXCLUDED.german_required_roles,
        strongest_german_threshold=EXCLUDED.strongest_german_threshold,student_roles_with_english_evidence=EXCLUDED.student_roles_with_english_evidence,
        observation_statement=EXCLUDED.observation_statement,confidence=EXCLUDED.confidence,refreshed_at=now()`,[Number(employerId),metric.relevant,explicit,categoryCount('ENGLISH_REQUIRED'),metric.german,strongest,student.filter(o=>languageCategory(o)==='EXPLICIT_ENGLISH_OK').length,statement,conf]);
      const trendSpecs=[['ACTIVITY_CHANGE',metric.recentNonBaseline,null,'relevant non-baseline discoveries in the trailing 30 days'],['REPEATED_STUDENT_HIRING',metric.student,null,'relevant student opportunities observed'],['REPEATED_BACKEND_HIRING',familyCount('BACKEND'),null,'backend opportunities observed'],['REPEATED_GIS_HIRING',familyCount('GIS_GEOSPATIAL'),null,'GIS/geospatial opportunities observed'],['REPEATED_SECURITY_HIRING',familyCount('SECURITY')+familyCount('APPSEC')+familyCount('DEVSECOPS'),null,'security opportunities observed']];
      for(const [type,count,prior,label] of trendSpecs){const tc=trendConfidence(count,span);const direction=tc==='INSUFFICIENT_DATA'?'INSUFFICIENT_DATA':type==='ACTIVITY_CHANGE'?'STABLE':count>=2?'REPEATED':'STABLE';const statement=tc==='INSUFFICIENT_DATA'?`${count} ${label}; observation period is too short for a trend claim.`:`Employer produced ${count} ${label} during the observed period.`;await client.query(`INSERT INTO employer_trend_observations(employer_id,trend_type,observed_statement,current_count,prior_count,direction,confidence,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(employer_id,trend_type) DO UPDATE SET observed_statement=EXCLUDED.observed_statement,current_count=EXCLUDED.current_count,prior_count=EXCLUDED.prior_count,direction=EXCLUDED.direction,confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,refreshed_at=now()`,[Number(employerId),type,statement,count,prior,direction,tc,JSON.stringify({observation_span_days:span,canonical_opportunities:metric.total})]);}
    }
    const technologies=new Map();
    for(const o of opps)for(const tech of vacancyTechnologies(o)){if(!technologies.has(tech))technologies.set(tech,[]);technologies.get(tech).push(o);}
    for(const [tech,rows] of technologies){const ids=new Set(rows.map(o=>String(o.opportunity_id)));const unique=[...ids].map(id=>rows.find(o=>String(o.opportunity_id)===id));const observedMentions=unique.reduce((n,o)=>n+(snapBy.get(String(o.opportunity_id))||[]).length,0);await client.query(`INSERT INTO technology_demand_history VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OBSERVED',now()) ON CONFLICT(technology) DO UPDATE SET total_observed_mentions=EXCLUDED.total_observed_mentions,distinct_opportunities=EXCLUDED.distinct_opportunities,distinct_employers=EXCLUDED.distinct_employers,student_role_opportunities=EXCLUDED.student_role_opportunities,strong_match_opportunities=EXCLUDED.strong_match_opportunities,first_observed_30d=EXCLUDED.first_observed_30d,first_observed_60d=EXCLUDED.first_observed_60d,first_observed_90d=EXCLUDED.first_observed_90d,evidence_status='OBSERVED',refreshed_at=now()`,[tech,observedMentions,unique.length,new Set(unique.map(o=>String(o.employer_id))).size,unique.filter(o=>roleClassification(o)!=='FULL_TIME').length,unique.filter(o=>Number(o.latent_fit_score)>=70).length,unique.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)<=30).length,unique.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)<=60).length,unique.filter(o=>o.first_seen_at&&days(o.first_seen_at,now)<=90).length]);}
    await client.query(`DELETE FROM technology_demand_history WHERE NOT(technology=ANY($1::text[]))`,[[...technologies.keys()]]);
    if(manageTransaction)await client.query('COMMIT');
  }catch(error){if(manageTransaction)await client.query('ROLLBACK');throw error;}
  const snapshot=await createMarketSnapshot(client,snapshotDate||now.toISOString().slice(0,10));
  return {opportunities:opps.length,employers:monitoredEmployers.length,technologies:new Set(opps.flatMap(vacancyTechnologies)).size,snapshot};
}

async function cli(){const pool=createHistoricalPool();const client=await pool.connect();try{console.log(JSON.stringify(await refreshHistoricalIntelligence(client),null,2));}finally{client.release();await pool.end();}}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))cli().catch(e=>{console.error(e);process.exitCode=1;});
