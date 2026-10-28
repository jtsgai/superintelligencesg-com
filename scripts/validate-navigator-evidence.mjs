import { readFile } from 'node:fs/promises';

const sourcePath = new URL('../assets/product/organizations.json', import.meta.url);
const distPath = new URL('../dist/assets/product/organizations.json', import.meta.url);
const allowedStatus = new Set(['source_verified', 'public_reference', 'website_control_verified', 'public_facts_reviewed', 'submitted_unverified', 'needs_review']);
const allowedSourceTypes = new Set(['official_publication', 'public_reference', 'community_profile']);
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const publicUrl = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
const fail = message => { throw new Error(message); };

const rawSource = await readFile(sourcePath, 'utf8');
const rawDist = await readFile(distPath, 'utf8');
if (rawSource !== rawDist) fail('dist/assets/product/organizations.json does not exactly match the source dataset.');

const records = JSON.parse(rawSource);
if (!Array.isArray(records) || !records.length) fail('Navigator dataset is empty or not an array.');
const seenIds = new Set();
let explicitEvidence = 0;

function historyOk(record, evidence) {
  if (!Array.isArray(evidence.history)) fail(`${record.id}: history must be an array.`);
  for (const entry of evidence.history) {
    if (!entry || !isoDate(entry.at) || typeof entry.kind !== 'string' || typeof entry.note !== 'string') fail(`${record.id}: invalid evidence history entry.`);
  }
}

for (const record of records) {
  if (typeof record.id !== 'string' || !record.id) fail('Record without an id.');
  if (seenIds.has(record.id)) fail(`Duplicate id: ${record.id}`);
  seenIds.add(record.id);
  if (record.published === false) fail(`${record.id}: unpublished records must not ship in the snapshot.`);

  if (record.source === 'community') {
    if (typeof record.name !== 'string' || !record.name) fail(`${record.id}: community record needs a name.`);
    if (!publicUrl(record.profile_url || record.url)) fail(`${record.id}: community profile URL must be public HTTP(S).`);
    if (record.url && !publicUrl(record.url)) fail(`${record.id}: URL must be public HTTP(S).`);
    if (record.updated && !isoDate(record.updated)) fail(`${record.id}: updated must use YYYY-MM-DD.`);
    continue;
  }

  if (record.source !== 'public') fail(`${record.id}: static Navigator records must be public references or community profiles.`);
  if (!publicUrl(record.url)) fail(`${record.id}: URL must be public HTTP(S).`);

  if (!record.evidence) continue;
  explicitEvidence += 1;
  const evidence = record.evidence;
  if (!allowedStatus.has(evidence.status)) fail(`${record.id}: invalid evidence status.`);

  // The Commons API marks some public records with a status and no further evidence fields.
  if (evidence.status === 'needs_review' && !evidence.source_url && !evidence.source_type && !evidence.history && !evidence.summary) continue;

  if (evidence.source_type && !allowedSourceTypes.has(evidence.source_type)) fail(`${record.id}: invalid evidence source type.`);
  if (!publicUrl(evidence.source_url)) fail(`${record.id}: evidence source URL must be public HTTP(S).`);
  if (!isoDate(evidence.record_updated_at)) fail(`${record.id}: record_updated_at must use YYYY-MM-DD.`);
  if (evidence.checked_at && !isoDate(evidence.checked_at)) fail(`${record.id}: checked_at must use YYYY-MM-DD.`);
  historyOk(record, evidence);

  // Fully documented editorial records still need a dated official source, summary and history.
  if (evidence.status === 'source_verified' && evidence.source_type === 'official_publication' && (!evidence.checked_at || !evidence.summary || !evidence.history.length)) fail(`${record.id}: source_verified records with an official source need a check date, summary and history.`);
  // Individual API reviews are source_verified with a dated source and history, and do not include source_type or summary.
  if (evidence.status === 'source_verified' && !evidence.source_type && (!evidence.checked_at || !evidence.history.length)) fail(`${record.id}: source_verified records need a check date and history.`);
}

console.log(`Evidence check passed: ${records.length} records; ${explicitEvidence} with an evidence object.`);
