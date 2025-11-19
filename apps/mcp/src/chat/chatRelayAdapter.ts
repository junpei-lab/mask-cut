export interface ChatRelayPayload {
  jobId: string;
  approvalSessionId: string;
  maskedText: string;
  chatMessageId?: string;
  model: string;
  endpoint: string;
  approvedAt: number;
}

export interface ChatRelayAdapter {
  sendApprovedMessage(payload: ChatRelayPayload): Promise<void>;
}
