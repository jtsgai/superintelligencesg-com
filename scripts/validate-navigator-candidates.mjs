import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/validate-navigator-candidates.mjs /path/to/navigator-candidates-ready.json');
  process.exitCode = 2;
} else {
  const kinds = new Set(['Organization', 'Research', 'Applied research', 'Education & research', 'Company', 'Health AI', 'Ecosystem', 'Governance', 'Public capability']);
  const errors = [];
  const validURL = value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  };
  const text = value => typeof value === 'string' ? value.trim() : '';
  const fail = (index, message) => errors.push(`candidate ${index + 1}: ${message}`);

  try {
    const [rawCandidates, rawOrganizations] = await Promise.all([
      readFile(resolve(inputPath), 'utf8'),
      readFile(new URL('../assets/product/organizations.json', import.meta.url), 'utf8'),
    ]);
    const parsed = JSON.parse(rawCandidates);
    const candidates = Array.isArray(parsed) ? parsed : parsed?.candidates;
    const organizations = JSON.parse(rawOrganizations);
    if (!Array.isArray(candidates)) throw new Error('The export must be an array or an object with a candidates array.');
    if (!Array.isArray(organizations)) throw new Error('The Navigator dataset is not an array.');

    const existingNames = new Set(organizations.map(item => text(item.name).toLowerCase()).filter(Boolean));
    const candidateIds = new Set();
    const candidateNames = new Set();
    candidates.forEach((candidate, index) => {
      const id = text(candidate?.source_desk_submission_id);
      const name = text(candidate?.name);
      const description = text(candidate?.description);
      const sourceURL = text(candidate?.source_url);
      const websiteURL = text(candidate?.website_url);
      const logoURL = text(candidate?.logo_url);
      if (candidate?.candidate_status !== 'ready') fail(index, 'candidate_status must be ready');
      if (candidate?.merge_state !== 'manual_review_required') fail(index, 'merge_state must be manual_review_required');
      if (!/^[a-f0-9-]{36}$/.test(id)) fail(index, 'source_desk_submission_id is not a valid submission ID');
      if (candidateIds.has(id)) fail(index, 'duplicate source_desk_submission_id in export');
      candidateIds.add(id);
      if (!name || name.length > 160) fail(index, 'name is required and must be at most 160 characters');
      const normalizedName = name.toLowerCase();
      if (candidateNames.has(normalizedName)) fail(index, 'duplicate candidate name in export');
      if (existingNames.has(normalizedName)) fail(index, 'name already exists in organizations.json');
      candidateNames.add(normalizedName);
      if (!description || description.length > 600) fail(index, 'description is required and must be at most 600 characters');
      if (!kinds.has(text(candidate?.kind))) fail(index, 'kind is not a supported Navigator category');
      if (!validURL(sourceURL)) fail(index, 'source_url must be an http(s) URL');
      if (websiteURL && !validURL(websiteURL)) fail(index, 'website_url must be an http(s) URL when provided');
      if (logoURL && !validURL(logoURL)) fail(index, 'logo_url must be an http(s) URL when provided');
    });
    if (errors.length) {
      console.error(`FAIL ${errors.length} validation issue${errors.length === 1 ? '' : 's'}`);
      errors.forEach(error => console.error(`- ${error}`));
      process.exitCode = 1;
    } else {
      console.log(`PASS ${candidates.length} Navigator candidate${candidates.length === 1 ? '' : 's'} ready for manual merge`);
      console.log('No dataset files were changed. Review the supporting sources before editing organizations.json.');
    }
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
