import crypto from 'node:crypto';
import process from 'node:process';
import * as cheerio from 'cheerio';
import pg from 'pg';
import { productionLog } from './structured-log.js';
import { databaseConfig } from './database-config.js';

const { Pool } = pg;
const TOOL_VERSION = '0.3.0';
const USER_AGENT = 'FaizanOpportunityMonitor/0.1 (+personal low-frequency employment research)';
const REQUEST_TIMEOUT_MS = 25000;
const DETAIL_LIMIT_PER_SOURCE = 15;
const REQUEST_GAP_MS = Number(process.env.MONITOR_REQUEST_GAP_MS || 350);
let FAIZAN_ENROLLED = false;
let FAIZAN_PROFILE = null;
const MONITOR_LOCK_KEY = 24020301;

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const requestedMode = [...args].find(x => x.startsWith('--mode='))?.split('=')[1]?.toUpperCase();
const tiers = ([...args].find(x => x.startsWith('--tiers='))?.split('=')[1] || 'S')
  .split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const sourceLimit=Math.max(0,Number(process.env.MONITOR_SOURCE_LIMIT||0));

const pool = new Pool(databaseConfig({max:4}));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalText = value => clean(value).toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(m\/w\/d|w\/m\/d|f\/m\/d|d\/f\/m|all genders|mwd)\b/g, '')
  .replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const absoluteUrl = (href, base) => { try { return new URL(href, base).toString(); } catch { return null; } };
const normalizedUrl = value => {
  try {
    const u = new URL(value);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
    const params = [...u.searchParams.entries()].filter(([k]) => !['language','view'].includes(k)).sort();
    return `${u.hostname.toLowerCase()}${path}?${new URLSearchParams(params).toString()}`.replace(/\?$/, '');
  } catch { return String(value || '').replace(/\/$/, '').toLowerCase(); }
};
const uniq = values => [...new Set(values.filter(Boolean))];
const excerpt = (value, max = 1200) => clean(value).slice(0, max);

const STUDENT_RE = /werkstudent|working student|student trainee|studentische|student assistant|hilfskraft|hiwi|praktikum|internship|intern\b|thesis|abschlussarbeit/i;
const EVERGREEN_RE = /initiativ|unsolicited|speculative/i;
const TECH_RE = /software|informatik|computer|backend|frontend|full.?stack|data|daten|database|sql|postgres|gis|geo|spatial|mapping|routing|security|sicherheit|cyber|cloud|devops|api|automation|automatisierung|programm|react|typescript|javascript|python|java|spring|iot|ticketing|image|bild|digital/i;
const CLOSED_RE = /posting has now closed|job posting is offline|stelle(?:nanzeige)? ist .*abgelaufen|keine bewerbungen mehr|job (?:is )?closed|vacancy (?:is )?closed/i;
const SENIOR_RE = /\b(?:senior|lead|principal|staff|head|director|manager|architect)\b/i;
const LISTING_ADAPTERS = new Set(['hansecom_list','singularit_list','personio_list','fraunhofer_list','drager_list','university_page','generic_official_list','schema_datafeed','ashby_feed','greenhouse_feed','workday_feed']);

function matchesSourceScope(source, text) {
  const pattern=source.metadata?.filter_location;
  return !pattern || new RegExp(pattern,'i').test(text);
}

function relevantCandidate(title, context='') {
  if (STUDENT_RE.test(title)) return true;
  if (SENIOR_RE.test(title)) return false;
  const text=`${title} ${context}`;
  if (STUDENT_RE.test(context) && TECH_RE.test(title)) return true;
  return TECH_RE.test(title) && !SENIOR_RE.test(title);
}

