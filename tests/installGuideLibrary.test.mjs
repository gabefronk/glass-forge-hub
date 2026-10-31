// Install guides in the Hub (Oct 31): PDF header check, builder defaults, versions that never
// overwrite, and the exact version a job keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfProblem, sha256Hex, sortGuides, builderKey, builderDefault, importDefaults, newGuide, replaceFilePatch, pinnedVersion, jobGuidePatch, moveGuide, sizeLabel } from '../src/lib/installGuides.js';

const bytes = (s) => new TextEncoder().encode(s);
const file = (n, sha = `sha${n}`) => ({ file_uri: `private/guide-${n}.pdf`, file_name: `guide ${n}.pdf`, size: 1000 * n, sha256: sha });

test('a file needs a PDF header in its first 1 KB', () => {
  assert.equal(pdfProblem(bytes('%PDF-1.7\n...')), '');
  assert.equal(pdfProblem(bytes(`${' '.repeat(900)}%PDF-1.4`)), '');
  assert.match(pdfProblem(bytes(`${' '.repeat(1100)}%PDF-1.4`), 'Late.pdf'), /Late\.pdf is not a PDF/);
  assert.match(pdfProblem(bytes('\u0000MSMAMARPCRYPT....'), '1F Upgraded'), /^1F Upgraded is Microsoft-protected \(encrypted\), not a plain PDF\. Open it, save it again as a normal PDF/);
  assert.match(pdfProblem(new Uint8Array()), /not a PDF/);
});

test('sha256 of the bytes', async () => {
  assert.equal(await sha256Hex(bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('builder names match their default guide', () => {
  assert.equal(builderKey('HOLMES HOMES'), 'holmes');
  assert.equal(builderKey('Holmes'), 'holmes');
  assert.equal(builderKey('Pulte Homes'), builderKey('Pulte'));
  assert.equal(builderKey(''), '');
  const guides = [
    { id: 'std', name: '1F Standard', sort_order: 1 },
    { id: 'rec', name: 'Holmes recessed', builder_match: 'Holmes Homes', sort_order: 4 },
    { id: 'old', name: 'Old Holmes', builder_match: 'Holmes', sort_order: 2, active: false },
    { id: 'typ', name: 'Pulte Typar', builder_match: 'Pulte', sort_order: 5 },
  ];
  assert.equal(builderDefault(guides, 'HOLMES HOMES')?.id, 'rec');
  assert.equal(builderDefault(guides, 'Pulte Home')?.id, 'typ');
  assert.equal(builderDefault(guides, 'Pride Construction'), null);
  assert.equal(builderDefault(guides, ''), null);
  assert.deepEqual(sortGuides(guides).map((g) => g.id), ['std', 'rec', 'typ']);
  assert.deepEqual(sortGuides(guides, { retired: true }).map((g) => g.id), ['std', 'old', 'rec', 'typ']);
});

test('the Drive import cleans names and sets the Holmes and Pulte defaults', () => {
  assert.deepEqual(importDefaults('1F Standard Flat Wall Nail-on 405 NO Sill Pan (1).pdf'), { name: '1F Standard Flat Wall Nail-on 405 NO Sill Pan', builder_match: '' });
  assert.equal(importDefaults('HOLMES HOMES RECESSED WINDOW INSTALL.pdf').builder_match, 'Holmes Homes');
  assert.equal(importDefaults('NEW Pulte Typar - 1F Upgraded Flat Wall Nail Fin.pdf').builder_match, 'Pulte');
});

test('replacing the file adds a version and keeps every old file', () => {
  const g = { id: 'g1', ...newGuide({ name: 'Sill pan', file: file(1), sort_order: 3, at: 't1' }) };
  assert.equal(g.version, 1);
  assert.equal(g.active, true);
  assert.deepEqual(g.versions, [{ version: 1, file_uri: 'private/guide-1.pdf', file_name: 'guide 1.pdf', size: 1000, sha256: 'sha1', uploaded_at: 't1' }]);
  const v2 = { ...g, ...replaceFilePatch(g, file(2), 't2') };
  assert.equal(v2.version, 2);
  assert.equal(v2.file_uri, 'private/guide-2.pdf');
  assert.equal(v2.versions.length, 2);
  assert.equal(pinnedVersion(v2, 1).file_uri, 'private/guide-1.pdf');
  assert.equal(pinnedVersion(v2, '2').file_uri, 'private/guide-2.pdf');
  assert.equal(pinnedVersion(v2, 3), null);
  assert.throws(() => replaceFilePatch(v2, file(9, 'sha1')), /same file as version 1/);
});

test('a job keeps the guide version its customer approved', () => {
  const g = { id: 'g1', ...newGuide({ name: 'Sill pan', file: file(1) }) };
  const pinned = jobGuidePatch(g);
  assert.deepEqual(pinned, { flashing_method: 'Sill pan', flashing_guide_id: 'g1', flashing_guide_version: 1, flashing_guide_file_uri: 'private/guide-1.pdf' });
  const later = { ...g, ...replaceFilePatch(g, file(2)) };
  // The job still opens version 1's file after the guide moves on.
  assert.equal(pinnedVersion(later, pinned.flashing_guide_version).file_uri, pinned.flashing_guide_file_uri);
  assert.deepEqual(jobGuidePatch(null), { flashing_method: null, flashing_guide_id: null, flashing_guide_version: null, flashing_guide_file_uri: null });
});

test('moving a guide renumbers the active list', () => {
  const guides = [{ id: 'a', name: 'A', sort_order: 1 }, { id: 'b', name: 'B', sort_order: 2 }, { id: 'c', name: 'C' }];
  assert.deepEqual(moveGuide(guides, 'b', -1), [{ id: 'b', sort_order: 1 }, { id: 'a', sort_order: 2 }, { id: 'c', sort_order: 3 }]);
  assert.deepEqual(moveGuide(guides, 'a', -1), []);
  assert.equal(sizeLabel(3704260), '3.5 MB');
  assert.equal(sizeLabel(234780), '229 KB');
});
