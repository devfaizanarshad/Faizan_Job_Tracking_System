import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';
import { databaseConfig } from './database-config.js';

const {Pool}=pg;
const pool=new Pool(databaseConfig());
const esc=v=>String(v??'—').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const table=(headers,rows)=>[`| ${headers.join(' | ')} |`,`|${headers.map(()=>'---').join('|')}|`,...rows.map(row=>`| ${row.map(esc).join(' | ')} |`)].join('\n');
const n=v=>Number(v||0);
const score=v=>`${n(v).toFixed(0)}/100`;
const date=v=>v?new Date(v).toISOString().slice(0,10):'UNKNOWN';

try{
  const q=async(sql,params=[])=>(await pool.query(sql,params)).rows;
  const [activity,fit,watch,families,tech,language,lifetimes,trends,insufficient,snapshot,student,confidence,profile,scoreCount]=await Promise.all([
    q('SELECT * FROM v_employer_activity LIMIT 10'),q('SELECT * FROM v_employer_faizan_fit_history LIMIT 10'),q('SELECT * FROM v_employer_watch_priority LIMIT 10'),
    q('SELECT * FROM v_role_family_trends LIMIT 15'),q('SELECT * FROM v_technology_demand LIMIT 15'),q('SELECT * FROM v_language_intelligence WHERE relevant_vacancies_observed>0 LIMIT 15'),
    q('SELECT company_name,title,observed_lifetime_days,lifetime_confidence,closure_evidence_valid,first_confirmed_live_at,removed_at FROM v_vacancy_lifetime WHERE closure_evidence_valid ORDER BY observed_lifetime_days'),
    q("SELECT e.company_name,t.trend_type,t.current_count,t.direction,t.confidence,t.observed_statement FROM employer_trend_observations t JOIN employers e USING(employer_id) WHERE t.current_count>0 ORDER BY t.confidence DESC,t.current_count DESC LIMIT 15"),
    q('SELECT * FROM v_insufficient_history'),q('SELECT * FROM v_market_snapshot_latest'),
    q(`SELECT e.company_name,m.student_opportunities,m.werkstudent_opportunities,m.hiwi_research_opportunities,m.internship_thesis_opportunities,m.enrollment_required_opportunities,m.confidence FROM employer_historical_metrics m JOIN employers e USING(employer_id) WHERE m.student_opportunities>0 ORDER BY m.student_opportunities DESC,e.company_name LIMIT 15`),
    q(`SELECT confidence,count(*)::int employers FROM employer_historical_metrics GROUP BY confidence ORDER BY confidence`),
    q('SELECT current_status,enrollment_status,german_level,target_german_level FROM monitoring_profile WHERE profile_id=TRUE'),
    q('SELECT count(*)::int n FROM opportunity_score_history')
  ]);
  const snap=snapshot[0]||{};
  const tests=await fs.readFile(path.resolve('..','reports','phase2e_test_results_2026-09-04.md'),'utf8');
  const files=[
    'db/phase2e_schema.sql','db/load_phase2e.sql','db/export_phase2e.sql',
    'monitor/historical-intelligence-engine.js','monitor/phase2e-tests.js','monitor/generate-phase2e-report.js',
    'monitor/ranking-engine.js','monitor/automate-run.js','monitor/update-profile.js','monitor/package.json','monitor/package-lock.json','README.md',
    'reports/phase2e_test_results_2026-09-04.md','reports/phase2e_historical_intelligence_2026-09-04.md','exports/phase2e_*.csv',
    'exports/faizan_employer_intelligence_phase2e_2026-09-04.backup','exports/faizan_employer_intelligence_phase2e_2026-09-04.sql'
  ];
  const lines=[
    '# Phase 2E — historical hiring and employer intelligence','',
    `Generated: ${new Date().toISOString()}`,'',
    `Latest immutable daily snapshot: **${date(snap.snapshot_date)}** with **${snap.total_live_opportunities||0}** live, **${snap.relevant_live_opportunities||0}** relevant, **${snap.strong_live_opportunities||0}** strong-match, and **${snap.student_live_opportunities||0}** student opportunities. Evidence window: **${date(snap.observation_period_start)} to ${date(snap.observation_period_end)}**.`,'',
    '> Evidence warning: the monitoring history spans roughly one day. Baseline discoveries show that roles were visible; they are not treated as newly posted. Scores describe observed evidence and do not predict future hiring.','',
    '## 1. Schema and migrations','',
    'The Phase 2E migration adds immutable score history, canonical lifecycle records, multi-label role-family evidence, language observations, employer history and intelligence scores, technology demand, conservative trends, and append-only daily market snapshots. It also creates all ten requested reporting views.','',
    'Apply with `db/load_phase2e.sql`. Existing Phase 2A–2D tables and behavior are preserved.','',
    '## 2. Historical intelligence architecture','',
    'The refresh reads canonical opportunities, snapshots, change events, monitoring coverage, and Phase 2D rankings. It validates closures, reconstructs lifecycles, aggregates evidence by canonical opportunity and employer, then attempts one immutable snapshot per date. Scheduled monitoring and profile updates refresh this layer after rankings.','',
    `Score-history states preserved: **${scoreCount[0]?.n||0}**. Current profile remains **${profile[0]?.current_status||'UNKNOWN'} / ${profile[0]?.enrollment_status||'UNKNOWN'} / German ${profile[0]?.german_level||'UNKNOWN'} (target ${profile[0]?.target_german_level||'UNKNOWN'})**.`,'',
    '## 3. Employer metrics — top observed activity','',
    table(['Employer','Activity','Breadth points','Post-baseline recency points','Span days','Coverage','Confidence'],activity.map(r=>[r.company_name,score(r.employer_activity_score),r.activity_components?.distinct_relevant_observed??0,r.activity_components?.recent_nonbaseline_discoveries??0,r.observation_span_days,`${Math.round(n(r.source_success_ratio)*100)}%`,r.confidence])),'',
    'Activity and fit are separate. High activity values can reflect broad baseline evidence, repeated student routes, and repeated role families; they are not a posting-rate estimate.','',
    '### Top employers by Faizan-relevant history','',
    table(['Employer','History score','Fit score','Confidence'],fit.map(r=>[r.company_name,score(r.faizan_opportunity_history_score),score(r.employer_fit_score),r.confidence])),'',
    '## 4. Role-family intelligence','',
    table(['Role family','Opportunities','Employers','Student','Strong match','Explicit English','Confidence'],families.map(r=>[r.role_family,r.opportunities,r.employers,r.student_opportunities,r.strong_faizan_matches,r.explicit_english_opportunities,r.confidence])),'',
    'Role families are multi-label and require vacancy title or requirement evidence; totals therefore do not sum to the number of canonical opportunities.','',
    '## 5. Technology intelligence','',
    table(['Technology','Snapshot mentions','Canonical opportunities','Employers','Student roles','Strong matches','Status'],tech.map(r=>[r.technology,r.total_observed_mentions,r.distinct_opportunities,r.distinct_employers,r.student_role_opportunities,r.strong_match_opportunities,r.evidence_status])),'',
    'Only explicit vacancy-level technology mentions are counted. Absence is unknown, not evidence that an employer does not use a technology. Repeated snapshots affect observed mentions but not canonical-opportunity counts.','',
    '## 6. Language intelligence','',
    table(['Employer','Observed statement','German required','Strongest threshold','Student + English','Confidence'],language.map(r=>[r.company_name,r.observation_statement,r.german_required_roles,r.strongest_german_threshold||'UNKNOWN',r.student_roles_with_english_evidence,r.confidence])),'',
    'These are vacancy-level observations. No employer is labeled globally “English-friendly.” Exact source evidence remains in lifecycle and language-observation tables.','',
    '## 7. Vacancy lifetime results','',
    lifetimes.length?table(['Employer','Role','Observed days','First confirmed','Removed','Confidence'],lifetimes.map(r=>[r.company_name,r.title,r.observed_lifetime_days,date(r.first_confirmed_live_at),date(r.removed_at),r.lifetime_confidence])):'No vacancy has valid closure evidence.','',
    'Observed lifetime is the minimum window between first confirmed live and a valid closure signal; it is not an official posting-to-closing duration. Employer medians remain unavailable until at least three confident lifetimes exist. Temporary fetch failures never close a role.','',
    '## 8. Watch-priority ranking','',
    table(['Employer','Watch','Activity','Fit','History','Confidence'],watch.map(r=>[r.company_name,score(r.watch_priority_score),score(r.employer_activity_score),score(r.employer_fit_score),score(r.faizan_opportunity_history_score),r.confidence])),'',
    'Watch priority combines Faizan-relevant history, observed activity, valid post-baseline recency, and student-route evidence. Company prestige is not an input.','',
    '### Student hiring evidence','',
    table(['Employer','Student','Werkstudent','HiWi/research','Intern/thesis','Enrollment evidence','Confidence'],student.map(r=>[r.company_name,r.student_opportunities,r.werkstudent_opportunities,r.hiwi_research_opportunities,r.internship_thesis_opportunities,r.enrollment_required_opportunities,r.confidence])),'',
    '## 9. Confidence methodology','',
    'Employer history is HIGH only with at least 12 relevant roles, 90 observed days, and 80% successful source coverage; MEDIUM requires 6/60 days/70%; LOW requires 3/14 days. Trend confidence independently requires both count and elapsed time, with HIGH requiring at least 12 observations over 120 days. Lifecycle fields use KNOWN, OBSERVED, UNKNOWN, or INSUFFICIENT_DATA according to direct evidence.','',
    table(['Employer confidence','Count'],confidence.map(r=>[r.confidence,r.employers])),'',
    '## 10. Current observed trends','',
    table(['Employer','Signal','Count','Direction','Confidence','Conservative statement'],trends.map(r=>[r.company_name,r.trend_type,r.current_count,r.direction,r.confidence,r.observed_statement])),'',
    'No increasing/decreasing claim is supported yet. In particular, baseline counts are excluded from the recent-activity trend signal.','',
    '## 11. Insufficient-data findings','',
    `**${insufficient.length} of ${confidence.reduce((s,r)=>s+n(r.employers),0)} monitored employers** currently have insufficient longitudinal history.`,'',
    table(['Employer','Span days','Canonical opportunities','Relevant','Reason'],insufficient.slice(0,15).map(r=>[r.company_name,r.observation_span_days,r.total_unique_opportunities,r.relevant_opportunities,r.reason])),'',
    'This is expected and correct: the system has breadth from its baseline but not enough elapsed monitoring time to establish frequency, directional change, robust vacancy lifetimes, or predictive patterns.','',
    '## 12. Validation PASS/FAIL','',tests,'',
    '## 13. Files created or modified','',...files.map(x=>`- \`${x}\``),'',
    '### Database backup path','',
    `\`${path.join(runtimePaths.exportDir,'faizan_employer_intelligence_phase2e_2026-09-04.backup')}\``,'',
    `Plain SQL companion: \`${path.join(runtimePaths.exportDir,'faizan_employer_intelligence_phase2e_2026-09-04.sql')}\`.`,'',
    '## Stop point','',
    'Phase 2E stops here. No dashboard, AWS deployment, Phase 2F, CV generation, application/interview tracking, outreach, automatic applications, or predictive hiring claims were added.'
  ];
  const output=path.resolve('..','reports','phase2e_historical_intelligence_2026-09-04.md');
  await fs.writeFile(output,lines.join('\n'),'utf8');
  console.log(output);
}finally{await pool.end();}
