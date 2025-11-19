import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MaskingResult } from '@mask-cut/text-llm-core';

import { ApprovalControllerImpl } from '../controllerImpl.js';
import type { ApprovalDecision } from '../approvalController.js';
import type { ApprovalPreviewPayload, ApprovalTransport } from '../transport.js';

describe('ApprovalControllerImpl', () => {
  it('creates session with provided id and forwards preview to transport', async () => {
    const transport = new StubTransport([{ type: 'approve' }]);
    const controller = new ApprovalControllerImpl({ transport, idGenerator: () => 'session' });

    const result = await controller.createSession('job-1', buildPreview(), 'approval-job-1');

    assert.equal(result.approvalSessionId, 'approval-job-1');
    assert.equal(transport.previews[0]?.approvalSessionId, 'approval-job-1');

    const decision = await controller.awaitDecision(result.approvalSessionId);
    assert.equal(decision.type, 'approve');
  });

  it('throws when awaiting decision for unknown session', async () => {
    const transport = new StubTransport([{ type: 'approve' }]);
    const controller = new ApprovalControllerImpl({ transport });

    await assert.rejects(() => controller.awaitDecision('missing'), /Unknown approval session/);
  });
});

class StubTransport implements ApprovalTransport {
  readonly previews: ApprovalPreviewPayload[] = [];

  constructor(private readonly decisions: ApprovalDecision[]) {}

  async presentPreview(payload: ApprovalPreviewPayload): Promise<void> {
    this.previews.push(payload);
  }

  async waitForDecision(_sessionId: string): Promise<ApprovalDecision> {
    const decision = this.decisions.shift();
    if (!decision) {
      throw new Error('No decision queued');
    }
    return decision;
  }
}

function buildPreview(): MaskingResult {
  return {
    maskedText: 'masked',
    originalText: 'original',
  };
}
