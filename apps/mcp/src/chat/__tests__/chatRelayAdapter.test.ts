import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpChatRelayAdapter } from '../httpChatRelayAdapter.js';
import type { ChatRelayPayload } from '../chatRelayAdapter.js';

class StubResponse {
  constructor(public readonly ok: boolean, public readonly status = 200, public readonly statusText = 'OK') {}
  async json() {
    return { status: 'ok' };
  }
}

describe('HttpChatRelayAdapter', () => {
  it('sends payload to configured endpoint via fetch', async () => {
    const requests: { url: string; body: any }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return new StubResponse(true) as unknown as Response;
    };

    const adapter = new HttpChatRelayAdapter({
      endpointUrl: 'http://localhost:9999/relay',
      fetchImpl,
    });

    const payload: ChatRelayPayload = {
      jobId: 'job-1',
      approvalSessionId: 'approval-1',
      maskedText: 'masked-text',
      model: 'local-model',
      endpoint: 'local-endpoint',
      chatMessageId: 'chat-1',
      approvedAt: Date.now(),
    };

    await adapter.sendApprovedMessage(payload);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://localhost:9999/relay');
    assert.equal(requests[0]?.body.maskedText, 'masked-text');
  });

  it('throws descriptive error when response is not ok', async () => {
    const fetchImpl: typeof fetch = async () => new StubResponse(false, 500, 'Server Error') as unknown as Response;
    const adapter = new HttpChatRelayAdapter({ endpointUrl: 'http://localhost:9999/relay', fetchImpl });

    await assert.rejects(() => adapter.sendApprovedMessage(buildPayload()), /Chat relay failed/);
  });
});

function buildPayload(): ChatRelayPayload {
  return {
    jobId: 'job-x',
    approvalSessionId: 'approval-x',
    maskedText: 'text',
    model: 'model',
    endpoint: 'endpoint',
    approvedAt: Date.now(),
  };
}
