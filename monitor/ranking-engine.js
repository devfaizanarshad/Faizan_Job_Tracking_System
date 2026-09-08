import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

const {Pool}=pg;
export const MODEL_VERSION='phase2d-v1.0';
export const DIMENSION_MAXIMA={
  technical_fit:18,
  demonstrated_project_overlap:16,
  strategic_role_relevance:16,
  role_type_and_seniority:12,
  academic_student_relevance:10,
  location_work_model:10,
  language_compatibility:8,
  employer_quality:5,
  freshness:5
};
export const ACTIONABILITY_RULES={
  enrollment_required:-40,
  outside_germany:-25,
  start_date_mismatch:-20,
  known_language_above_target:-55,
  german_required_unspecified:-15,
  seniority_mismatch:-45,
  academic_ineligibility:-70,
  eligibility_unknown:-10,
  location_unclear:-5,
  short_official_deadline_bonus:5,
  closed_actionability:0
};

const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const uniq=a=>[...new Set(a.filter(Boolean))];
const textOf=o=>clean(`${o.title} ${o.opportunity_type} ${o.role_family} ${o.department} ${(o.technology_mentions||[]).join(' ')} ${o.technical_requirements} ${o.preferred_requirements} ${o.role_description}`);
const studentRole=o=>/werkstudent|working student|\bstudents?\b|studenten|student assistant|studentische|hilfskraft|hiwi|internship|praktikum|thesis|abschlussarbeit/i.test(`${o.title} ${o.opportunity_type} ${o.employment_type}`);
const seniorRole=o=>/\b(senior|lead|principal|staff|head|director|manager|architect)\b/i.test(o.title||'');
const nonRelevant=o=>o.alert_class==='NOT_RELEVANT'||o.latent_fit_class==='NOT_RELEVANT';
const germanyLocation=o=>/lübeck|luebeck|hamburg|ahrensburg|bad oldesloe|germany|deutschland/i.test(`${o.location} ${o.work_model}`);
const remoteRole=o=>/remote|mobile work|home.?office/i.test(`${o.location} ${o.work_model}`);
const levelValue={A0:0,A1:1,A2:2,B1:3,B2:4,C1:5,C2:6};

function detectTracks(o){
  const title=clean(o.title); const text=textOf(o); const tracks=[];
  if(/backend|back-end|softwareentwick|software engineer|\.net|spring boot|\bjava\b|node\.?(?:js)?|\bapi\b/i.test(text)) tracks.push('BACKEND_SOFTWARE');
  if(/full.?stack|frontend|front-end|react|typescript|next\.?(?:js)?|angular/i.test(text)) tracks.push('FULL_STACK');
  if(/data engineer|database|datenbank|postgres|\bsql\b|etl|analytics|business intelligence|power bi/i.test(text)) tracks.push('DATA_DATABASE');
  if(/postgis|\bgis\b|geoinformat|geospatial|spatial|mapping|geomatik|geodäs/i.test(text)) tracks.push('GIS_GEOSPATIAL');
  if(/appsec|devsecops|it.?security|cyber|secure|security|sicherheit/i.test(text)) tracks.push('SECURITY_APPSEC');
  if(/cloud|platform|devops|aws|azure|kubernetes|docker|ci\/cd/i.test(text)) tracks.push('CLOUD_PLATFORM_DEVOPS');
  if(/qa|quality assurance|test automation|testautomatis|validation|verification/i.test(text)) tracks.push('QA_TEST_AUTOMATION');
  if(/hiwi|student assistant|studentische hilfskraft|research|forschung|wissenschaftliche/i.test(text)) tracks.push('TECHNICAL_RESEARCH');
  if(!tracks.length && Number(o.technical_match||0)>0) tracks.push('OTHER_TECHNICAL');
  const titleOrder=[
    ['GIS_GEOSPATIAL',/gis|geo|spatial|mapping|geomatik|geodäs/i],
    ['SECURITY_APPSEC',/security|sicherheit|cyber|appsec|devsec/i],
    ['DATA_DATABASE',/data|database|daten|analytics|business intelligence/i],
    ['FULL_STACK',/full.?stack|frontend|react|typescript|angular/i],
    ['BACKEND_SOFTWARE',/backend|software|entwickler|engineer|java|\.net/i],
    ['CLOUD_PLATFORM_DEVOPS',/cloud|platform|devops/i],
    ['QA_TEST_AUTOMATION',/qa|test|validation|verification/i],
    ['TECHNICAL_RESEARCH',/hiwi|research|forschung/i]
  ];
  const primary=titleOrder.find(([track,re])=>tracks.includes(track)&&re.test(title))?.[0]
    || ['BACKEND_SOFTWARE','FULL_STACK','DATA_DATABASE','GIS_GEOSPATIAL','SECURITY_APPSEC','CLOUD_PLATFORM_DEVOPS','QA_TEST_AUTOMATION','TECHNICAL_RESEARCH','OTHER_TECHNICAL'].find(x=>tracks.includes(x))
    || 'NON_TECHNICAL';
  return {tracks:uniq(tracks),primary};
}

