import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AuditDecision = 'approve' | 'reject' | 'error';

export interface AuditEntry {
  jobId: string;
  status: 'approved' | 'failed';
  decision: AuditDecision;
  inputBytes: number;
  maskedBytes?: number;
  approvedAt?: number;
  relayedAt?: number;
  errorCode?: string;
  timestamp?: number;
}

export interface AuditTrailWriterOptions {
  filePath?: string;
}

export interface AuditTrailWriterPort {
  record(entry: AuditEntry): Promise<void>;
}

export class AuditTrailWriter implements AuditTrailWriterPort {
  constructor(private readonly options: AuditTrailWriterOptions = {}) {}

  async record(entry: AuditEntry): Promise<void> {
    const filePath = this.options.filePath;
    if (!filePath) {
      return;
    }

    await mkdir(dirname(filePath), { recursive: true });
    const payload = JSON.stringify({ ...entry, timestamp: entry.timestamp ?? Date.now() });
    await appendFile(filePath, `${payload}\n`, 'utf-8');
  }
}