function parseDate(text, labelPattern = '') {
  const prefix = labelPattern ? `(?:${labelPattern})[^0-9]{0,20}` : '';
  const de = text.match(new RegExp(`${prefix}(\\d{1,2})[.]([01]?\\d)[.](20\\d{2})`, 'i'));
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  const iso = text.match(new RegExp(`${prefix}(20\\d{2})-(\\d{2})-(\\d{2})`, 'i'));
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function extractSentences(text, regex, limit = 4) {
  return uniq(text.split(/(?<=[.!?])\s+|\s*[\n\r]+\s*/).map(clean).filter(x => regex.test(x))).slice(0, limit);
}

function languageEvidence(text, detailed) {
  if (!detailed) return { bucket: 'UNKNOWN', germanRaw: null, englishRaw: null };
  const requirementCue = /kenntnis|kenntnisse|skills|command|language|required|requirement|sprich|sprachniveau|fließend|fliessend|fluent|good|gute|sehr gute|sicher in wort|mindestens|minimum|niveau|oder englisch|or english/i;
  const snippets = term => uniq([...text.matchAll(new RegExp(`.{0,100}(?:${term}).{0,130}`, 'gi'))].map(x => clean(x[0])));
  const german = snippets('deutsch|german').filter(x => requirementCue.test(x)).slice(0,3);
  const english = snippets('englisch|english').filter(x => requirementCue.test(x)).slice(0,3);
  const combined = [...german, ...english].join(' ');
  let bucket = 'NO_GERMAN_THRESHOLD_STATED';
  if (/(?:deutsch|german).{0,50}C2(?![0-9])|C2(?![0-9]).{0,50}(?:deutsch|german)/i.test(text)) bucket = 'C2';
  else if (/(?:deutsch|german).{0,50}C1(?![0-9])|C1(?![0-9]).{0,50}(?:deutsch|german)/i.test(text)) bucket = 'C1';
  else if (/(?:deutsch|german).{0,50}B2(?![0-9])|B2(?![0-9]).{0,50}(?:deutsch|german)/i.test(text)) bucket = 'B2';
  else if (/(?:deutsch|german).{0,50}B1(?![0-9])|B1(?![0-9]).{0,50}(?:deutsch|german)/i.test(text)) bucket = 'B1';
  else if (/(?:deutsch|german).{0,50}A2(?![0-9])|A2(?![0-9]).{0,50}(?:deutsch|german)/i.test(text)) bucket = 'A2';
  else if (/(deutsch|german).{0,35}\boder\b.{0,20}(englisch|english)|(german|deutsch)\s+or\s+(english|englisch)|(english|englisch).{0,80}(german|deutsch).{0,30}(plus|beneficial|advantage|not necessary|nicht erforderlich)/i.test(combined)) bucket = 'ENGLISH_EXPLICITLY_ACCEPTED';
  else if (german.length) bucket = 'GERMAN_REQUIRED_UNSPECIFIED_LEVEL';
  return { bucket, germanRaw: excerpt(german.join(' | '),500) || null, englishRaw: excerpt(english.join(' | '),500) || null };
}

function detectTechnologies(text) {
  const catalog = [
    ['TypeScript', /\btypescript\b/i], ['JavaScript', /\bjavascript\b/i], ['React', /\breact(?:\.js)?\b/i],
    ['Next.js', /\bnext\.?js\b/i], ['Node.js', /\bnode\.?js\b/i], ['Express', /\bexpress\.?js\b/i],
    ['Python', /\bpython\b/i], ['Flask', /\bflask\b/i], ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
    ['PostGIS', /\bpostgis\b/i], ['SQL', /\bsql\b/i], ['Redis', /\bredis\b/i], ['AWS', /\baws\b|amazon web services/i],
    ['Docker', /\bdocker\b/i], ['NGINX', /\bnginx\b/i], ['REST', /\brest(?:ful)?\b/i],
    ['Java', /\bjava\b/i], ['Spring Boot', /\bspring boot\b/i], ['QGIS', /\bqgis\b/i],
    ['ArcGIS', /\barcgis\b/i], ['OpenStreetMap', /openstreetmap|\bOSM\b/], ['GTFS', /\bGTFS\b/],
    ['Linux', /\blinux\b/i], ['Power BI', /\bpower\s*bi\b/i], ['C++', /\bc\+\+\b/i],
    ['Julia', /\bjulia\b/i], ['gRPC', /\bgrpc\b/i], ['SQLite', /\bsqlite\b/i], ['RISC-V', /\brisc-v\b/i]
  ];
  return catalog.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function classifyRole(title, text) {
  if (/initiativ|unsolicited/i.test(title)) return { opportunityType: 'Evergreen student route', employmentType: 'Student' };
  if (/abschlussarbeit|masterarbeit|bachelorarbeit|thesis/i.test(title) && /praktikum|internship/i.test(title)) return { opportunityType: 'Internship / thesis', employmentType: 'Student' };
  if (/abschlussarbeit|masterarbeit|bachelorarbeit|thesis/i.test(title)) return { opportunityType: 'Thesis', employmentType: 'Student' };
  if (/werkstudent|working student|student trainee/i.test(title)) return { opportunityType: 'Werkstudent', employmentType: 'Student / part-time' };
  if (/studentische|student assistant|hilfskraft|hiwi/i.test(title)) return { opportunityType: 'Student Assistant', employmentType: 'Student / part-time' };
  if (/praktikum|internship|intern\b/i.test(title)) return { opportunityType: 'Internship', employmentType: 'Student' };
  return { opportunityType: 'Other', employmentType: null };
}

function parseDetail(html, url, seed = {}) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  const blocks=$('main,[role="main"],.job-ad,.job-content,.content-wrapper').toArray();
  const main=blocks.sort((a,b)=>clean($(b).text()).length-clean($(a).text()).length)[0];
  const selectedText=main ? clean($(main).text()) : '';
  const bodyText = selectedText.length>=500 ? selectedText : clean($('body').text());
  const h1 = clean($('h1').first().text());
  const title = seed.title || h1 || clean($('title').text()).split('|')[0];
  const pageText = clean(`${title} ${bodyText}`);
  const language = languageEvidence(pageText, true);
  const knownCity = pageText.match(/\b(Lübeck|Hamburg|Stockelsdorf|Ahrensburg|Kiel|Lüneburg|Leipzig|Oldenburg|Berlin|Bremen|Hannover)\b/i);
  const hours = pageText.match(/\b(?:bis zu\s*)?\d{1,2}(?:\s*(?:-|–|bis|to)\s*\d{1,2})?\s*(?:Stunden|Std\.?|hours)(?:\s*\/\s*Woche|\s+pro Woche|\/week)?/i)?.[0] || null;
  const enrollment = excerpt(extractSentences(pageText, /eingeschrieben|immatrik|laufendes studium|befindest dich.{0,60}studium|current(?:ly)? enrolled|ongoing .*stud|engaged in a technical field of study|you (?:are )?studying/i, 3).join(' | '),600) || null;
  const start = pageText.match(/\b(?:ab sofort|as of now|starting as soon as possible|zum \d{1,2}[.]\d{1,2}[.]20\d{2}|start(?:ing)? [^.;]{0,50})/i)?.[0] || null;
  const attendance = extractSentences(pageText, /office days|on.?site attendance|präsenz|anwesenheit|tage.*büro/i, 2).join(' | ') || null;
  let workMode = null;
  if (/hybrid|hybrides arbeiten/i.test(pageText)) workMode = 'Hybrid';
  else if (/mobiles arbeiten|mobile work|homeoffice|remote/i.test(pageText)) workMode = 'Mobile work mentioned';
  else if (/vor ort|on.?site/i.test(pageText)) workMode = 'On-site';
  const department = pageText.match(/(?:Fachbereich|Department|Bereich)\s*:?\s*([A-Za-zÄÖÜäöüß &\/-]{2,70})/i)?.[1]?.trim() || seed.department || null;
  const requirements = extractSentences(pageText, /typescript|javascript|react|next|node|express|python|flask|postgres|postgis|\bsql\b|redis|aws|docker|nginx|rest|java|spring|qgis|arcgis|openstreetmap|gtfs|linux|power bi|c\+\+|julia|grpc|sqlite|risc-v|programmier|softwareentwicklung/i, 12).join(' | ') || null;
  const preferred = extractSentences(pageText, /nice to have|von vorteil|wünschenswert|idealerweise|preferred/i, 6).join(' | ') || null;
  const role = classifyRole(title, pageText);
  return {
    ...seed,
    title,
    url,
    location: seed.location || (knownCity ? knownCity[1] : null),
    department,
    opportunityType: seed.opportunityType || role.opportunityType,
    employmentType: seed.employmentType || role.employmentType,
    postingDate: seed.postingDate || parseDate(pageText, 'Datum|Date|Veröffentlicht|Published'),
    deadline: seed.deadline || parseDate(pageText, 'Bewerbungsfrist|application deadline|apply by'),
    hours,
    workMode: workMode || seed.workMode || null,
    officeAttendance: attendance,
    enrollmentRequirement: enrollment,
    expectedStartDate: start,
    germanRequirementRaw: language.germanRaw,
    englishRequirementRaw: language.englishRaw,
    languageBucket: language.bucket,
    technicalRequirements: requirements,
    preferredRequirements: preferred,
    description: excerpt(pageText, 12000),
    technologies: detectTechnologies(pageText),
    status: CLOSED_RE.test(pageText) ? 'CLOSED' : (seed.evergreen || EVERGREEN_RE.test(title) ? 'EVERGREEN' : 'LIVE_VERIFIED'),
    detailed: true
  };
}

function listingCandidate(title, url, context = '', location = null, extra = {}) {
  const role = classifyRole(title, context);
  return { title: clean(title), url, location, opportunityType: role.opportunityType,
    employmentType: role.employmentType, description: excerpt(context, 2500), technologies: detectTechnologies(context),
    status: extra.evergreen || EVERGREEN_RE.test(title) ? 'EVERGREEN' : 'LIVE_VERIFIED', detailed: false, ...extra };
}

function parseListing(source, html) {
  const $ = cheerio.load(html);
  const candidates = [];
  if (source.adapter === 'hansecom_list') {
    $('a[href*="rexx-systems.com/"]').each((_, a) => {
      const title = clean($(a).text());
      const context = clean($(a).closest('tr,li,article,div').text());
      if (STUDENT_RE.test(`${title} ${context}`)) candidates.push(listingCandidate(title, absoluteUrl($(a).attr('href'), source.source_url), context, /Hamburg/i.test(context) ? 'Hamburg' : null));
    });
  } else if (source.adapter === 'singularit_list') {
    $('.job-offer').each((_, card) => {
      const title = clean($(card).find('a').first().text());
      const context = clean($(card).text());
      const url = absoluteUrl($(card).find('a').first().attr('href'), source.source_url);
      if (STUDENT_RE.test(context) && /Lübeck/i.test(context)) candidates.push(listingCandidate(title, url, context, 'Lübeck'));
    });
  } else if (source.adapter === 'personio_list') {
    $('a[href*="/job/"]').each((_, a) => {
      const title = clean($(a).find('h3').first().text()) || clean($(a).text());
      const context = clean($(a).text());
      if (STUDENT_RE.test(context)) candidates.push(listingCandidate(title, absoluteUrl($(a).attr('href'), source.source_url), context, /Stockelsdorf/i.test(context) ? 'Stockelsdorf' : null));
    });
  } else if (source.adapter === 'fraunhofer_list') {
    $('tr.data-row').each((_, row) => {
      const context = clean($(row).text());
      const a = $(row).find('a.jobTitle-link').first();
      const title = clean(a.text());
      if (/Lübeck/i.test(context) && /\bIMTE\b/i.test(context) && STUDENT_RE.test(title))
        candidates.push(listingCandidate(title, absoluteUrl(a.attr('href'), source.source_url), context, 'Lübeck'));
    });
  } else if (source.adapter === 'drager_list') {
    $('tr').each((_, row) => {
      const a = $(row).find('a[data-url-parameters*="ac=jobad"]').first();
      const title = clean(a.text());
      const context = clean($(row).text());
      const params = a.attr('data-url-parameters');
      if (title && params && /Lübeck/i.test(context) && STUDENT_RE.test(title)) {
        candidates.push(listingCandidate(title, `https://erecruitment.draeger.com/index.php?${params}`, context, 'Lübeck'));
      }
    });
  } else if (source.adapter === 'university_page') {
    $('a[href]').each((_, a) => {
      const title = clean($(a).text());
      const context = clean($(a).closest('li,article,section,div').text());
      const generic = /^(aktuelles|kontakt|lehre|intern|impressum|datenschutz|formular|moodle|univis|zum |zur |ansprech|allgemeine infos)/i.test(title);
      const vacancyTitle = /hiwi|hilfskraft|werkstudent|student assistant|praktikum|internship|stellenangebot|vacancy|position|^(?:master|bachelor|abschluss)arbeit/i.test(title);
      if (title.length >= 12 && !generic && vacancyTitle && TECH_RE.test(`${title} ${context}`) && !/^mailto:/i.test($(a).attr('href') || ''))
        candidates.push(listingCandidate(title || 'University student opportunity', absoluteUrl($(a).attr('href'), source.source_url), context, 'Lübeck'));
    });
  } else if (source.adapter === 'generic_official_list') {
    $('script[type="application/ld+json"]').each((_,node) => {
      try {
        const raw=JSON.parse($(node).text());
        const walk=value => {
          if (!value || typeof value!=='object') return;
          if (value['@type']==='JobPosting') {
            const title=clean(value.title);
            const location=clean(value.jobLocation?.address?.addressLocality || value.jobLocation?.address?.addressRegion || source.metadata?.default_location);
            const context=clean(cheerio.load(value.description || '').text());
            if (value.url && relevantCandidate(title,context) && matchesSourceScope(source,location || context))
              candidates.push(parseDetail(`<main><h1>${title}</h1>${value.description || ''}</main>`,absoluteUrl(value.url,source.source_url),{title,location,postingDate:value.datePosted?.slice(0,10)}));
          }
          for (const child of Object.values(value)) if (child && typeof child==='object') Array.isArray(child)?child.forEach(walk):walk(child);
        };
        walk(raw);
      } catch {}
    });
    $('a[href]').each((_,a) => {
      const href=$(a).attr('href') || '';
      if (/^(?:mailto:|tel:|javascript:|#)/i.test(href)) return;
      const container=$(a).closest('tr,li,article,[class*="job"],[class*="position"],[class*="vacan"],.w-dyn-item').first();
      const anchorText=clean($(a).text());
      const title=clean($(a).find('.job-tle,h1,h2,h3,h4,[class*="title"]').first().text()) || (anchorText.length<=250 ? anchorText : '') || clean(container.find('h1,h2,h3,h4,.job-tle,[class*="title"]').first().text());
      const context=clean((container.length?container:$(a).parent()).text());
      const url=absoluteUrl(href,source.source_url);
      const parsed=url ? new URL(url) : null;
      const sourceParsed=new URL(source.source_url);
      const sameListingPath=parsed && parsed.hostname===sourceParsed.hostname && parsed.pathname.replace(/\/$/,'')===sourceParsed.pathname.replace(/\/$/,'');
      const looksLikeJob=/\/jobs?\/[^^?#]+|\/stellenangebote?\/[^^?#]+|\/open-positions?\/[^^?#]+|jobad|j\d+\.html|career\/jobs\/[^^?#]+/i.test(url || '');
      const generic=/^(jobs?|stellenangebote?|karriere|career|finde deinen job|zu den jobs?(?: \(\d+\))?|mehr (?:infos|erfahren)|learn more|apply|bewerben|jetzt bewerben)$/i.test(title);
      const excludedPath=/datenschutz|privacy|impressum|register|registrieren|login|job-alert|jobticker|faq|einstieg\//i.test(parsed?.pathname || '');
      const localScope=anchorText.length<=500 ? anchorText : clean($(a).find('.job-pl,.location,[class*="location"],[class*="place"]').text());
      if (!url || sameListingPath || excludedPath || !looksLikeJob || generic || title.length<8 || !relevantCandidate(title,context) || !matchesSourceScope(source,`${title} ${localScope} ${url}`)) return;
      const location=context.match(/\b(Lübeck|Hamburg|Ahrensburg|Berlin|Bremen|Remote|Deutschlandweit|Germany)\b/i)?.[1] || url.match(/\b(Lübeck|Hamburg|Ahrensburg|Berlin|Bremen)\b/i)?.[1] || source.metadata?.default_location || null;
      candidates.push(listingCandidate(title,url,context,location));
    });
  }
  const map = new Map();
  for (const c of candidates) if (c.url && c.title) map.set(`${c.url}|${canonicalText(c.title)}`, c);
  return [...map.values()];
}

function parseStructuredListing(source, text) {
  const data=JSON.parse(text);
  const candidates=[];
  if(source.adapter==='schema_datafeed') {
    for(const row of data.dataFeedElement || []) {
      const j=row.item || row;
      const location=clean(j.jobLocation?.address?.addressLocality || j.jobLocation?.address?.addressRegion || source.metadata?.default_location);
      const description=clean(cheerio.load(j.description || '').text());
      if(j.url && relevantCandidate(j.title,description) && matchesSourceScope(source,location || description))
        candidates.push(parseDetail(`<main><h1>${j.title}</h1>${j.description || ''}</main>`,j.url,{title:j.title,location,postingDate:j.datePosted?.slice(0,10),department:j.industry}));
    }
  } else if(source.adapter==='ashby_feed') {
    for(const j of data.jobs || []) {
      const location=clean(j.location || j.address?.postalAddress?.addressLocality);
      if(j.isListed!==false && j.jobUrl && relevantCandidate(j.title,j.descriptionHtml) && matchesSourceScope(source,location || j.descriptionHtml || ''))
        candidates.push(parseDetail(`<main><h1>${j.title}</h1>${j.descriptionHtml || ''}</main>`,j.jobUrl,{title:j.title,location,department:j.department,postingDate:j.publishedAt?.slice(0,10),workMode:j.workplaceType || (j.isRemote?'Remote':null)}));
    }
  } else if(source.adapter==='greenhouse_feed') {
    for(const j of data.jobs || []) {
      const decoded=cheerio.load(`<div>${j.content || ''}</div>`).text();
      const location=clean(j.location?.name);
      if(j.absolute_url && relevantCandidate(j.title,decoded) && matchesSourceScope(source,location || decoded))
        candidates.push(parseDetail(`<main><h1>${j.title}</h1><div>${j.content || ''}</div></main>`,j.absolute_url,{title:j.title,location,postingDate:(j.first_published || j.updated_at)?.slice(0,10),deadline:j.application_deadline}));
    }
  } else if(source.adapter==='workday_feed') {
    const base=(source.metadata?.detail_base || new URL(source.source_url).origin).replace(/\/$/,'');
    for(const j of data.jobPostings || []) {
      const location=clean(j.locationsText);
      const url=j.externalPath?.startsWith('/') ? `${base}${j.externalPath}` : absoluteUrl(j.externalPath,base);
      if(url && relevantCandidate(j.title,j.bulletFields?.join(' ')) && matchesSourceScope(source,location))
        candidates.push(listingCandidate(j.title,url,j.bulletFields?.join(' ') || '',location,{detailApiUrl:`${new URL(source.source_url).origin}/wday/cxs/nxp/careers${j.externalPath}`}));
    }
  }
  return candidates;
}

async function fetchPage(url, options={}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const method=options.method || 'GET';
    const response = await fetch(url, { method, redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json,text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
        ...(method==='POST'?{'Content-Type':'application/json'}:{}) },
      body: method==='POST' ? JSON.stringify(options.body || {}) : undefined });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, ok: response.ok, effectiveUrl: response.url, buffer,
      contentType: response.headers.get('content-type') || '', etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'), retryAfter: response.headers.get('retry-after'),
      durationMs: Date.now() - started };
  } finally { clearTimeout(timeout); }
}

function normalizedPageHash(buffer, contentType) {
  if (/pdf|octet-stream/i.test(contentType)) return hash(buffer);
  if (/json/i.test(contentType)) {
    try {
      const stable=value => Array.isArray(value) ? value.map(stable) : value && typeof value==='object' ?
        Object.fromEntries(Object.entries(value).filter(([k])=>!['dateModified','generatedAt','generated_at'].includes(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])) : value;
      return hash(JSON.stringify(stable(JSON.parse(buffer.toString('utf8')))));
    } catch { return hash(buffer); }
  }
  const $ = cheerio.load(buffer.toString('utf8'));
  $('script,style,noscript,svg').remove();
  return hash(clean($('body').text()));
}

function canonicalKey(employerId, title, location) {
  return hash(`${employerId}|${canonicalText(title)}|${canonicalText(location || '')}`).slice(0, 40);
}

function assess(candidate) {
  const text = `${candidate.title} ${candidate.description || ''} ${candidate.technicalRequirements || ''} ${(candidate.technologies || []).join(' ')}`;
  const techs = candidate.technologies || detectTechnologies(text);
  const nonTechnicalTitle = /unternehmenskommunikation|business development|processmanagement|prozessmanagement|sustainability|nachhaltigkeit|event|outreach|marketing|human resources|\bhr\b|people|procurement|billing|accounting|financial accounting|legal|vertrieb|sales(?!.*(?:it|software|technical))/i.test(candidate.title) || (SENIOR_RE.test(candidate.title) && !STUDENT_RE.test(candidate.title));
  const technical = nonTechnicalTitle ? 0 : Math.min(3, techs.length >= 4 ? 3 : techs.length >= 2 ? 2 : techs.length ? 1 : (TECH_RE.test(text) ? 1 : 0));
  let domain = 0;
  if (/postgis|spatial|geoinformatik|\bgis\b|routing|mapping|mobilit|ticketing|verkehr|transport/i.test(text)) domain = 3;
  else if (/security|sicherheit|cyber|devsec|secure|it.?forensik/i.test(text)) domain = 3;
  else if (/backend|database|postgres|\bsql\b|data engineering|etl|software|cloud|api/i.test(text)) domain = 2;
  else if (/medical|mediz|image|bild|iot|automation/i.test(text)) domain = 1;
  let professional = technical;
  if (/postgis|spatial|geoinformatik|\bgis\b|routing|mapping|mobilit/i.test(text)) professional = 3;
  else if ((/react|typescript|next/i.test(text) && /python|data|api|database/i.test(text)) ||
           (/node|javascript/i.test(text) && /postgres|sql|aws|api/i.test(text))) professional = 3;
  const isStudent = STUDENT_RE.test(`${candidate.title} ${candidate.opportunityType || ''}`) || candidate.employmentType === 'Student';
  let eligibilityStatus = 'ELIGIBILITY_UNKNOWN';
  let eligibility = 1;
  if (candidate.enrollmentRequirement) {
    eligibilityStatus = FAIZAN_ENROLLED ? 'ELIGIBLE_NOW' : 'ENROLLMENT_REQUIRED';
    eligibility = FAIZAN_ENROLLED ? 3 : 0;
  } else if (isStudent && !FAIZAN_ENROLLED) {
    eligibilityStatus = 'LIKELY_ELIGIBLE_AFTER_ENROLLMENT';
    eligibility = 0;
  } else if (!isStudent) {
    eligibilityStatus = 'ELIGIBILITY_UNKNOWN';
  }
  const languageMap = { ENGLISH_EXPLICITLY_ACCEPTED: 3, NO_GERMAN_THRESHOLD_STATED: 2, B1: 3, A2: 3,
    B2: 1, C1: 0, C2: 0, GERMAN_REQUIRED_UNSPECIFIED_LEVEL: 1, UNKNOWN: 1 };
  const language = languageMap[candidate.languageBucket || 'UNKNOWN'] ?? 1;
  const location = /Lübeck|Stockelsdorf|Bad Schwartau/i.test(candidate.location || '') ? 3 : /Hamburg|Ahrensburg/i.test(candidate.location || '') ? 2 : 1;
  const start = candidate.expectedStartDate ? (/ab sofort|as of now|soon/i.test(candidate.expectedStartDate) ? 2 : 1) : 1;
  let niche = 0;
  if (/postgis|spatial|geoinformatik|\bgis\b|routing|mapping/i.test(text)) niche = 3;
  else if (/security|cyber|secure/i.test(text) && /backend|data|cloud|software|automation/i.test(text)) niche = 2;
  else if (/medical|mediz|iot|mobility|ticketing/i.test(text)) niche = 1;
  const score = Math.round((technical*20 + domain*15 + professional*20 + eligibility*15 + language*10 + location*10 + start*5 + niche*5) / 3 * 100) / 100;
  const latentScore = Math.round((technical*20 + domain*15 + professional*20 + 3*15 + language*10 + location*10 + start*5 + niche*5) / 3 * 100) / 100;
  const fitClass = s => technical === 0 || s < 40 ? 'NOT_RELEVANT' : s >= 80 ? 'EXCEPTIONAL_MATCH' : s >= 65 ? 'STRONG_MATCH' : 'POSSIBLE_MATCH';
  const latentFit = fitClass(latentScore);
  const alertClass = latentFit === 'NOT_RELEVANT' ? 'NOT_RELEVANT' : (!FAIZAN_ENROLLED && isStudent ? 'MARKET_SIGNAL' : fitClass(score));
  let urgency = alertClass === 'NOT_RELEVANT' ? 'IGNORE' : alertClass === 'MARKET_SIGNAL' ? 'PREPARE_FOR_FUTURE' :
    alertClass === 'EXCEPTIONAL_MATCH' ? 'ACT_WITHIN_48_HOURS' : alertClass === 'STRONG_MATCH' ? 'ACT_THIS_WEEK' : 'MONITOR';
  const gaps = [];
  if (eligibilityStatus === 'ENROLLMENT_REQUIRED') gaps.push('Current enrollment is required; Faizan is not yet enrolled in Germany');
  if (['C1','C2'].includes(candidate.languageBucket)) gaps.push(`German ${candidate.languageBucket} is above the expected arrival level`);
  else if (candidate.languageBucket === 'B2') gaps.push('German B2 exceeds the expected arrival level');
  else if (candidate.languageBucket === 'GERMAN_REQUIRED_UNSPECIFIED_LEVEL') gaps.push('German is required but the source gives no CEFR threshold');
  if (technical <= 1) gaps.push('Limited direct overlap with the demonstrated software/data stack');
  return { technical,domain,professional,eligibility,language,location,start,niche,score,latentScore,
    eligibilityStatus,alertClass,latentFit,urgency,missingRequirements:gaps.join('; ') || null };
}

function snapshotOf(candidate, assessment) {
  return {
    title: candidate.title, location: candidate.location, department: candidate.department,
    opportunity_type: candidate.opportunityType, employment_type: candidate.employmentType,
    status: candidate.status, posting_date: candidate.postingDate, deadline: candidate.deadline,
    hours: candidate.hours, work_mode: candidate.workMode, office_attendance: candidate.officeAttendance,
    enrollment_requirement: candidate.enrollmentRequirement, expected_start_date: candidate.expectedStartDate,
    german_requirement_raw: candidate.germanRequirementRaw, english_requirement_raw: candidate.englishRequirementRaw,
    language_bucket: candidate.languageBucket, technical_requirements: candidate.technicalRequirements,
    preferred_requirements: candidate.preferredRequirements, technologies: candidate.technologies,
    description: candidate.description, eligibility_status: assessment.eligibilityStatus,
    alert_class: assessment.alertClass, latent_fit_class: assessment.latentFit,
    monitoring_urgency: assessment.urgency, opportunity_priority: assessment.score
  };
}

async function createEvent(client, runId, opportunityId, sourceId, eventType, previousState, newState, assessment, eventKeys) {
  const key = `${opportunityId || 'page'}|${eventType}`;
  if (eventKeys.has(key)) return 0;
  eventKeys.add(key);
  const actionable = Boolean(assessment && ['EXCEPTIONAL_MATCH','STRONG_MATCH'].includes(assessment.alertClass) && assessment.eligibilityStatus === 'ELIGIBLE_NOW');
  await client.query(`INSERT INTO opportunity_change_events
    (run_id,opportunity_id,monitored_source_id,event_type,previous_state,new_state,alert_class,urgency,is_actionable)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [runId,opportunityId,sourceId,eventType,previousState,newState,assessment?.alertClass,assessment?.urgency,actionable]);
  return 1;
}

async function findExisting(client, employerId, candidate, key) {
  const { rows } = await client.query('SELECT * FROM opportunities WHERE employer_id=$1 ORDER BY opportunity_id',[employerId]);
  const sourceUrl = normalizedUrl(candidate.url);
  return rows.find(r => normalizedUrl(r.job_url) === sourceUrl) || rows.find(r => r.canonical_key === key) ||
    rows.find(r => canonicalText(r.title) === canonicalText(candidate.title) && canonicalText(r.location || '') === canonicalText(candidate.location || '')) || null;
}

async function updatePattern(client, employerId, candidate) {
  const month = new Date().getUTCMonth()+1;
  await client.query(`INSERT INTO recurring_hiring_patterns
    (employer_id,pattern_key,observation_count,first_observed_at,last_observed_at,observed_months,
     recurring_titles,recurring_departments,recurring_technologies,language_observations,hours_observations)
    VALUES($1,'student_opportunities',1,now(),now(),ARRAY[$2]::smallint[],ARRAY[$3]::text[],
      CASE WHEN $4::text IS NULL THEN ARRAY[]::text[] ELSE ARRAY[$4]::text[] END,$5::text[],
      CASE WHEN $6::text IS NULL THEN ARRAY[]::text[] ELSE ARRAY[$6]::text[] END,
      CASE WHEN $7::text IS NULL THEN ARRAY[]::text[] ELSE ARRAY[$7]::text[] END)
    ON CONFLICT (employer_id,pattern_key) DO UPDATE SET
      observation_count=recurring_hiring_patterns.observation_count+1,last_observed_at=now(),
      observed_months=CASE WHEN $2=ANY(recurring_hiring_patterns.observed_months) THEN recurring_hiring_patterns.observed_months ELSE array_append(recurring_hiring_patterns.observed_months,$2) END,
      recurring_titles=CASE WHEN $3=ANY(recurring_hiring_patterns.recurring_titles) THEN recurring_hiring_patterns.recurring_titles ELSE array_append(recurring_hiring_patterns.recurring_titles,$3) END,
      recurring_departments=CASE WHEN $4::text IS NULL OR $4=ANY(recurring_hiring_patterns.recurring_departments) THEN recurring_hiring_patterns.recurring_departments ELSE array_append(recurring_hiring_patterns.recurring_departments,$4) END,
      recurring_technologies=(SELECT ARRAY(SELECT DISTINCT x FROM unnest(recurring_hiring_patterns.recurring_technologies || $5::text[]) x)),
      language_observations=CASE WHEN $6::text IS NULL OR $6=ANY(recurring_hiring_patterns.language_observations) THEN recurring_hiring_patterns.language_observations ELSE array_append(recurring_hiring_patterns.language_observations,$6) END,
      hours_observations=CASE WHEN $7::text IS NULL OR $7=ANY(recurring_hiring_patterns.hours_observations) THEN recurring_hiring_patterns.hours_observations ELSE array_append(recurring_hiring_patterns.hours_observations,$7) END,
      updated_at=now()`, [employerId,month,candidate.title,candidate.department,candidate.technologies || [],candidate.languageBucket,candidate.hours]);
}

async function observeCandidate(client, runId, source, candidate, eventKeys) {
  const key = canonicalKey(source.employer_id,candidate.title,candidate.location);
  const existing = await findExisting(client,source.employer_id,candidate,key);
  if (candidate.status==='CLOSED' && !existing) return { opportunityId:null,events:0,skippedClosed:true };
  if (existing && !candidate.title) candidate.title=existing.title;
  const assessment = assess(candidate);
  const isNew = !existing;
  let opportunityId;
  if (isNew) {
    const { rows } = await client.query(`INSERT INTO opportunities
      (employer_id,title,location,opportunity_type,role_family,status,language_requirement,work_model,
       technology_mentions,job_url,source_date,verified_at,relevance_note,verification_status,hours,
       missing_requirements,urgency,last_status_check,department,employment_type,first_seen_at,
       application_deadline,office_attendance,enrollment_requirement,expected_start_date,
       german_requirement_raw,english_requirement_raw,technical_requirements,preferred_requirements,
       role_description,eligibility_status,language_bucket,alert_class,latent_fit_class,monitoring_urgency,
       technical_match,domain_match_opportunity,professional_evidence_match,student_eligibility_match,
       language_match,location_match,start_date_match,niche_advantage,opportunity_priority,canonical_key,
       last_seen_at,last_seen_run_id)
      VALUES($1,$2,$3,$4,$5,'LIVE',$6,$7,$8,$9,$10,current_date,$11,$12,$13,$14,$15,current_date,$16,$17,now(),$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,now(),$42)
      RETURNING opportunity_id`, [source.employer_id,candidate.title,candidate.location,candidate.opportunityType,
      candidate.department,candidate.germanRequirementRaw || candidate.englishRequirementRaw,candidate.workMode,candidate.technologies,
      candidate.url,candidate.postingDate,`Transparent monitoring score ${assessment.score}; latent fit ${assessment.latentFit}.`,candidate.status,
      candidate.hours,assessment.missingRequirements,assessment.urgency,candidate.department,candidate.employmentType,
      candidate.deadline,candidate.officeAttendance,candidate.enrollmentRequirement,candidate.expectedStartDate,
      candidate.germanRequirementRaw,candidate.englishRequirementRaw,candidate.technicalRequirements,candidate.preferredRequirements,
      candidate.description,assessment.eligibilityStatus,candidate.languageBucket || 'UNKNOWN',assessment.alertClass,
      assessment.latentFit,assessment.urgency,assessment.technical,assessment.domain,assessment.professional,
      assessment.eligibility,assessment.language,assessment.location,assessment.start,assessment.niche,assessment.score,key,runId]);
    opportunityId=rows[0].opportunity_id;
  } else {
    opportunityId=existing.opportunity_id;
    await client.query(`UPDATE opportunities SET
      title=COALESCE($2,title),location=COALESCE($3,location),opportunity_type=COALESCE($4,opportunity_type),
      role_family=COALESCE($5,role_family),status=CASE WHEN $12='CLOSED' THEN 'CLOSED' ELSE 'LIVE' END,
      language_requirement=COALESCE($6,language_requirement),work_model=COALESCE($7,work_model),
      technology_mentions=CASE WHEN cardinality($8::text[])>0 THEN $8 ELSE technology_mentions END,
      job_url=COALESCE($9,job_url),source_date=COALESCE($10,source_date),verified_at=current_date,
      relevance_note=$11,verification_status=$12,hours=COALESCE($13,hours),missing_requirements=$14,
      last_status_check=current_date,department=COALESCE($15,department),employment_type=COALESCE($16,employment_type),
      first_seen_at=COALESCE(first_seen_at,now()),application_deadline=$17,office_attendance=$18,
      enrollment_requirement=$19,expected_start_date=$20,german_requirement_raw=$21,english_requirement_raw=$22,
      technical_requirements=$23,preferred_requirements=$24,role_description=$25,eligibility_status=$26,
      language_bucket=$27,alert_class=$28,latent_fit_class=$29,monitoring_urgency=$30,
      technical_match=$31,domain_match_opportunity=$32,professional_evidence_match=$33,
      student_eligibility_match=$34,language_match=$35,location_match=$36,start_date_match=$37,
      niche_advantage=$38,opportunity_priority=$39,canonical_key=COALESCE(canonical_key,$40),
      last_seen_at=now(),last_seen_run_id=$41
      WHERE opportunity_id=$1`, [opportunityId,candidate.title,candidate.location,candidate.opportunityType,candidate.department,
      candidate.germanRequirementRaw || candidate.englishRequirementRaw,candidate.workMode,candidate.technologies || [],candidate.url,
      candidate.postingDate,`Transparent monitoring score ${assessment.score}; latent fit ${assessment.latentFit}.`,candidate.status,
      candidate.hours,assessment.missingRequirements,candidate.department,candidate.employmentType,candidate.deadline,
      candidate.officeAttendance,candidate.enrollmentRequirement,candidate.expectedStartDate,candidate.germanRequirementRaw,
      candidate.englishRequirementRaw,candidate.technicalRequirements,candidate.preferredRequirements,candidate.description,
      assessment.eligibilityStatus,candidate.languageBucket || 'UNKNOWN',assessment.alertClass,assessment.latentFit,
      assessment.urgency,assessment.technical,assessment.domain,assessment.professional,assessment.eligibility,
      assessment.language,assessment.location,assessment.start,assessment.niche,assessment.score,key,runId]);
  }
  await client.query(`INSERT INTO opportunity_sources
    (opportunity_id,monitored_source_id,source_url,source_role,last_seen_at,last_seen_run_id,missed_runs,is_current)
    VALUES($1,$2,$3,$4,now(),$5,0,TRUE)
    ON CONFLICT (opportunity_id,monitored_source_id,source_url) DO UPDATE SET
      last_seen_at=now(),last_seen_run_id=$5,missed_runs=0,is_current=TRUE`,
    [opportunityId,source.monitored_source_id,candidate.url,source.canonical?'CANONICAL':'SECONDARY',runId]);
  const snap = snapshotOf(candidate,assessment);
  const stateHash = hash(JSON.stringify(snap));
  const descriptionHash = hash(candidate.description || '');
  const prev = await client.query(`SELECT snapshot,state_hash,description_hash FROM opportunity_snapshots
    WHERE opportunity_id=$1 AND monitored_source_id=$2 AND run_id<>$3 ORDER BY observed_at DESC LIMIT 1`,
    [opportunityId,source.monitored_source_id,runId]);
  await client.query(`INSERT INTO opportunity_snapshots(opportunity_id,run_id,monitored_source_id,state_hash,description_hash,snapshot)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[opportunityId,runId,source.monitored_source_id,stateHash,descriptionHash,snap]);
  let events=0;
  if (!prev.rowCount) {
    const type=isNew?'NEW_JOB':'BASELINE_OBSERVED';
    events += await createEvent(client,runId,opportunityId,source.monitored_source_id,type,null,snap,assessment,eventKeys);
    if (isNew && STUDENT_RE.test(`${candidate.title} ${candidate.opportunityType}`))
      events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'STUDENT_ROLE_ADDED',null,snap,assessment,eventKeys);
    if (STUDENT_RE.test(`${candidate.title} ${candidate.opportunityType}`) && assessment.latentFit!=='NOT_RELEVANT')
      await updatePattern(client,source.employer_id,candidate);
  } else {
    const old=prev.rows[0].snapshot;
    if (prev.rows[0].description_hash!==descriptionHash) events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'JOB_DESCRIPTION_CHANGED',old,snap,assessment,eventKeys);
    if (old.language_bucket!==snap.language_bucket || old.german_requirement_raw!==snap.german_requirement_raw || old.english_requirement_raw!==snap.english_requirement_raw)
      events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'LANGUAGE_REQUIREMENT_CHANGED',old,snap,assessment,eventKeys);
    if (old.deadline!==snap.deadline) events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'DEADLINE_CHANGED',old,snap,assessment,eventKeys);
    if (old.location!==snap.location) events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'LOCATION_CHANGED',old,snap,assessment,eventKeys);
    if (old.work_mode!==snap.work_mode || old.office_attendance!==snap.office_attendance)
      events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'WORK_MODE_CHANGED',old,snap,assessment,eventKeys);
  }
  if (candidate.status === 'CLOSED' && existing?.verification_status !== 'CLOSED')
    events += await createEvent(client,runId,opportunityId,source.monitored_source_id,'JOB_CLOSED',{status:existing?.verification_status},{status:'CLOSED'},assessment,eventKeys);
  return { opportunityId,events };
}

