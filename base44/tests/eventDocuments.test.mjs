import assert from 'node:assert/strict';
import test from 'node:test';

import { eventAttachments, isGmailAttachmentUrl } from '../../src/lib/eventDocuments.js';

test('isGmailAttachmentUrl identifies Gmail-only attachment URLs', () => {
  assert.equal(isGmailAttachmentUrl('https://mail.google.com/?view=att&th=abc&attid=1'), true);
  assert.equal(isGmailAttachmentUrl('https://mail.google.com/mail/u/0/?view=att&th=abc'), true);
  assert.equal(isGmailAttachmentUrl('https://mail-attachment.googleusercontent.com/attachment/u/0/?ui=2'), true);
  assert.equal(isGmailAttachmentUrl('https://mail.google.com/?view=inbox'), false);
  assert.equal(isGmailAttachmentUrl('https://drive.google.com/file/d/abc/view'), false);
  assert.equal(isGmailAttachmentUrl('not a URL'), false);
});

test('eventAttachments retains Drive fields and dedupes by file_url', () => {
  const duplicateUrl = 'https://mail.google.com/?view=att&th=abc&attid=1';
  const attachments = eventAttachments([
    {
      event_attachments: [
        {
          title: 'Plans.pdf',
          file_url: duplicateUrl,
          mime_type: 'application/pdf',
          drive_file_id: 'drive-file-1',
          drive_url: 'https://drive.google.com/file/d/drive-file-1/view',
        },
      ],
    },
    {
      event_attachments: [
        { title: 'Duplicate.pdf', file_url: duplicateUrl },
        { title: 'Photo.jpg', file_url: 'https://example.com/photo.jpg' },
      ],
    },
  ]);

  assert.equal(attachments.length, 2);
  assert.deepEqual(attachments[0], {
    title: 'Plans.pdf',
    file_url: duplicateUrl,
    mime_type: 'application/pdf',
    drive_file_id: 'drive-file-1',
    drive_url: 'https://drive.google.com/file/d/drive-file-1/view',
  });
});
