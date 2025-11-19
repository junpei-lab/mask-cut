import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { AuditTrailWriter, type AuditEntry } from '../auditTrailWriter.js';

describe('AuditTrailWriter', () => {
  it('appends audit entries as JSON lines without raw text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audit-writer-'));
    const file = join(dir, 'audit.log');
    const writer = new AuditTrailWriter({ filePath: file });

    const entry: AuditEntry = {
      jobId: 'job-1',
      status: 'approved',
      decision: 'approve',
      inputBytes: 12,
      maskedBytes: 10,
      approvedAt: 123,
      relayedAt: 456,
    };

    await writer.record(entry);

    const raw = await readFile(file, 'utf-8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.jobId, 'job-1');
    assert.equal(parsed.inputBytes, 12);
    assert.equal(parsed.maskedBytes, 10);
    assert.equal(parsed.decision, 'approve');
    assert.ok(!parsed.originalText);
  });

  it('skips writing when no file path is configured', async () => {
    const writer = new AuditTrailWriter();

    await writer.record({
      jobId: 'job-1',
      status: 'failed',
      decision: 'reject',
      inputBytes: 10,
    });
  });
});