function projectOverlap(o,tracks){
  const text=textOf(o); const evidence=[]; let score=0;
  if(tracks.includes('GIS_GEOSPATIAL') && /postgis|gis|spatial|mapping|geo/i.test(text)){
    evidence.push('GeoFenceTrack: PostGIS optimization','Chargerzilla: GIS mapping'); score=Math.max(score,16);
  }
  if(tracks.includes('BACKEND_SOFTWARE') && /postgres|node|redis|rest|api|aws|flask/i.test(text)){
    evidence.push('BrandedUK: Node.js/APIs/PostgreSQL/Redis','Chargerzilla: PostgreSQL/AWS/Flask'); score=Math.max(score,14);
  }
  if(tracks.includes('DATA_DATABASE') && /postgres|sql|etl|python|data/i.test(text)){
    evidence.push('Chargerzilla: PostgreSQL/ETL/Python data work'); score=Math.max(score,13);
  }
  if(tracks.includes('FULL_STACK') && /react|typescript|next|frontend/i.test(text)){
    evidence.push('Chargerzilla: Next.js frontend with production backend integration'); score=Math.max(score,12);
  }
  if(/workflow|rbac|enterprise|relational|procurement/i.test(text)){
    evidence.push('Digi2S: enterprise workflows/RBAC/relational data'); score=Math.max(score,11);
  }
  if(tracks.includes('SECURITY_APPSEC')){
    evidence.push('MSc IT Security direction and production-backend evidence'); score=Math.max(score,8);
  }
  if(!evidence.length && Number(o.technical_match||0)>0){evidence.push('General production software evidence');score=4;}
  return {score:Math.min(16,score),evidence};
}

function languageContribution(o,profile){
  const bucket=o.language_bucket||'UNKNOWN'; const current=levelValue[profile.german_level]??0;
  if(bucket==='ENGLISH_EXPLICITLY_ACCEPTED') return {score:8,label:'Explicit English compatibility'};
  if(bucket==='NO_GERMAN_THRESHOLD_STATED') return {score:6,label:'No German threshold stated; not treated as explicit English'};
  if(/^([ABC][0-2])$/.test(bucket)){
    const required=levelValue[bucket]??6;
    return current>=required?{score:7,label:`German ${bucket} met in scenario`}:{score:required-current===1?3:0,label:`German ${bucket} above scenario level ${profile.german_level}`};
  }
  if(bucket==='GERMAN_REQUIRED_UNSPECIFIED_LEVEL') return {score:2,label:'German required; level unspecified'};
  return {score:4,label:'Language threshold unknown'};
}

