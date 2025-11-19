import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerMcpHandlers, type McpServerAdapter } from '../mcpServer.js';
import type { MaskingStatusEvent } from '../../types/status.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ResourceHandler = () => Promise<unknown>;

class TestServer implements McpServerAdapter {
  readonly tools = new Map<string, ToolHandler>();
  readonly resources = new Map<string, ResourceHandler>();

  tool(name: string, definition: { handler: ToolHandler }): void {
    this.tools.set(name, definition.handler);
  }

  resource(name: string, definition: { handler: ResourceHandler }): void {
    this.resources.set(name, definition.handler);
  }
}

describe('registerMcpHandlers', () => {
  it('registers mask_text tool and delegates to workflow', async () => {
    const server = new TestServer();
    const calls: unknown[] = [];

    registerMcpHandlers(server, {
      config: buildConfig(),
      workflow: {
        async startMasking(input, options, chatMessageId) {
          calls.push({ input, options, chatMessageId });
          return { jobId: 'job-1', approvalSessionId: 'approval-1' };
        },
      },
      statusFeed: { getSnapshot: () => [] },
      healthProbe: async () => ({ queueDepth: 0, approvalSessions: 0, localModelReady: true }),
    });

    const handler = server.tools.get('mask_text');
    assert.ok(handler, 'mask_text handler should be registered');

    const response = (await handler({
      inputText: 'hello world',
      options: { maskUnknown: true },
      chatMessageId: 'msg-1',
    })) as { data: { jobId: string; approvalSessionId: string; statusResource: string } };

    assert.deepEqual(calls[0], {
      input: 'hello world',
      options: { maskUnknown: true },
      chatMessageId: 'msg-1',
    });
    assert.equal(response.data?.jobId, 'job-1');
    assert.equal(response.data?.approvalSessionId, 'approval-1');
    assert.equal(response.data?.statusResource, 'mask-cut://masking/status');
  });

  it('maps workflow errors to MCP error codes', async () => {
    const server = new TestServer();

    registerMcpHandlers(server, {
      config: buildConfig(),
      workflow: {
        async startMasking() {
          const error = new Error('LLM request failed');
          error.name = 'MaskingOperationError';
          throw error;
        },
      },
      statusFeed: { getSnapshot: () => [] },
      healthProbe: async () => ({ queueDepth: 0, approvalSessions: 0, localModelReady: true }),
    });

    const handler = server.tools.get('mask_text');
    assert.ok(handler);

    await assert.rejects(
      () => handler({ inputText: 'text' }),
      (error: unknown) => {
        const err = error as Error & { code?: string };
        assert.equal(err.code, 'E_MASK_FAILED');
        assert.match(err.message, /LLM request failed/);
        return true;
      },
    );
  });

  it('exposes masking status resource with latest snapshot', async () => {
    const statuses: MaskingStatusEvent[] = [
      { jobId: 'job-x', state: 'running', locked: true },
    ];
    const server = new TestServer();

    registerMcpHandlers(server, {
      config: buildConfig(),
      workflow: {
        async startMasking() {
          return { jobId: 'job-x', approvalSessionId: 'approval-x' };
        },
      },
      statusFeed: { getSnapshot: () => statuses },
      healthProbe: async () => ({ queueDepth: 1, approvalSessions: 2, localModelReady: true }),
    });

    const handler = server.resources.get('mask-cut://masking/status');
    assert.ok(handler);

    const payload = (await handler()) as { data: { items: MaskingStatusEvent[] } };
    assert.deepEqual(payload.data.items, statuses);
  });
  it('provides healthz resource via health probe', async () => {
    const server = new TestServer();

    registerMcpHandlers(server, {
      config: buildConfig(),
      workflow: {
        async startMasking() {
          return { jobId: 'job-x', approvalSessionId: 'approval-x' };
        },
      },
      statusFeed: { getSnapshot: () => [] },
      healthProbe: async () => ({ queueDepth: 3, approvalSessions: 1, localModelReady: false }),
    });

    const handler = server.resources.get('mask-cut://healthz');
    assert.ok(handler);
    const payload = (await handler()) as { data: { queueDepth: number; approvalSessions: number; localModelReady: boolean } };
    assert.equal(payload.data.queueDepth, 3);
    assert.equal(payload.data.approvalSessions, 1);
    assert.equal(payload.data.localModelReady, false);
  });
});

function buildConfig() {
  return {
    endpointUrl: 'http://localhost:1234/v1',
    modelName: 'local-model',
    apiKey: 'key',
    vaultKeyId: 'vault',
    timeoutMs: 1_000,
  };
}