async function markMissingFromListing(client,runId,source,eventKeys) {
  const {rows}=await client.query(`SELECT os.*,o.verification_status,o.title FROM opportunity_sources os
    JOIN opportunities o USING(opportunity_id)
    WHERE os.monitored_source_id=$1 AND os.last_seen_run_id<>$2 AND os.is_current`,[source.monitored_source_id,runId]);
  let events=0;
  for(const row of rows){
    const misses=row.missed_runs+1;
    await client.query('UPDATE opportunity_sources SET missed_runs=$2 WHERE opportunity_source_id=$1',[row.opportunity_source_id,misses]);
    if(misses>=2){
      await client.query(`UPDATE opportunity_sources SET is_current=FALSE WHERE opportunity_source_id=$1`,[row.opportunity_source_id]);
      await client.query(`UPDATE opportunities SET verification_status='STATUS_UNCERTAIN',status='UNKNOWN',last_status_check=current_date WHERE opportunity_id=$1 AND verification_status<>'CLOSED'`,[row.opportunity_id]);
      events+=await createEvent(client,runId,row.opportunity_id,source.monitored_source_id,'JOB_REMOVED',{status:row.verification_status},{status:'STATUS_UNCERTAIN',reason:'Absent from canonical listing in two consecutive successful runs'},null,eventKeys);
    }
  }
  return events;
}

