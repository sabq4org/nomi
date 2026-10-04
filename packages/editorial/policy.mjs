// Pure validation only; persistence must enforce this again transactionally.
export function publicationErrors(version) {
  const errors = [];
  if (version.status !== 'approved' || !version.reviewedBy || !validDate(version.reviewedAt)) errors.push('human_review_required');
  if (!version.title?.trim() || !version.summary?.trim()) errors.push('content_required');
  if (!Array.isArray(version.claims) || !version.claims.length) errors.push('claims_required');
  for (const claim of version.claims ?? []) {
    if (!claim.text?.trim()) errors.push('claim_text_required');
    if (!['confirmed','uncertain','opinion','interpretation'].includes(claim.kind)) errors.push('claim_kind_required');
    if (!Array.isArray(claim.evidence) || !claim.evidence.some(e =>
      e.support === 'supports' && e.excerpt?.trim() && e.sourceId && e.originId &&
      e.usageAllowed === true && validDate(e.publishedAt) && validDate(e.fetchedAt) && safeURL(e.url))) errors.push('supported_evidence_required');
  }
  return [...new Set(errors)];
}
function validDate(value) { return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)); }
function safeURL(value) { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
