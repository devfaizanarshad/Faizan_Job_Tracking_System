import process from 'node:process';
import { createPool } from './phase2c-engine.js';
import { calculateRankings } from './ranking-engine.js';
import { refreshHistoricalIntelligence } from './historical-intelligence-engine.js';

const allowed = new Map([
  ['current-status','current_status'],['expected-move','expected_move'],['target-university','target_university'],
  ['enrollment-status','enrollment_status'],['german-level','german_level'],
  ['target-german-level','target_german_level'],['timezone','timezone']
]);
const changes=[];
for(const raw of process.argv.slice(2)){
  const match=raw.match(/^--([^=]+)=(.*)$/);
  if(match && allowed.has(match[1])) changes.push([allowed.get(match[1]),match[2]]);
}
const pool=createPool(); const client=await pool.connect();
try{
  await client.query('BEGIN');
  for(const [column,value] of changes) await client.query(`UPDATE monitoring_profile SET ${column}=$1,updated_at=now() WHERE profile_id=TRUE`,[value]);
  const profile=(await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE')).rows[0];
  const enrolled=profile.enrollment_status==='ENROLLED';
  await client.query(`UPDATE opportunities SET
    eligibility_status=CASE WHEN $1 THEN 'ELIGIBLE_NOW' ELSE 'ENROLLMENT_REQUIRED' END,
    alert_class=CASE WHEN latent_fit_class='NOT_RELEVANT' THEN 'NOT_RELEVANT' WHEN $1 THEN latent_fit_class ELSE 'MARKET_SIGNAL' END
    WHERE enrollment_requirement IS NOT NULL OR opportunity_type ~* 'Werkstudent|Working Student|Student Assistant|HiWi|Internship|Praktikum|Thesis|Abschlussarbeit'`,[enrolled]);
  await client.query('COMMIT');
  const rankings=await calculateRankings(client);
  const history=await refreshHistoricalIntelligence(client);
  console.log(JSON.stringify({profile,rankingsRecalculated:rankings.output.CURRENT.length,historicalEmployersRefreshed:history.employers},null,2));
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