async function markClosed(client,runId,source,eventKeys,reason) {
  const { rows } = await client.query(`SELECT * FROM opportunities WHERE employer_id=$1 AND regexp_replace(job_url,'/$','')=regexp_replace($2,'/$','') LIMIT 1`,[source.employer_id,source.source_url]);
  if (!rows.length) return 0;
  const o=rows[0];
  if (o.verification_status==='CLOSED') return 0;
  await client.query(`UPDATE opportunities SET verification_status='CLOSED',status='CLOSED',last_status_check=current_date,verified_at=current_date WHERE opportunity_id=$1`,[o.opportunity_id]);
  return createEvent(client,runId,o.opportunity_id,source.monitored_source_id,'JOB_CLOSED',{status:o.verification_status},{status:'CLOSED',reason},null,eventKeys);
}

async function main() {
  const client=await pool.connect();
  let runId;
  let lockAcquired=false;
  const eventKeys=new Set();
  let totals={attempted:0,succeeded:0,observed:0,events:0,errors:0};
  try {
    const lock=await client.query('SELECT pg_try_advisory_lock($1) AS acquired',[MONITOR_LOCK_KEY]);
    lockAcquired=lock.rows[0].acquired;
    if(!lockAcquired){
      console.log(JSON.stringify({skipped:true,status:'SKIPPED_OVERLAP',reason:'Another monitoring process holds the advisory lock'},null,2));
      return;
    }
    const profile=await client.query(`SELECT * FROM monitoring_profile WHERE profile_id=TRUE`);
    FAIZAN_PROFILE=profile.rows[0] || null;
    FAIZAN_ENROLLED=process.env.FAIZAN_ENROLLED===undefined
      ? FAIZAN_PROFILE?.enrollment_status==='ENROLLED'
      : /^true$/i.test(process.env.FAIZAN_ENROLLED);
    const prior=await client.query('SELECT count(*)::int n FROM monitoring_runs');
    const mode=requestedMode || (prior.rows[0].n===0?'BASELINE':'MANUAL');
    ({rows:[{run_id:runId}]}=await client.query(`INSERT INTO monitoring_runs(run_mode,requested_tiers,tool_version) VALUES($1,$2,$3) RETURNING run_id`,[mode,tiers,TOOL_VERSION]));
    let {rows:sources}=await client.query(`SELECT * FROM monitored_sources WHERE enabled AND priority_tier=ANY($1::text[])
      AND ($2::boolean OR next_check_at IS NULL OR next_check_at<=now()) ORDER BY source_priority,employer_id,monitored_source_id`,[tiers,force]);
    if(sourceLimit)sources=sources.slice(0,sourceLimit);
    productionLog('monitor.start',{run_id:runId,mode,tiers,sources_selected:sources.length});
    for(const source of sources){
      totals.attempted++;
      let fetchResult;
      try {
        fetchResult=await fetchPage(source.source_url,{method:source.metadata?.method || 'GET',body:source.metadata?.body});
        const contentHash=normalizedPageHash(fetchResult.buffer,fetchResult.contentType);
        const text=/pdf/i.test(fetchResult.contentType)?'':fetchResult.buffer.toString('utf8');
        let candidates=[];
        const expectedClosure=Boolean(source.metadata?.expected_closed && [404,410].includes(fetchResult.status));
        const acceptedFetch=fetchResult.ok || expectedClosure;
        if (fetchResult.ok) {
          if (['schema_datafeed','ashby_feed','greenhouse_feed','workday_feed'].includes(source.adapter))
            candidates=parseStructuredListing(source,text);
          else if (LISTING_ADAPTERS.has(source.adapter))
            candidates=parseListing(source,text);
          else if (source.adapter==='job_detail') {
            const existingAll=await client.query(`SELECT title,location,opportunity_type,employment_type,job_url FROM opportunities WHERE employer_id=$1`,[source.employer_id]);
            const existing=existingAll.rows.find(x=>normalizedUrl(x.job_url)===normalizedUrl(source.source_url));
            const seed=existing?{title:existing.title,location:existing.location,opportunityType:existing.opportunity_type,employmentType:existing.employment_type,evergreen:Boolean(source.metadata?.evergreen)}:{evergreen:Boolean(source.metadata?.evergreen)};
            candidates=[parseDetail(text,source.source_url,seed)];
          } else if (source.adapter==='static_job_resource') {
            const existing=await client.query(`SELECT * FROM opportunities WHERE employer_id=$1 AND regexp_replace(job_url,'/$','')=regexp_replace($2,'/$','') LIMIT 1`,[source.employer_id,source.source_url]);
            const o=existing.rows[0]; const m=source.metadata||{};
            if(existing.rows.length || m.title) candidates=[listingCandidate(m.title||o?.title,m.url||o?.job_url||source.source_url,m.description||`${(o?.technology_mentions||[]).join(' ')} ${o?.relevance_note||''}`,m.location||o?.location,{opportunityType:m.opportunity_type||o?.opportunity_type,employmentType:m.employment_type||'Student',status:'LIVE_VERIFIED',languageBucket:m.language_bucket||'UNKNOWN',enrollmentRequirement:m.enrollment_requirement||null,technologies:m.technologies||o?.technology_mentions||[],detailed:false})];
          }
          candidates.sort((a,b)=>Number(STUDENT_RE.test(`${b.title} ${b.opportunityType}`))-Number(STUDENT_RE.test(`${a.title} ${a.opportunityType}`)));
          const enriched=[];
          for(const candidate of candidates.slice(0,DETAIL_LIMIT_PER_SOURCE)){
            if (!candidate.detailed && candidate.detailApiUrl) {
              await sleep(REQUEST_GAP_MS);
              try {
                const detail=await fetchPage(candidate.detailApiUrl);
                const data=detail.ok ? JSON.parse(detail.buffer.toString('utf8')) : null;
                const j=data?.jobPostingInfo;
                enriched.push(j ? parseDetail(`<main><h1>${j.title}</h1>${j.jobDescription || ''}</main>`,candidate.url,{...candidate,title:j.title,location:j.location || candidate.location,postingDate:j.startDate || candidate.postingDate}) : candidate);
              } catch { enriched.push(candidate); }
            } else if (!candidate.detailed && candidate.url && /^https:/i.test(candidate.url) && source.adapter!=='static_job_resource') {
              await sleep(REQUEST_GAP_MS);
              try { const detail=await fetchPage(candidate.url); enriched.push(detail.ok && /html/i.test(detail.contentType)?parseDetail(detail.buffer.toString('utf8'),candidate.url,candidate):candidate); }
              catch { enriched.push(candidate); }
            } else enriched.push(candidate);
          }
          candidates=enriched;
          for(const candidate of candidates){
            if (!candidate.title || !candidate.url) continue;
            const result=await observeCandidate(client,runId,source,candidate,eventKeys);
            if (result.opportunityId) totals.observed++;
            totals.events+=result.events;
          }
          if (LISTING_ADAPTERS.has(source.adapter) && source.discovery_enabled)
            totals.events+=await markMissingFromListing(client,runId,source,eventKeys);
          if (source.last_content_hash && source.last_content_hash!==contentHash && !source.metadata?.suppress_page_change && source.adapter!=='job_detail' && source.adapter!=='static_job_resource')
            totals.events+=await createEvent(client,runId,null,source.monitored_source_id,'CAREER_PAGE_CHANGED',{content_hash:source.last_content_hash},{content_hash:contentHash,job_count:candidates.length},null,eventKeys);
          totals.succeeded++;
          await client.query(`UPDATE monitored_sources SET last_checked_at=now(),last_success_at=now(),last_http_status=$2,last_content_hash=$3,last_job_count=$4,consecutive_errors=0,next_check_at=now()+make_interval(hours=>$5),updated_at=now() WHERE monitored_source_id=$1`,[source.monitored_source_id,fetchResult.status,contentHash,candidates.length,source.cadence_hours]);
        } else if (expectedClosure) {
          totals.events+=await markClosed(client,runId,source,eventKeys,`HTTP ${fetchResult.status}`);
          totals.succeeded++;
          await client.query(`UPDATE monitored_sources SET last_checked_at=now(),last_success_at=now(),last_http_status=$2,last_content_hash=$3,last_job_count=0,consecutive_errors=0,next_check_at=now()+make_interval(hours=>$4),updated_at=now() WHERE monitored_source_id=$1`,[source.monitored_source_id,fetchResult.status,contentHash,source.cadence_hours]);
        } else {
          totals.errors++;
          if ([404,410].includes(fetchResult.status) && source.adapter==='job_detail') totals.events+=await markClosed(client,runId,source,eventKeys,`HTTP ${fetchResult.status}`);
          const retryAfterSeconds=/^\d+$/.test(fetchResult.retryAfter||'')?Number(fetchResult.retryAfter):0;
          await client.query(`UPDATE monitored_sources SET last_checked_at=now(),last_http_status=$2,
            consecutive_errors=consecutive_errors+1,
            next_check_at=now()+GREATEST(make_interval(secs=>$4),make_interval(hours=>LEAST(72,$3*power(2,LEAST(consecutive_errors,4))::int))),
            updated_at=now() WHERE monitored_source_id=$1`,
            [source.monitored_source_id,fetchResult.status,source.cadence_hours,retryAfterSeconds]);
        }
        await client.query(`INSERT INTO monitoring_fetches(run_id,monitored_source_id,success,http_status,effective_url,content_hash,content_length,duration_ms,etag,last_modified,jobs_found,body_excerpt)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[runId,source.monitored_source_id,acceptedFetch,fetchResult.status,fetchResult.effectiveUrl,contentHash,fetchResult.buffer.length,fetchResult.durationMs,fetchResult.etag,fetchResult.lastModified,candidates.length,/pdf/i.test(fetchResult.contentType)?'[PDF resource]':excerpt(text,500)]);
        productionLog('source.complete',{run_id:runId,source_id:source.monitored_source_id,source_name:source.source_name,http_status:fetchResult.status,success:acceptedFetch,duration_ms:fetchResult.durationMs,observations:candidates.length});
      } catch(error) {
        totals.errors++;
        await client.query(`INSERT INTO monitoring_fetches(run_id,monitored_source_id,success,error_class,error_message) VALUES($1,$2,FALSE,$3,$4)`,[runId,source.monitored_source_id,error.name,excerpt(error.message,1000)]);
        await client.query(`UPDATE monitored_sources SET last_checked_at=now(),consecutive_errors=consecutive_errors+1,
          next_check_at=now()+make_interval(hours=>LEAST(72,$2*power(2,LEAST(consecutive_errors,4))::int)),updated_at=now()
          WHERE monitored_source_id=$1`,[source.monitored_source_id,source.cadence_hours]);
        productionLog('source.failure',{run_id:runId,source_id:source.monitored_source_id,source_name:source.source_name,error_class:error.name,error_message:excerpt(error.message,500)},'error');
      }
      await sleep(REQUEST_GAP_MS);
    }
    const status=totals.errors===0?'SUCCEEDED':totals.succeeded>0?'PARTIAL':'FAILED';
    await client.query(`UPDATE monitoring_runs SET finished_at=now(),status=$2,sources_attempted=$3,sources_succeeded=$4,opportunities_observed=$5,events_created=$6,notes=$7 WHERE run_id=$1`,[runId,status,totals.attempted,totals.succeeded,totals.observed,totals.events,`${totals.errors} source errors; FAIZAN_ENROLLED=${FAIZAN_ENROLLED}`]);
    productionLog('monitor.complete',{run_id:runId,status,...totals});
    console.log(JSON.stringify({runId,status,...totals,faizanEnrolled:FAIZAN_ENROLLED},null,2));
  } catch(error) {
    if(runId) await client.query(`UPDATE monitoring_runs SET finished_at=now(),status='FAILED',notes=$2 WHERE run_id=$1`,[runId,excerpt(error.stack||error.message,4000)]);
    productionLog('monitor.failure',{run_id:runId,error_class:error.name,error_message:excerpt(error.message,500)},'error');
    throw error;
  } finally {
    if(lockAcquired) await client.query('SELECT pg_advisory_unlock($1)',[MONITOR_LOCK_KEY]);
    client.release();
    await pool.end();
  }
}

main().catch(error=>{productionLog('database_or_monitor.failure',{error_class:error.name,error_message:excerpt(error.message,500)},'error');console.error(error);process.exitCode=1;});
