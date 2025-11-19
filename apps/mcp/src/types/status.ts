export type MaskingJobState = 'queued' | 'running' | 'waiting-approval' | 'succeeded' | 'failed';

export interface MaskingStatusEvent {
  jobId: string;
  state: MaskingJobState;
  locked?: boolean;
  maskedText?: string;
  model?: string;
  endpoint?: string;
  message?: string;
  errorCode?: string;
}

export type MaskingStatusListener = (event: MaskingStatusEvent) => void;
