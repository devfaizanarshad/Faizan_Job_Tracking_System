import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPool, generateDailyDigest } from './phase2c-engine.js';
import { calculateRankings } from './ranking-engine.js';
import { refreshHistoricalIntelligence } from './historical-intelligence-engine.js';
import { deriveOpportunityReadiness, isStudentOpportunity, readinessIsTemporaryBlock } from './profile-readiness.js';

const allowed = new Map([
  ['current-status','current_status'],['expected-move','expected_move'],['target-university','target_university'],
  ['enrollment-status','enrollment_status'],['german-level','german_level'],
  ['target-german-level','target_german_level'],['timezone','timezone'],
  ['planned-semester-start-month','planned_semester_start_month'],['expected-arrival-date','expected_arrival_date'],
  ['employment-authorization-status','employment_authorization_status'],['documentation-status','documentation_status']
]);

const cleanEnrollmentGap = value => {
  const remaining=String(value || '').split(';').map(x=>x.trim()).filter(Boolean)
    .filter(x=>!/^current enrollment is required$|faizan is not yet enrolled/i.test(x));
  return remaining.join('; ') || null;
};

function parseArguments(argv) {
  const changes=[]; let reason='Profile updated through update-profile.js'; let changedBy='PROFILE_CLI';
  for(const raw of argv){
    const match=raw.match(/^--([^=]+)=(.*)$/);
    if(!match) continue;
    if(match[1]==='reason') reason=match[2];
    else if(match[1]==='changed-by') changedBy=match[2];
    else if(allowed.has(match[1])) changes.push([allowed.get(match[1]),match[2] || null]);
  }
  return {changes,reason,changedBy};
}

export async function applyProfileUpdate(client,changes,{reason,changedBy='PROFILE_CLI'}={}) {
  if(!changes.length) throw new Error('No recognized profile changes were supplied');
  await client.query('BEGIN');
  try{
    const previous=(await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE FOR UPDATE')).rows[0];
    let changed=false;
    for(const [column,value] of changes){
      const updated=await client.query(`UPDATE monitoring_profile SET ${column}=$1,updated_at=now()
        WHERE profile_id=TRUE AND ${column} IS DISTINCT FROM $1 RETURNING profile_id`,[value]);
      changed ||= updated.rowCount>0;
    }
    const profile=(await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE')).rows[0];
    if(changed){
      await client.query(`INSERT INTO monitoring_profile_history(changed_by,change_reason,previous_profile,new_profile)
        VALUES($1,$2,$3,$4)`,[changedBy,reason || 'Profile update',previous,profile]);
    }

    const {rows:opportunities}=await client.query(`SELECT * FROM opportunities
      WHERE enrollment_requirement IS NOT NULL
         OR opportunity_type ~* 'Werkstudent|Working Student|Student Assistant|HiWi|Internship|Praktikum|Thesis|Abschlussarbeit'
         OR employment_type ~* 'Student'`);
    let reclassified=0;
    for(const opportunity of opportunities){
      if(!isStudentOpportunity(opportunity)) continue;
      const cleanedGap=cleanEnrollmentGap(opportunity.missing_requirements);
      const readiness=deriveOpportunityReadiness({...opportunity,missing_requirements:cleanedGap},profile);
      const latentClass=opportunity.latent_fit_class || opportunity.alert_class || 'NOT_RELEVANT';
      const alertClass=latentClass==='NOT_RELEVANT' ? 'NOT_RELEVANT'
        : readiness==='ENROLLMENT_REQUIRED' ? 'MARKET_SIGNAL' : latentClass;
      const urgency=readinessIsTemporaryBlock(readiness) ? 'PREPARE_FOR_FUTURE'
        : alertClass==='EXCEPTIONAL_MATCH' ? 'ACT_WITHIN_48_HOURS'
        : alertClass==='STRONG_MATCH' ? 'ACT_THIS_WEEK'
        : alertClass==='NOT_RELEVANT' ? 'IGNORE' : 'MONITOR';
      await client.query(`UPDATE opportunities SET eligibility_status=$2,alert_class=$3,monitoring_urgency=$4,
        missing_requirements=$5 WHERE opportunity_id=$1`,[opportunity.opportunity_id,readiness,alertClass,urgency,cleanedGap]);
      reclassified++;
    }
    await client.query('COMMIT');
    return {previous,profile,reclassified};
  }catch(error){await client.query('ROLLBACK');throw error;}
}

async function cli(){
  const {changes,reason,changedBy}=parseArguments(process.argv.slice(2));
  const pool=createPool(); const client=await pool.connect();
  try{
    const update=await applyProfileUpdate(client,changes,{reason,changedBy});
    const rankings=await calculateRankings(client);
    const history=await refreshHistoricalIntelligence(client);
    const digest=await generateDailyDigest(client);
    console.log(JSON.stringify({previousProfile:update.previous,profile:update.profile,
      opportunitiesReclassified:update.reclassified,rankingsRecalculated:rankings.output.CURRENT.length,
      historicalEmployersRefreshed:history.employers,digest:{...digest,content:undefined}},null,2));
  }finally{client.release();await pool.end();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))
  cli().catch(error=>{console.error(error);process.exitCode=1;});
