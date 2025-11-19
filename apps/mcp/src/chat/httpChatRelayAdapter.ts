import type { ChatRelayAdapter, ChatRelayPayload } from './chatRelayAdapter.js';

export interface ChatRelayAdapterOptions {
  endpointUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpChatRelayAdapter implements ChatRelayAdapter {
  private readonly endpointUrl: string;

  private readonly apiKey?: string;

  private readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;

  constructor(options: ChatRelayAdapterOptions) {
    this.endpointUrl = options.endpointUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendApprovedMessage(payload: ChatRelayPayload): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpointUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jobId: payload.jobId,
          approvalSessionId: payload.approvalSessionId,
          chatMessageId: payload.chatMessageId,
          maskedText: payload.maskedText,
          model: payload.model,
          endpoint: payload.endpoint,
          approvedAt: payload.approvedAt,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat relay failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      throw wrapRelayError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
}

function wrapRelayError(error: unknown): Error {
  if (error instanceof Error) {
    return error.name === 'AbortError'
      ? new Error('Chat relay failed: request timed out')
      : new Error(`Chat relay failed: ${error.message}`);
  }
  return new Error('Chat relay failed: unknown error');
}