function freshnessContribution(o,now){
  const official=o.source_date?new Date(o.source_date):null;
  const first=o.first_seen_at?new Date(o.first_seen_at):null;
  if(official && !Number.isNaN(official.valueOf())){
    const age=Math.floor((now-official)/86400000);
    return {score:age<=7?5:age<=30?3:1,basis:'OFFICIAL_POSTED_DATE',officiallyNew:age>=0&&age<=7,label:`Official posting age: ${age} days`};
  }
  if(first && !Number.isNaN(first.valueOf())){
    const age=Math.floor((now-first)/86400000);
    return {score:age<=7?3:age<=30?2:1,basis:'FIRST_SEEN_BY_SYSTEM_ONLY',officiallyNew:false,label:`First seen by system ${age} days ago; official posting date unknown`};
  }
  return {score:1,basis:'UNKNOWN',officiallyNew:false,label:'Posting date and first-seen date unavailable'};
}

function strategicScore(primary){
  return ({BACKEND_SOFTWARE:16,FULL_STACK:15,DATA_DATABASE:14,GIS_GEOSPATIAL:14,SECURITY_APPSEC:13,CLOUD_PLATFORM_DEVOPS:12,QA_TEST_AUTOMATION:10,TECHNICAL_RESEARCH:8,OTHER_TECHNICAL:5,NON_TECHNICAL:0})[primary];
}

function locationContribution(o){
  const t=`${o.location||''} ${o.work_model||''}`;
  let score=/lübeck|luebeck/i.test(t)?10:/bad oldesloe/i.test(t)?9:/ahrensburg/i.test(t)?8:/hamburg/i.test(t)?7:/germany|deutschland/i.test(t)?5:remoteRole(o)?8:o.location?2:3;
  if(/hybrid|mobile work|home.?office/i.test(t)) score=Math.min(10,score+1);
  return {score,label:clean(o.location||o.work_model||'Location not stated')};
}

function compareGermanRequirement(o,profile){
  const bucket=o.language_bucket||'';
  if(!levelValue.hasOwnProperty(bucket)) return null;
  const available=Math.max(levelValue[profile.german_level]??0,levelValue[profile.target_german_level]??0);
  return levelValue[bucket]>available?bucket:null;
}

