import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LLMClient, MaskingOptions, MaskingResult } from '@mask-cut/text-llm-core';

import { MaskingWorkflow } from '../maskingWorkflow.js';
import { InMemoryStatusStore } from '../statusStore.js';
import type { ApprovalController, ApprovalDecision } from '../../approval/approvalController.js';
import type { ChatRelayAdapter, ChatRelayPayload } from '../../chat/chatRelayAdapter.js';
import type { MaskingJobProcessorResult } from '../maskingJobQueue.js';
import type { AuditEntry } from '../../audit/auditTrailWriter.js';

class StubAuditTrailWriter {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class StubLLM implements LLMClient {
  constructor(private readonly responses: string[]) {}

  callCount = 0;

  async complete(): Promise<{ text: string }> {
    const text = this.responses[this.callCount] ?? 'masked';
    this.callCount += 1;
    return { text };
  }
}

class StubApprovalController implements ApprovalController {
  previews: MaskingResult[] = [];

  private readonly decisions: ApprovalDecision[];

  constructor(decisions: ApprovalDecision[]) {
    this.decisions = decisions;
  }

  async createSession(_jobId: string, preview: MaskingResult, sessionId?: string) {
    this.previews.push(preview);
    return { approvalSessionId: sessionId ?? `approval-${Math.random()}` };
  }

  async awaitDecision(): Promise<ApprovalDecision> {
    if (this.decisions.length === 0) {
      throw new Error('No decision queued');
    }
    return this.decisions.shift()!;
  }
}

class StubChatRelay implements ChatRelayAdapter {
  payloads: ChatRelayPayload[] = [];

  async sendApprovedMessage(payload: ChatRelayPayload): Promise<void> {
    this.payloads.push(payload);
  }
}

describe('MaskingWorkflow', () => {
  it('runs masking job, waits for approval, and relays approved text', async () => {
    const llm = new StubLLM(['masked text']);
    const approval = new StubApprovalController([{ type: 'approve' }]);
    const relay = new StubChatRelay();
    const statusStore = new InMemoryStatusStore();
    const auditTrail = new StubAuditTrailWriter();
    const workflow = createWorkflow({ llm, approval, relay, statusStore, auditTrail });

    const { jobId, approvalSessionId } = await workflow.startMasking('hello', { style: 'block' }, 'chat-1');
    assert.ok(jobId.startsWith('job-'));
    assert.ok(approvalSessionId.startsWith('approval-'));

    const result = await workflow.waitForJob(jobId);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.maskedText, 'masked text');

    assert.equal(relay.payloads.length, 1);
    assert.equal(relay.payloads[0]?.maskedText, 'masked text');

    const snapshot = statusStore.getSnapshot();
    const states = snapshot.filter((event) => event.jobId === jobId).map((event) => event.state);
    assert.deepEqual(states, ['queued', 'running', 'waiting-approval', 'succeeded']);

    const auditEntries = auditTrail.entries;
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0]?.jobId, jobId);
    assert.equal(auditEntries[0]?.status, 'approved');
  });

  it('returns failure when approval is rejected', async () => {
    const llm = new StubLLM(['masked']);
    const approval = new StubApprovalController([{ type: 'reject', reason: 'nope' }]);
    const relay = new StubChatRelay();
    const statusStore = new InMemoryStatusStore();
    const auditTrail = new StubAuditTrailWriter();
    const workflow = createWorkflow({ llm, approval, relay, statusStore, auditTrail });

    const { jobId } = await workflow.startMasking('input', {});
    const result = await workflow.waitForJob(jobId);

    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'E_USAGE');
    assert.equal(result.error.message, 'nope');
    assert.equal(relay.payloads.length, 0);

    const entry = auditTrail.entries[0];
    assert.equal(entry?.status, 'failed');
    assert.equal(entry?.decision, 'reject');
  });

  it('re-runs masking when approval decision is edit', async () => {
    const llm = new StubLLM(['first masked', 'second masked']);
    const approval = new StubApprovalController([
      { type: 'edit', revisedInput: 'edited input' },
      { type: 'approve' },
    ]);
    const relay = new StubChatRelay();
    const statusStore = new InMemoryStatusStore();
    const auditTrail = new StubAuditTrailWriter();
    const workflow = createWorkflow({ llm, approval, relay, statusStore, auditTrail });

    const { jobId } = await workflow.startMasking('initial input', {});
    const result = await workflow.waitForJob(jobId);

    assert.equal(result.status, 'succeeded');
    assert.equal(llm.callCount, 2);
    assert.equal(approval.previews.length, 2);
    assert.equal(relay.payloads[0]?.maskedText, 'second masked');
    assert.equal(auditTrail.entries[0]?.maskedBytes, 'second masked'.length);
  });
});

const workflowDeps = {
  auditTrail: new StubAuditTrailWriter(),
};

function createWorkflow({
  llm,
  approval,
  relay,
  statusStore,
  auditTrail,
}: {
  llm: LLMClient;
  approval: ApprovalController;
  relay: ChatRelayAdapter;
  statusStore: InMemoryStatusStore;
  auditTrail: StubAuditTrailWriter;
}) {
  const maskFn = async (_llm: LLMClient, _text: string, _options: MaskingOptions = {}): Promise<MaskingResult> => {
    const response = await llm.complete({ model: '', prompt: _text });
    return {
      maskedText: response.text,
      originalText: _text,
    };
  };

  const workflow = new MaskingWorkflow({
    llmClient: llm,
    approvalController: approval,
    chatRelay: relay,
    maskSensitiveInfo: maskFn,
    statusStore,
    config: { endpoint: 'local://model', model: 'local-model' },
    auditTrailWriter: auditTrail,
    idGenerator: buildIdGenerator(),
  });

  return workflow;
}

function buildIdGenerator() {
  let counter = 0;
  return () => `id-${++counter}`;
}
