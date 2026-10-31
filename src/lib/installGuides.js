// Install guides (Gabe, Oct 31): the flashing / install method PDFs a customer approves with a YA
// quote live in the Hub's InstallGuides table (private files), not in Drive, so installers can open
// them and a job keeps the exact version its customer approved. A guide's PDF is never overwritten:
// replacing the file adds a version and the old file stays on record.
import { guideLabel } from './quoteRebrand.js';

export const MAX_GUIDE_BYTES = 25 * 1024 * 1024;

// '' when the first 1 KB carries a PDF header, else what is wrong in plain words.
export function pdfProblem(bytes, name = 'This file') {
  const head = new TextDecoder('latin1').decode((bytes || new Uint8Array()).subarray(0, 1024));
  if (head.includes('%PDF-')) return '';
  if (head.includes('MSMAMARPCRYPT')) return `${name} is Microsoft-protected (encrypted), not a plain PDF. Open it, save it again as a normal PDF, then upload that.`;
  return `${name} is not a PDF. Upload the guide as a PDF.`;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Active guides (or all), by sort order then name.
export function sortGuides(guides = [], { retired = false } = {}) {
  const order = (g) => (Number.isFinite(g.sort_order) ? g.sort_order : Number.MAX_SAFE_INTEGER);
  return guides.filter((g) => retired || g.active !== false)
    .sort((a, b) => order(a) - order(b) || String(a.name || '').localeCompare(String(b.name || '')));
}

// "Holmes Homes", "HOLMES HOMES" and "Holmes" are one builder; so are "Pulte", "Pulte Home(s)".
const GENERIC = new Set(['homes', 'home', 'construction', 'builders', 'builder', 'inc', 'llc', 'co', 'company', 'corp', 'the']);
export function builderKey(name = '') {
  return String(name).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w && !GENERIC.has(w)).join('');
}

// The active guide set as this builder's default, or null.
export function builderDefault(guides, builder) {
  const key = builderKey(builder);
  if (!key) return null;
  return sortGuides(guides).find((g) => g.builder_match && builderKey(g.builder_match) === key) || null;
}

const versionEntry = (file, version, at) => ({ version, file_uri: file.file_uri, file_name: file.file_name, size: file.size, sha256: file.sha256, uploaded_at: at });

export function history(guide) {
  if (guide?.versions?.length) return guide.versions;
  return guide?.file_uri ? [versionEntry(guide, guide.version || 1, guide.created_date || '')] : [];
}

// A new guide record (version 1). file = { file_uri, file_name, size, sha256 }.
export function newGuide({ name, description = '', builder_match = '', price_per_opening = null, sort_order, file, source_drive_file_id = '', at = new Date().toISOString() }) {
  return {
    name: String(name || guideLabel(file.file_name)).trim(), description, builder_match, price_per_opening, sort_order, active: true,
    file_uri: file.file_uri, file_name: file.file_name, size: file.size, sha256: file.sha256,
    version: 1, versions: [versionEntry(file, 1, at)], ...(source_drive_file_id ? { source_drive_file_id } : {}),
  };
}

// Replacing the file adds the next version; the same file again is refused.
export function replaceFilePatch(guide, file, at = new Date().toISOString()) {
  const past = history(guide);
  const same = past.find((v) => v.sha256 && v.sha256 === file.sha256);
  if (same) throw new Error(`That is the same file as version ${same.version}.`);
  const version = Math.max(0, ...past.map((v) => v.version || 0)) + 1;
  return { file_uri: file.file_uri, file_name: file.file_name, size: file.size, sha256: file.sha256, version, versions: [...past, versionEntry(file, version, at)] };
}

// The exact version a job was pinned to, or null.
export function pinnedVersion(guide, version) {
  return history(guide).find((v) => v.version === Number(version)) || null;
}

// What the job keeps when its YA quote is saved: the guide, its current version and that file.
export function jobGuidePatch(guide) {
  if (!guide) return { flashing_method: null, flashing_guide_id: null, flashing_guide_version: null, flashing_guide_file_uri: null };
  return { flashing_method: guide.name, flashing_guide_id: guide.id, flashing_guide_version: guide.version || 1, flashing_guide_file_uri: guide.file_uri };
}

// Move one active guide up (-1) or down (+1); returns the { id, sort_order } changes, numbered 1..n.
export function moveGuide(guides, id, dir) {
  const list = sortGuides(guides);
  const at = list.findIndex((g) => g.id === id), to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return [];
  [list[at], list[to]] = [list[to], list[at]];
  return list.map((g, i) => ({ id: g.id, sort_order: i + 1 })).filter((p, i) => list[i].sort_order !== p.sort_order);
}

export function sizeLabel(bytes = 0) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