export function scoreOpportunity(o,profile,{now=new Date()}={}){
  const {tracks,primary}=detectTracks(o); const student=studentRole(o); const senior=seniorRole(o);
  const technical=({0:0,1:8,2:14,3:18})[Number(o.technical_match||0)]??0;
  const project=projectOverlap(o,tracks);
  const strategic=strategicScore(primary);
  const recurring=Number(o.pattern_observations||0)>=3?2:0;
  let roleType=nonRelevant(o)?0:senior?1:student?10:Number(o.technical_match||0)>0?7:3;
  roleType=Math.min(12,roleType+recurring);
  const academic=nonRelevant(o)?0:student&&Number(o.technical_match||0)>0?10:tracks.includes('TECHNICAL_RESEARCH')?10:(tracks.includes('GIS_GEOSPATIAL')||tracks.includes('SECURITY_APPSEC'))?8:4;
  const location=locationContribution(o); const language=languageContribution(o,profile);
  const employer=o.source_tier==='S'?5:o.source_tier==='A'?3:1;
  const freshness=freshnessContribution(o,now);
  const components={
    technical_fit:{score:technical,max:18,evidence:`Stored technical match ${o.technical_match||0}/3`},
    demonstrated_project_overlap:{score:project.score,max:16,evidence:project.evidence},
    strategic_role_relevance:{score:strategic,max:16,evidence:primary},
    role_type_and_seniority:{score:roleType,max:12,evidence:student?'Student route':senior?'Seniority mismatch':'Technical role'},
    academic_student_relevance:{score:academic,max:10,evidence:student?'Student/academic route':tracks.includes('SECURITY_APPSEC')?'MSc security relevance':'General relevance'},
    location_work_model:{score:location.score,max:10,evidence:location.label},
    language_compatibility:{score:language.score,max:8,evidence:language.label},
    employer_quality:{score:employer,max:5,evidence:`Monitored source tier ${o.source_tier||'unknown'}`},
    freshness:{score:freshness.score,max:5,evidence:freshness.label},
    tracks
  };
  let latent=Object.values(components).filter(x=>x&&typeof x.score==='number').reduce((n,x)=>n+x.score,0);
  if(nonRelevant(o)) latent=Math.min(latent,25);
  latent=clamp(Math.round(latent));
  const blockers=[]; const adjustments=[]; const softGaps=uniq(clean(o.missing_requirements).split(';').map(clean));
  const addBlock=(kind,label,penalty,severity)=>{blockers.push({kind,label,penalty,severity});adjustments.push(`${penalty} ${label}`);};
  let action=latent;
  if(o.status!=='LIVE'||o.verification_status==='CLOSED'){
    action=0;addBlock('other','Role is closed or not live',-latent,'HARD');
  }else{
    if(student && profile.enrollment_status!=='ENROLLED'){action+=ACTIONABILITY_RULES.enrollment_required;addBlock('enrollment','Enrollment required',ACTIONABILITY_RULES.enrollment_required,'TEMPORARY');}
    if(/outside germany/i.test(profile.current_status||'')&&germanyLocation(o)){action+=ACTIONABILITY_RULES.outside_germany;addBlock('arrival','Outside Germany for a Germany-based role',ACTIONABILITY_RULES.outside_germany,'TEMPORARY');}
    if(o.eligibility_status==='START_DATE_MISMATCH'){action+=ACTIONABILITY_RULES.start_date_mismatch;addBlock('other','Start-date mismatch',ACTIONABILITY_RULES.start_date_mismatch,'TEMPORARY');}
    const above=compareGermanRequirement(o,profile);
    if(above){action+=ACTIONABILITY_RULES.known_language_above_target;addBlock('German',`German ${above} required above current/target level`,ACTIONABILITY_RULES.known_language_above_target,'HARD');}
    else if(o.language_bucket==='GERMAN_REQUIRED_UNSPECIFIED_LEVEL'){
      action+=ACTIONABILITY_RULES.german_required_unspecified;addBlock('German','German required at an unspecified level',ACTIONABILITY_RULES.german_required_unspecified,'SOFT');
    }
    if(senior){action+=ACTIONABILITY_RULES.seniority_mismatch;addBlock('seniority','Seniority mismatch',ACTIONABILITY_RULES.seniority_mismatch,'HARD');}
    if(student&&/completed degree|required degree|abgeschlossenes studium/i.test(textOf(o))){
      action+=ACTIONABILITY_RULES.academic_ineligibility;addBlock('other','Completed degree conflicts with student eligibility',ACTIONABILITY_RULES.academic_ineligibility,'HARD');
    }
    if(!o.eligibility_status||o.eligibility_status==='ELIGIBILITY_UNKNOWN'){
      action+=ACTIONABILITY_RULES.eligibility_unknown;addBlock('other','Eligibility or work authorization unclear',ACTIONABILITY_RULES.eligibility_unknown,'SOFT');
    }
    if(!o.location){action+=ACTIONABILITY_RULES.location_unclear;addBlock('other','Location unclear',ACTIONABILITY_RULES.location_unclear,'SOFT');}
    if(o.application_deadline){
      const days=(new Date(o.application_deadline)-now)/86400000;
      if(days<0){action=0;addBlock('other','Official deadline passed',-100,'HARD');}
      else if(days<=10){action+=ACTIONABILITY_RULES.short_official_deadline_bonus;adjustments.push(`+${ACTIONABILITY_RULES.short_official_deadline_bonus} official deadline within 10 days`);}
    }
    const hard=blockers.some(x=>x.severity==='HARD');
    action=clamp(Math.round(action));
    if(hard) action=Math.min(action,20);
  }
  const overall=clamp(Math.round((latent*0.65+action*0.35)*100)/100);
  const primaryBlocker=[...blockers].sort((a,b)=>Math.abs(b.penalty)-Math.abs(a.penalty))[0]?.label||null;
  return {
    latentFitScore:latent,actionabilityScore:action,overallScore:overall,primaryTrack:primary,
    components,blockers,softGaps,firstSeenBySystem:o.first_seen_at||null,officialPostedDate:o.source_date||null,
    freshnessBasis:freshness.basis,isOfficiallyNew:freshness.officiallyNew,
    explanation:{latent: Object.entries(components).filter(([,x])=>x&&typeof x.score==='number').map(([k,x])=>`+${x.score}/${x.max} ${k}: ${Array.isArray(x.evidence)?x.evidence.join('; '):x.evidence}`),
      actionability:[`Starts from latent fit ${latent}`,...adjustments],primary_blocker:primaryBlocker}
  };
}

