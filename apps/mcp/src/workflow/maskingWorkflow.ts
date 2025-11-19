import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

import type { LLMClient, MaskingOptions, MaskingResult } from '@mask-cut/text-llm-core';

import { MaskingOperationError } from '../errors.js';
import type { ApprovalController, ApprovalDecision } from '../approval/approvalController.js';
import type { ChatRelayAdapter } from '../chat/chatRelayAdapter.js';
import type { MaskingStatusEvent, MaskingStatusListener } from '../types/status.js';
import {
  MaskingJobQueue,
  type MaskingJob,
  type MaskingJobProcessorResult,
  type MaskingJobError,
} from './maskingJobQueue.js';
import type { InMemoryStatusStore } from './statusStore.js';
import type { AuditTrailWriterPort, AuditEntry } from '../audit/auditTrailWriter.js';

export interface MaskingWorkflowConfig {
  endpoint: string;
  model: string;
}

export interface MaskingWorkflowDependencies {
  llmClient: LLMClient;
  approvalController: ApprovalController;
  chatRelay: ChatRelayAdapter;
  maskSensitiveInfo: (
    llm: LLMClient,
    input: string,
    options?: MaskingOptions,
  ) => Promise<MaskingResult>;
  statusStore: InMemoryStatusStore;
  config: MaskingWorkflowConfig;
  auditTrailWriter: AuditTrailWriterPort;
  idGenerator?: () => string;
  clock?: () => number;
}

export class MaskingWorkflow {
  private readonly queue: MaskingJobQueue;

  private readonly jobResults = new Map<string, Promise<MaskingJobProcessorResult>>();

  private readonly statusStore: InMemoryStatusStore;

  private readonly llm: LLMClient;

  private readonly approval: ApprovalController;

  private readonly chatRelay: ChatRelayAdapter;

  private readonly maskFn: (
    llm: LLMClient,
    input: string,
    options?: MaskingOptions,
  ) => Promise<MaskingResult>;

  private readonly config: MaskingWorkflowConfig;

  private readonly clock: () => number;

  private readonly generateId: () => string;

  private readonly auditTrailWriter: AuditTrailWriterPort;

  constructor(deps: MaskingWorkflowDependencies) {
    this.llm = deps.llmClient;
    this.approval = deps.approvalController;
    this.chatRelay = deps.chatRelay;
    this.maskFn = deps.maskSensitiveInfo;
    this.statusStore = deps.statusStore;
    this.config = deps.config;
    this.clock = deps.clock ?? (() => Date.now());
    this.generateId = deps.idGenerator ?? (() => nodeRandomUUID());
    this.auditTrailWriter = deps.auditTrailWriter;
    this.queue = new MaskingJobQueue(
      (job) => this.processJob(job),
      (event) => this.statusStore.publish(event),
    );
  }

  async startMasking(
    input: string,
    options: MaskingOptions = {},
    chatMessageId?: string,
  ): Promise<{ jobId: string; approvalSessionId: string }> {
    const jobId = `job-${this.generateId()}`;
    const approvalSessionId = `approval-${this.generateId()}`;
    const job: MaskingJob = {
      id: jobId,
      text: input,
      options,
      chatMessageId,
      approvalSessionId,
      requestedAt: this.clock(),
    };

    const resultPromise = this.queue.enqueue(job);
    this.jobResults.set(jobId, resultPromise);
    void resultPromise.finally(() => {
      const current = this.jobResults.get(jobId);
      if (current === resultPromise) {
        this.jobResults.delete(jobId);
      }
    });

    return { jobId, approvalSessionId };
  }

  async waitForJob(jobId: string): Promise<MaskingJobProcessorResult> {
    const result = this.jobResults.get(jobId);
    if (!result) {
      throw new Error(`Job ${jobId} is not registered`);
    }
    try {
      return await result;
    } finally {
      this.jobResults.delete(jobId);
    }
  }

  onStatus(listener: MaskingStatusListener): () => void {
    return this.statusStore.onStatus(listener);
  }

  getQueueDepth(): number {
    return this.queue.getDepth();
  }

  private async processJob(job: MaskingJob): Promise<MaskingJobProcessorResult> {
    const inputBytes = byteLength(job.text);
    try {
      return await this.runJob(job, inputBytes);
    } catch (error) {
      const mapped = mapError(error);
      await this.auditTrailWriter.record({
        jobId: job.id,
        status: 'failed',
        decision: 'error',
        inputBytes,
        errorCode: mapped.code,
        timestamp: this.clock(),
      });
      return {
        status: 'failed',
        error: mapped,
      };
    }
  }

  private async runJob(job: MaskingJob, inputBytes: number): Promise<MaskingJobProcessorResult> {
    let currentInput = job.text;

    while (true) {
      const maskingResult = await this.maskFn(this.llm, currentInput, job.options);
      const approvalSession = await this.approval.createSession(job.id, maskingResult, job.approvalSessionId);
      this.emitStatus({
        jobId: job.id,
        state: 'waiting-approval',
        maskedText: maskingResult.maskedText,
        model: this.config.model,
        endpoint: this.config.endpoint,
      });

      const decision = await this.approval.awaitDecision(approvalSession.approvalSessionId);
      if (decision.type === 'approve') {
        const maskedText = decision.editedText?.trim() ? decision.editedText : maskingResult.maskedText;
        const approvedAt = this.clock();
        await this.chatRelay.sendApprovedMessage({
          jobId: job.id,
          approvalSessionId: approvalSession.approvalSessionId,
          maskedText,
          chatMessageId: job.chatMessageId,
          model: this.config.model,
          endpoint: this.config.endpoint,
          approvedAt,
        });
        const relayedAt = this.clock();
        await this.recordAudit({
          jobId: job.id,
          status: 'approved',
          decision: 'approve',
          inputBytes,
          maskedBytes: byteLength(maskedText),
          approvedAt,
          relayedAt,
        });
        return {
          status: 'succeeded',
          maskedText,
          model: this.config.model,
          endpoint: this.config.endpoint,
          finishedAt: this.clock(),
        };
      }

      if (decision.type === 'reject') {
        await this.recordAudit({
          jobId: job.id,
          status: 'failed',
          decision: 'reject',
          inputBytes,
          errorCode: 'E_USAGE',
          timestamp: this.clock(),
        });
        return {
          status: 'failed',
          error: {
            code: 'E_USAGE',
            message: decision.reason ?? 'Masking was rejected by the user',
          },
        };
      }

      if (decision.type === 'edit') {
        currentInput = decision.revisedInput;
        this.emitStatus({ jobId: job.id, state: 'running' });
        continue;
      }
    }
  }

  private emitStatus(event: MaskingStatusEvent): void {
    this.statusStore.publish({ ...event, locked: this.queue.isLocked() });
  }

  private async recordAudit(entry: AuditEntry): Promise<void> {
    await this.auditTrailWriter.record(entry);
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

function mapError(error: unknown): MaskingJobError {
  if (error instanceof MaskingOperationError) {
    return { code: 'E_MASK_FAILED', message: error.message };
  }

  if (error instanceof Error) {
    if (/network/i.test(error.message)) {
      return { code: 'E_NETWORK', message: error.message };
    }
    if (/timeout/i.test(error.message) || error.name === 'AbortError') {
      return { code: 'E_TIMEOUT', message: error.message };
    }
    if (/invalid|required|missing/i.test(error.message)) {
      return { code: 'E_USAGE', message: error.message };
    }
    return { code: 'E_INTERNAL', message: error.message };
  }

  return { code: 'E_INTERNAL', message: 'Unknown masking error' };
}


