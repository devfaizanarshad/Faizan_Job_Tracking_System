const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export const STUDENT_ROLE_PATTERN = /werkstudent|working student|student trainee|student assistant|studentische|hilfskraft|hiwi|internship|praktikum|thesis|abschlussarbeit/i;

export function isStudentOpportunity(opportunity) {
  return STUDENT_ROLE_PATTERN.test(`${opportunity.title || ''} ${opportunity.opportunity_type || opportunity.opportunityType || ''} ${opportunity.employment_type || opportunity.employmentType || ''}`)
    || clean(opportunity.employment_type || opportunity.employmentType).toLowerCase() === 'student'
    || Boolean(opportunity.enrollment_requirement || opportunity.enrollmentRequirement);
}

export function isOutsideGermany(profile) {
  return /outside germany/i.test(profile?.current_status || '');
}

export function isGermanyBased(opportunity) {
  return /hamburg|lübeck|luebeck|ahrensburg|bad schwartau|bad oldesloe|germany|deutschland/i
    .test(`${opportunity.location || ''} ${opportunity.work_model || opportunity.workMode || ''}`);
}

export function hasDocumentationRequirement(opportunity) {
  return /work permit|work authorization|residence permit|visa|aufenthaltstitel|arbeitserlaubnis|documentation required|documents? required/i
    .test(`${opportunity.missing_requirements || ''} ${opportunity.eligibility_status || ''}`);
}

export function deriveOpportunityReadiness(opportunity, profile) {
  const stored = opportunity.eligibility_status || opportunity.eligibilityStatus || 'ELIGIBILITY_UNKNOWN';
  const student = isStudentOpportunity(opportunity);
  const enrolled = profile?.enrollment_status === 'ENROLLED';

  if (stored === 'START_DATE_MISMATCH') return 'START_DATE_MISMATCH';
  if (hasDocumentationRequirement(opportunity)) return 'DOCUMENTATION_REQUIRED';

  if (student && !enrolled) return 'ENROLLMENT_REQUIRED';
  if (student && enrolled) {
    if (isOutsideGermany(profile) && isGermanyBased(opportunity)) return 'ENROLLED_REQUIRES_ARRIVAL';
    if (isOutsideGermany(profile) && profile?.employment_authorization_status !== 'CONFIRMED')
      return 'ENROLLED_WORK_AUTHORIZATION_UNCONFIRMED';
    return 'ELIGIBLE_TO_APPLY';
  }

  if (isOutsideGermany(profile) && isGermanyBased(opportunity)) return 'FUTURE_ARRIVAL';
  return stored;
}

export function readinessIsTemporaryBlock(status) {
  return [
    'ENROLLMENT_REQUIRED',
    'LIKELY_ELIGIBLE_AFTER_ENROLLMENT',
    'START_DATE_MISMATCH',
    'FUTURE_ARRIVAL',
    'ENROLLED_REQUIRES_ARRIVAL',
    'ENROLLED_WORK_AUTHORIZATION_UNCONFIRMED',
    'DOCUMENTATION_REQUIRED'
  ].includes(status);
}
