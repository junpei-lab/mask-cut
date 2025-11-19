import { randomUUID } from 'node:crypto';

import type { MaskingResult } from '@mask-cut/text-llm-core';

import type { ApprovalDecision, ApprovalController } from './approvalController.js';
import type { ApprovalTransport } from './transport.js';

interface ApprovalSessionRecord {
  jobId: string;
  approvalSessionId: string;
  preview: MaskingResult;
  state: 'pending' | 'previewing' | 'waiting' | 'approved' | 'rejected' | 'editing';
  history: ApprovalDecision[];
}

interface ApprovalControllerDependencies {
  transport: ApprovalTransport;
  clock?: () => number;
  idGenerator?: () => string;
}

export class ApprovalControllerImpl implements ApprovalController {
  private readonly sessions = new Map<string, ApprovalSessionRecord>();

  private readonly transport: ApprovalTransport;

  private readonly clock: () => number;

  private readonly idGenerator: () => string;

  constructor(deps: ApprovalControllerDependencies) {
    this.transport = deps.transport;
    this.clock = deps.clock ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? (() => randomUUID());
  }

  async createSession(
    jobId: string,
    preview: MaskingResult,
    sessionId?: string,
  ): Promise<{ approvalSessionId: string }> {
    const approvalSessionId = sessionId ?? `approval-${this.idGenerator()}`;
    const record: ApprovalSessionRecord = {
      jobId,
      approvalSessionId,
      preview,
      state: 'previewing',
      history: [],
    };
    this.sessions.set(approvalSessionId, record);

    await this.transport.presentPreview({ approvalSessionId, jobId, preview });
    return { approvalSessionId };
  }

  async awaitDecision(sessionId: string): Promise<ApprovalDecision> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown approval session: ${sessionId}`);
    }

    session.state = 'waiting';
    const decision = await this.transport.waitForDecision(sessionId);
    session.history.push(decision);

    switch (decision.type) {
      case 'approve':
        session.state = 'approved';
        break;
      case 'reject':
        session.state = 'rejected';
        break;
      case 'edit':
        session.state = 'editing';
        break;
      default:
        session.state = 'waiting';
        break;
    }

    return decision;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}
