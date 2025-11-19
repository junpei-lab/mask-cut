import type { ApprovalDecision } from './approvalController.js';
import type { ApprovalPreviewPayload, ApprovalTransport } from './transport.js';

export class AutoApprovalTransport implements ApprovalTransport {
  private readonly previews = new Map<string, ApprovalPreviewPayload>();

  async presentPreview(payload: ApprovalPreviewPayload): Promise<void> {
    this.previews.set(payload.approvalSessionId, payload);
  }

  async waitForDecision(_approvalSessionId: string): Promise<ApprovalDecision> {
    return { type: 'approve' };
  }
}
