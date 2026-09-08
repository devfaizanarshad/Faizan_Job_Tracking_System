import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ACTIONABILITY_RULES, DIMENSION_MAXIMA, MODEL_VERSION } from './ranking-engine.js';
import { databaseConfig } from './database-config.js';

const {Pool}=pg;
const pool=new Pool(databaseConfig());
const client=await pool.connect();
const esc=v=>String(v??'').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const link=(label,url)=>url?`[${esc(label)}](${url})`:esc(label);
const table=(headers,rows)=>[`| ${headers.join(' | ')} |`,`|${headers.map(()=>'---').join('|')}|`,...rows.map(row=>`| ${row.map(esc).join(' | ')} |`)].join('\n');
const breakdown=r=>Object.entries(r.component_breakdown||{}).filter(([,v])=>v&&typeof v.score==='number').map(([k,v])=>`+${v.score}/${v.max} ${k.replaceAll('_',' ')}`).join('; ');
const actionBreakdown=r=>(r.explanation?.actionability||[]).join('; ');
try{
  const current=(await client.query('SELECT * FROM v_top_current_actionable LIMIT 10')).rows;
  const future=(await client.query('SELECT * FROM v_top_future LIMIT 10')).rows;
  const overall=(await client.query('SELECT * FROM v_top_10_overall')).rows;
  const scenarios=(await client.query(`WITH ranked AS (
    SELECT s.scenario_name,s.opportunity_id,s.latent_fit_score,s.actionability_score,s.overall_score,
      s.explanation,e.company_name,o.title,o.job_url,
      row_number() OVER(PARTITION BY s.scenario_name ORDER BY s.overall_score DESC,s.latent_fit_score DESC,s.opportunity_id) rank
    FROM ranking_scenario_results s JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id)
    WHERE s.model_version=$1 AND o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT')
    SELECT * FROM ranked WHERE rank<=10 ORDER BY scenario_name,rank`,[MODEL_VERSION])).rows;
  const blockerRows=(await client.query(`SELECT b->>'kind' kind,count(DISTINCT r.opportunity_id)::int n
    FROM opportunity_rankings r JOIN opportunities o USING(opportunity_id)
    CROSS JOIN LATERAL jsonb_array_elements(r.blockers)b
    WHERE r.latent_fit_score>=70 AND o.status='LIVE' GROUP BY b->>'kind'`)).rows;
  const severityRows=(await client.query(`SELECT b->>'severity' severity,count(*)::int n
    FROM opportunity_rankings r JOIN opportunities o USING(opportunity_id)
    CROSS JOIN LATERAL jsonb_array_elements(r.blockers)b WHERE r.latent_fit_score>=70 AND o.status='LIVE'
    GROUP BY b->>'severity'`)).rows;
  const counts=(await client.query(`SELECT count(*)::int scored,count(*) FILTER(WHERE official_posted_date IS NULL)::int official_unknown,
    count(*) FILTER(WHERE is_officially_new)::int officially_new FROM opportunity_rankings`)).rows[0];
  const tests=await fs.readFile(path.resolve('..','reports','phase2d_test_results_2026-09-04.md'),'utf8');
  const blockerCounts={enrollment:0,arrival:0,German:0,seniority:0,other:0,...Object.fromEntries(blockerRows.map(x=>[x.kind,x.n]))};
  const severity=Object.fromEntries(severityRows.map(x=>[x.severity,x.n]));
  const scenarioNames=['CURRENT','ARRIVED','ENROLLED_B1','ENROLLED_B2'];
  const scenarioMap=Object.fromEntries(scenarioNames.map(name=>[name,scenarios.filter(x=>x.scenario_name===name)]));
  const scenarioComparison=Array.from({length:10},(_,i)=>[String(i+1),...scenarioNames.map(name=>{
    const r=scenarioMap[name][i];return r?`${r.company_name}: ${r.title} (${r.latent_fit_score}/${r.actionability_score})`:'—';
  })]);
  const dimensionDescriptions={
    technical_fit:'Stored, evidence-based technical match (0–3) normalized without keyword-count inflation.',
    demonstrated_project_overlap:'Only named overlap with Chargerzilla, GeoFenceTrack, BrandedUK, or Digi2S evidence.',
    strategic_role_relevance:'Backend, full stack, data, GIS, security, cloud, QA, then technical research; generic roles score lower.',
    role_type_and_seniority:'Relevant student/junior suitability plus limited recurring-hiring evidence; senior roles score poorly.',
    academic_student_relevance:'Technical Werkstudent/HiWi/thesis and MSc-relevant GIS/security/research value.',
    location_work_model:'Lübeck first, then Bad Oldesloe/Ahrensburg/Hamburg and useful remote/hybrid arrangements.',
    language_compatibility:'Exact language bucket; explicit English receives full credit, unknown evidence does not.',
    employer_quality:'Small S/A source-tier contribution that cannot override role fit.',
    freshness:'Official posting date when known; otherwise lower first-seen-only credit with no “newly posted” claim.'
  };
  const files=[
    'db/phase2d_schema.sql (new)','db/load_phase2d.sql (new)','db/export_phase2d.sql (new)',
    'monitor/ranking-engine.js (new)','monitor/phase2d-tests.js (new)','monitor/generate-phase2d-report.js (new)',
    'monitor/automate-run.js (modified: refresh ranking after monitoring)','monitor/update-profile.js (modified: refresh after profile change)',
    'monitor/package.json and package-lock.json (modified)','README.md (modified)',
    'reports/phase2d_test_results_2026-09-04.md (generated)','reports/phase2d_ranking_decision_engine_2026-09-04.md (generated)',
    'exports/phase2d_*.csv (generated)','exports/faizan_employer_intelligence_phase2d_2026-09-04.backup/.sql (generated)'
  ];
  const currentRows=current.map(r=>[r.company_name,link(r.title,r.job_url),r.primary_track,`${r.latent_fit_score}/100`,`${r.actionability_score}/100`,breakdown(r),actionBreakdown(r),r.explanation?.primary_blocker||'None']);
  const futureRows=future.map(r=>[r.company_name,link(r.title,r.job_url),r.primary_track,`${r.latent_fit_score}/100`,`${r.actionability_score}/100`,breakdown(r),actionBreakdown(r),r.explanation?.primary_blocker||'None']);
  const lines=['# Phase 2D — personal opportunity ranking and decision engine','',`Generated: ${new Date().toISOString()}`,'',
    `Model: **${MODEL_VERSION}**. Opportunities scored: **${counts.scored}**. Official posting date unknown: **${counts.official_unknown}**; officially posted within seven days: **${counts.officially_new}**.`,'',
    '## Scoring model','',
    'LATENT_FIT_SCORE asks how valuable the role would be after temporary timing/enrollment blockers disappear. Its nine capped dimensions total exactly 100 points. ACTIONABILITY_SCORE starts from latent fit and applies current-profile blockers and deadline adjustments; hard blockers cap actionability at 20. OVERALL_SCORE is 65% latent fit and 35% actionability.','',
    table(['Dimension','Maximum','Evidence rule'],Object.entries(DIMENSION_MAXIMA).map(([k,v])=>[k.replaceAll('_',' '),`${v} points`,dimensionDescriptions[k]])),'',
    'Actionability adjustments:','',...Object.entries(ACTIONABILITY_RULES).map(([k,v])=>`- ${k.replaceAll('_',' ')}: ${v>0?'+':''}${v}`),'',
    'Hard blockers: known language above current/target level, academic ineligibility, seniority mismatch, passed deadline, or closed status. Temporary blockers: enrollment, arrival, and start timing. Soft gaps: missing technology/domain evidence, unknown eligibility/work authorization, unspecified German level, or unclear location. Latent fit remains visible even when actionability is low.','',
    '## Top 10 current actionable','',
    `Only **${current.length}** live roles currently qualify without a hard or temporary blocker; the system does not pad the list to ten.`,'',
    table(['Employer','Role','Track','Latent','Actionability','Latent breakdown','Actionability breakdown','Why not / gap'],currentRows),'',
    '## Top 10 future','',
    table(['Employer','Role','Track','Latent','Actionability','Latent breakdown','Actionability breakdown','Primary blocker'],futureRows),'',
    '## Top 10 overall','',
    table(['Rank','Employer','Role','Latent','Actionability','Overall'],overall.map((r,i)=>[i+1,r.company_name,link(r.title,r.job_url),r.latent_fit_score,r.actionability_score,r.overall_score])),'',
    '## Scenario comparison','',
    'Each cell shows `latent/actionability`. Scenario calculation writes only to the separate scenario-results table; `monitoring_profile` is not changed.','',
    table(['Rank','CURRENT','ARRIVED','ENROLLED_B1','ENROLLED_B2'],scenarioComparison),'',
    '## Biggest blockers','',
    'Counts below cover live opportunities with latent fit ≥70. One role can have more than one blocker.','',
    table(['Blocker','Strong opportunities'],[['Enrollment',blockerCounts.enrollment],['Arrival',blockerCounts.arrival],['German',blockerCounts.German],['Seniority',blockerCounts.seniority],['Other / eligibility uncertainty',blockerCounts.other]]),'',
    `By severity: hard **${severity.HARD||0}**, temporary **${severity.TEMPORARY||0}**, soft **${severity.SOFT||0}**.`,'',
    '## Validation','',tests,'',
    '## Database changes','',
    '- Tables: `ranking_model_versions`, `opportunity_rankings`, `ranking_scenario_results`.',
    '- Views: `v_ranked_live_opportunities`, `v_top_current_actionable`, `v_top_future`, `v_top_10_overall`, `v_top_backend`, `v_top_data`, `v_top_gis`, `v_top_security`, `v_top_student`, `v_top_english_friendly`.',
    '- Migration: `db/load_phase2d.sql` → `db/phase2d_schema.sql`.',
    '- Existing monitoring, alerts, source health, and production profile rows were not replaced.','',
    '## Files','',...files.map(x=>`- ${x}`),'',
    '## Stop point','',
    'Phase 2D stops here. No dashboard, AWS deployment, application tracking, CV generation, interview tracking, outreach, or automatic applications were added. Phase 2E was not started.'
  ];
  const output=path.resolve('..','reports','phase2d_ranking_decision_engine_2026-09-04.md');
  await fs.writeFile(output,lines.join('\n'),'utf8');
  console.log(output);
}finally{client.release();await pool.end();}
