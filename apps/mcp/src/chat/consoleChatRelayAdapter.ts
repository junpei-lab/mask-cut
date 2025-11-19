import type { ChatRelayAdapter, ChatRelayPayload } from './chatRelayAdapter.js';

export class ConsoleChatRelayAdapter implements ChatRelayAdapter {
  constructor(private readonly logger: Pick<Console, 'log'> = console) {}

  async sendApprovedMessage(payload: ChatRelayPayload): Promise<void> {
    this.logger.log('[chat-relay]', {
      jobId: payload.jobId,
      approvalSessionId: payload.approvalSessionId,
      chatMessageId: payload.chatMessageId,
      model: payload.model,
      endpoint: payload.endpoint,
    });
  }
}
