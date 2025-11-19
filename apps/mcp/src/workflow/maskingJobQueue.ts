import { EventEmitter } from 'node:events';

import type { MaskingOptions } from '@mask-cut/text-llm-core';

import type { MaskingStatusEvent, MaskingStatusListener } from '../types/status.js';

export type MaskingJobErrorCode =
  | 'E_USAGE'
  | 'E_NETWORK'
  | 'E_TIMEOUT'
  | 'E_MASK_FAILED'
  | 'E_INTERNAL'
  | 'E_CANCELLED';

export interface MaskingJobError {
  code: MaskingJobErrorCode;
  message: string;
}

export interface MaskingJob {
  id: string;
  text: string;
  options?: MaskingOptions;
  chatMessageId?: string;
  approvalSessionId: string;
  requestedAt: number;
}

export type MaskingJobProcessorResult =
  | {
      status: 'succeeded';
      maskedText: string;
      model: string;
      endpoint: string;
      finishedAt: number;
    }
  | {
      status: 'failed';
      error: MaskingJobError;
    };

export type MaskingJobProcessor = (job: MaskingJob) => Promise<MaskingJobProcessorResult>;

type QueuedJob = {
  job: MaskingJob;
  resolve: (result: MaskingJobProcessorResult) => void;
  cancelled?: boolean;
};

export class MaskingJobQueue {
  private readonly emitter = new EventEmitter();

  private readonly pending: QueuedJob[] = [];

  private running = false;

  private idlePromise: Promise<void> | null = null;

  private idleResolver: (() => void) | null = null;

  constructor(
    private readonly processor: MaskingJobProcessor,
    private readonly publishStatus: (event: MaskingStatusEvent) => void,
  ) {}

  enqueue(job: MaskingJob): Promise<MaskingJobProcessorResult> {
    return new Promise<MaskingJobProcessorResult>((resolve) => {
      const entry: QueuedJob = { job, resolve };
      this.pending.push(entry);
      this.emitStatus({ jobId: job.id, state: 'queued' });
      this.processNext();
    });
  }

  cancel(jobId: string): boolean {
    const index = this.pending.findIndex((entry) => entry.job.id === jobId);
    if (index === -1) {
      return false;
    }
    const [entry] = this.pending.splice(index, 1);
    entry.cancelled = true;
    entry.resolve({
      status: 'failed',
      error: { code: 'E_CANCELLED', message: 'Job was cancelled before execution.' },
    });
    this.emitStatus({
      jobId,
      state: 'failed',
      errorCode: 'E_CANCELLED',
      message: 'Job was cancelled before execution.',
    });
    this.resolveIdleIfNeeded();
    return true;
  }

  onStatus(listener: MaskingStatusListener): () => void {
    this.emitter.on('status', listener);
    return () => this.emitter.off('status', listener);
  }

  isLocked(): boolean {
    return this.running || this.pending.length > 0;
  }

  getDepth(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  async waitForIdle(): Promise<void> {
    if (!this.isLocked()) {
      return;
    }
    if (!this.idlePromise) {
      this.idlePromise = new Promise((resolve) => {
        this.idleResolver = resolve;
      });
    }
    return this.idlePromise;
  }

  private emitStatus(event: MaskingStatusEvent): void {
    const enriched = { ...event, locked: this.isLocked() };
    this.publishStatus(enriched);
    this.emitter.emit('status', enriched);
  }

  private async processNext(): Promise<void> {
    if (this.running) {
      return;
    }

    const entry = this.pending.shift();
    if (!entry) {
      this.resolveIdleIfNeeded();
      return;
    }

    if (entry.cancelled) {
      entry.resolve({
        status: 'failed',
        error: { code: 'E_CANCELLED', message: 'Job was cancelled before execution.' },
      });
      this.processNext();
      return;
    }

    this.running = true;
    this.emitStatus({ jobId: entry.job.id, state: 'running' });

    let result: MaskingJobProcessorResult;
    try {
      result = await this.processor(entry.job);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown job failure';
      result = {
        status: 'failed',
        error: { code: 'E_INTERNAL', message },
      };
    }

    this.running = false;

    if (result.status === 'succeeded') {
      this.emitStatus({
        jobId: entry.job.id,
        state: 'succeeded',
        maskedText: result.maskedText,
        model: result.model,
        endpoint: result.endpoint,
      });
    } else {
      this.emitStatus({
        jobId: entry.job.id,
        state: 'failed',
        errorCode: result.error.code,
        message: result.error.message,
      });
    }

    entry.resolve(result);
    this.processNext();
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isLocked() && this.idleResolver) {
      this.idleResolver();
      this.idleResolver = null;
      this.idlePromise = null;
    }
  }
}
