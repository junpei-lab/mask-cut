import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LLMClient } from '@mask-cut/text-llm-core';

import { registerMcpHandlers } from '../mcpServer.js';
import { InMemoryStatusStore } from '../../workflow/statusStore.js';
import { MaskingWorkflow } from '../../workflow/maskingWorkflow.js';
import type { ApprovalDecision } from '../../approval/approvalController.js';
import { ApprovalControllerImpl } from '../../approval/controllerImpl.js';
import type { ApprovalTransport } from '../../approval/transport.js';
import type { ChatRelayAdapter, ChatRelayPayload } from '../../chat/chatRelayAdapter.js';
import type { AuditEntry } from '../../audit/auditTrailWriter.js';

class TestServer {
  readonly tools = new Map<string, (args: Record<string, unknown>) => Promise<any>>();
  readonly resources = new Map<string, () => Promise<any>>();

  tool(name: string, definition: { handler: (args: Record<string, unknown>) => Promise<any> }): void {
    this.tools.set(name, definition.handler);
  }

  resource(name: string, definition: { handler: () => Promise<any> }): void {
    this.resources.set(name, definition.handler);
  }
}

describe('MCP integration', () => {
  it('processes mask_text flow end-to-end with audit log and relay', async () => {
    const llm = new StubLLM();
    const statusStore = new InMemoryStatusStore();
    const transport = new StubApprovalTransport([{ type: 'approve' }]);
    const approval = new ApprovalControllerImpl({ transport });
    const relay = new RecordingChatRelay();
    const audit = new RecordingAuditTrail();

    const workflow = new MaskingWorkflow({
      llmClient: llm,
      approvalController: approval,
      chatRelay: relay,
      maskSensitiveInfo: async (client, text) => ({
        maskedText: (await client.complete({ model: '', prompt: text })).text,
        originalText: text,
      }),
      statusStore,
      config: { endpoint: 'local-endpoint', model: 'local-model' },
      auditTrailWriter: audit,
      idGenerator: buildIdGenerator(),
    });

    const server = new TestServer();
    registerMcpHandlers(server, {
      config: {
        endpointUrl: 'http://localhost:9999/v1',
        modelName: 'local-model',
        apiKey: 'key',
        vaultKeyId: 'vault',
        timeoutMs: 1_000,
      },
      workflow,
      statusFeed: statusStore,
      healthProbe: async () => ({ queueDepth: workflow.getQueueDepth(), approvalSessions: approval.getActiveSessionCount?.() ?? 0, localModelReady: true }),
    });

    const handler = server.tools.get('mask_text');
    assert.ok(handler);
    const response = await handler({ inputText: 'secret text', chatMessageId: 'chat-1' });
    const jobId = response.data.jobId;
    await workflow.waitForJob(jobId);

    assert.equal(relay.payloads.length, 1);
    assert.equal(relay.payloads[0]?.maskedText, '[MASKED] secret text');
    assert.equal(audit.entries[0]?.jobId, jobId);
    assert.equal(audit.entries[0]?.status, 'approved');

    const statusResource = server.resources.get('mask-cut://masking/status');
    assert.ok(statusResource);
    const snapshot = await statusResource();
    assert.ok(Array.isArray(snapshot.data.items));
    assert.notEqual(snapshot.data.items.find((event: any) => event.state === 'succeeded'), undefined);
  });
});

class StubLLM implements LLMClient {
  async complete({ prompt }: { prompt: string }): Promise<{ text: string }> {
    return { text: `[MASKED] ${prompt}` };
  }
}

class StubApprovalTransport implements ApprovalTransport {
  constructor(private readonly decisions: ApprovalDecision[]) {}

  async presentPreview(): Promise<void> {
    return;
  }

  async waitForDecision(_sessionId: string): Promise<ApprovalDecision> {
    const decision = this.decisions.shift();
    if (!decision) {
      throw new Error('decision queue empty');
    }
    return decision;
  }
}

class RecordingChatRelay implements ChatRelayAdapter {
  readonly payloads: ChatRelayPayload[] = [];

  async sendApprovedMessage(payload: ChatRelayPayload): Promise<void> {
    this.payloads.push(payload);
  }
}

class RecordingAuditTrail {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function buildIdGenerator() {
  let counter = 0;
  return () => `job-${++counter}`;
}
