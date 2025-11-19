import type { MaskingResult } from '@mask-cut/text-llm-core';

export interface ApprovalPreviewPayload {
  approvalSessionId: string;
  jobId: string;
  preview: MaskingResult;
}

export interface ApprovalTransport {
  presentPreview(payload: ApprovalPreviewPayload): Promise<void>;
  waitForDecision(approvalSessionId: string): Promise<import('./approvalController.js').ApprovalDecision>;
}
