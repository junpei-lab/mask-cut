import type { MaskingResult } from '@mask-cut/text-llm-core';

export type ApprovalDecision =
  | { type: 'approve'; editedText?: string }
  | { type: 'reject'; reason?: string }
  | { type: 'edit'; revisedInput: string };

export interface ApprovalController {
  createSession(
    jobId: string,
    preview: MaskingResult,
    sessionId?: string,
  ): Promise<{ approvalSessionId: string }>;
  awaitDecision(sessionId: string): Promise<ApprovalDecision>;
  getActiveSessionCount?(): number;
}