export function buildScenarios(profile){
  return {
    CURRENT:{...profile},
    ARRIVED:{...profile,current_status:'Germany',enrollment_status:'NOT_ENROLLED'},
    ENROLLED_B1:{...profile,current_status:'Germany',enrollment_status:'ENROLLED',german_level:'B1',target_german_level:'B1'},
    ENROLLED_B2:{...profile,current_status:'Germany',enrollment_status:'ENROLLED',german_level:'B2',target_german_level:'B2'}
  };
}

export function profileHash(profile){
  const stable={current_status:profile.current_status,expected_move:profile.expected_move,target_university:profile.target_university,
    enrollment_status:profile.enrollment_status,german_level:profile.german_level,target_german_level:profile.target_german_level,timezone:profile.timezone};
  return hash(JSON.stringify(stable));
}

export function createRankingPool(){return new Pool(databaseConfig());}

export async function calculateRankings(client,{now=new Date(),persist=true}={}){
  const profile=(await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE')).rows[0];
  const {rows:opportunities}=await client.query(`SELECT o.*,e.company_name,
    COALESCE((SELECT CASE min(CASE ms.priority_tier WHEN 'S' THEN 1 WHEN 'A' THEN 2 ELSE 3 END) WHEN 1 THEN 'S' WHEN 2 THEN 'A' ELSE 'OTHER' END
      FROM opportunity_sources os JOIN monitored_sources ms USING(monitored_source_id) WHERE os.opportunity_id=o.opportunity_id),'OTHER') source_tier,
    COALESCE((SELECT max(rhp.observation_count) FROM recurring_hiring_patterns rhp WHERE rhp.employer_id=o.employer_id),0) pattern_observations
    FROM opportunities o JOIN employers e USING(employer_id)
    WHERE EXISTS(SELECT 1 FROM opportunity_sources os WHERE os.opportunity_id=o.opportunity_id)
    ORDER BY o.opportunity_id`);
  const scenarios=buildScenarios(profile); const output={};
  for(const [name,scenario] of Object.entries(scenarios)) output[name]=opportunities.map(o=>({opportunity:o,score:scoreOpportunity(o,scenario,{now})}));
  if(!persist) return {profile,scenarios,output};
  await client.query('BEGIN');
  try{
    await client.query(`INSERT INTO ranking_model_versions(model_version,model_name,latent_dimension_weights,actionability_rules,active)
      VALUES($1,'Explainable personal opportunity ranking v1',$2,$3,TRUE)
      ON CONFLICT(model_version) DO UPDATE SET latent_dimension_weights=EXCLUDED.latent_dimension_weights,actionability_rules=EXCLUDED.actionability_rules,active=TRUE`,
      [MODEL_VERSION,JSON.stringify(DIMENSION_MAXIMA),JSON.stringify(ACTIONABILITY_RULES)]);
    const currentHash=profileHash(profile);
    for(const {opportunity:o,score:s} of output.CURRENT){
      await client.query(`INSERT INTO opportunity_rankings
        (opportunity_id,model_version,profile_hash,latent_fit_score,actionability_score,overall_score,primary_track,
         component_breakdown,blockers,soft_gaps,explanation,freshness_basis,first_seen_by_system,official_posted_date,is_officially_new)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(opportunity_id) DO UPDATE SET model_version=EXCLUDED.model_version,profile_hash=EXCLUDED.profile_hash,calculated_at=now(),
          latent_fit_score=EXCLUDED.latent_fit_score,actionability_score=EXCLUDED.actionability_score,overall_score=EXCLUDED.overall_score,
          primary_track=EXCLUDED.primary_track,component_breakdown=EXCLUDED.component_breakdown,blockers=EXCLUDED.blockers,
          soft_gaps=EXCLUDED.soft_gaps,explanation=EXCLUDED.explanation,freshness_basis=EXCLUDED.freshness_basis,
          first_seen_by_system=EXCLUDED.first_seen_by_system,official_posted_date=EXCLUDED.official_posted_date,is_officially_new=EXCLUDED.is_officially_new`,
        [o.opportunity_id,MODEL_VERSION,currentHash,s.latentFitScore,s.actionabilityScore,s.overallScore,s.primaryTrack,JSON.stringify(s.components),
          JSON.stringify(s.blockers),JSON.stringify(s.softGaps),JSON.stringify(s.explanation),s.freshnessBasis,s.firstSeenBySystem,s.officialPostedDate,s.isOfficiallyNew]);
      const scoreStateHash=hash(JSON.stringify({latent:s.latentFitScore,actionability:s.actionabilityScore,overall:s.overallScore}));
      await client.query(`INSERT INTO opportunity_score_history
        (opportunity_id,model_version,profile_hash,latent_fit_score,actionability_score,overall_score,score_state_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [o.opportunity_id,MODEL_VERSION,currentHash,s.latentFitScore,s.actionabilityScore,s.overallScore,scoreStateHash]);
    }
    for(const [name,rows] of Object.entries(output)) for(const {opportunity:o,score:s} of rows){
      await client.query(`INSERT INTO ranking_scenario_results
        (scenario_name,opportunity_id,model_version,scenario_profile,latent_fit_score,actionability_score,overall_score,primary_track,component_breakdown,blockers,soft_gaps,explanation)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(scenario_name,opportunity_id,model_version) DO UPDATE SET scenario_profile=EXCLUDED.scenario_profile,calculated_at=now(),
          latent_fit_score=EXCLUDED.latent_fit_score,actionability_score=EXCLUDED.actionability_score,overall_score=EXCLUDED.overall_score,
          primary_track=EXCLUDED.primary_track,component_breakdown=EXCLUDED.component_breakdown,blockers=EXCLUDED.blockers,
          soft_gaps=EXCLUDED.soft_gaps,explanation=EXCLUDED.explanation`,
        [name,o.opportunity_id,MODEL_VERSION,JSON.stringify(scenarios[name]),s.latentFitScore,s.actionabilityScore,s.overallScore,s.primaryTrack,
          JSON.stringify(s.components),JSON.stringify(s.blockers),JSON.stringify(s.softGaps),JSON.stringify(s.explanation)]);
    }
    await client.query(`DELETE FROM opportunity_rankings WHERE model_version=$1 AND NOT(opportunity_id=ANY($2::bigint[]))`,[MODEL_VERSION,opportunities.map(x=>x.opportunity_id)]);
    await client.query(`DELETE FROM ranking_scenario_results WHERE model_version=$1 AND NOT(opportunity_id=ANY($2::bigint[]))`,[MODEL_VERSION,opportunities.map(x=>x.opportunity_id)]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  return {profile,scenarios,output};
}

async function cli(){
  const pool=createRankingPool();const client=await pool.connect();
  try{
    const result=await calculateRankings(client);
    const summary=Object.fromEntries(Object.entries(result.output).map(([name,rows])=>[name,rows.filter(x=>x.opportunity.status==='LIVE'&&!nonRelevant(x.opportunity)).sort((a,b)=>b.score.overallScore-a.score.overallScore).slice(0,10).map(x=>({id:x.opportunity.opportunity_id,company:x.opportunity.company_name,title:x.opportunity.title,latent:x.score.latentFitScore,actionability:x.score.actionabilityScore,overall:x.score.overallScore,blocker:x.score.explanation.primary_blocker}))]));
    console.log(JSON.stringify({modelVersion:MODEL_VERSION,scored:result.output.CURRENT.length,top10ByScenario:summary},null,2));
  }finally{client.release();await pool.end();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) cli().catch(e=>{console.error(e);process.exitCode=1;});
