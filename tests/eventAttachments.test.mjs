import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveAttachmentMetadata, isGmailOnlyAttachment } from '../base44/shared/eventAttachments.js';
import { eventAttachments, preferredAttachmentSource } from '../src/lib/eventDocuments.js';

test('calendar sync preservation retains every drive and private Hub field', () => {
  const prior = [{
    title: 'old', file_url: 'https://drive.google.com/file/d/abc/view', mime_type: 'old/type',
    drive_file_id: 'abc', drive_url: 'https://drive.google.com/open?id=abc', rehosted_at: '2026-01-01T00:00:00.000Z',
    hub_file_uri: 'private://abc', hub_uploaded_at: '2026-01-02T00:00:00.000Z', hub_size: 42,
    hub_sha256: 'digest', hub_error: '',
  }];
  const [result] = preserveAttachmentMetadata([{ title: 'new', file_url: prior[0].file_url, mime_type: 'application/pdf' }], prior);
  assert.equal(result.title, 'new');
  for (const field of ['drive_file_id', 'drive_url', 'rehosted_at', 'hub_file_uri', 'hub_uploaded_at', 'hub_size', 'hub_sha256', 'hub_error']) {
    assert.equal(result[field], prior[0][field]);
  }
});

test('document source preference is Hub, then Drive, then original URL', () => {
  assert.equal(preferredAttachmentSource({ hub_file_uri: 'private:x', drive_url: 'drive', file_url: 'file' }), 'hub');
  assert.equal(preferredAttachmentSource({ drive_url: 'drive', file_url: 'file' }), 'drive');
  assert.equal(preferredAttachmentSource({ file_url: 'file' }), 'file');
  const [attachment] = eventAttachments([{ id: 'event-1', event_attachments: [{ file_url: 'file', hub_file_uri: 'private:x' }] }]);
  assert.deepEqual([attachment.event_id, attachment.attachment_index, attachment.has_hub_copy], ['event-1', 0, true]);
  assert.equal(attachment.hub_file_uri, undefined, 'private storage URI is omitted from the view model');
});

test('gmail-only attachments remain flagged until a Hub or Drive copy exists', () => {
  const gmail = { file_url: 'https://mail.google.com/mail/u/0/?view=att&id=1' };
  assert.equal(isGmailOnlyAttachment(gmail), true);
  assert.equal(isGmailOnlyAttachment({ ...gmail, hub_file_uri: 'private:x' }), false);
  assert.equal(isGmailOnlyAttachment({ ...gmail, drive_url: 'https://drive.google.com/x' }), false);
});
