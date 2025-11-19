import type { BootstrapConfig } from '../config/bootstrapConfig.js';
import type { MaskingStatusEvent } from '../types/status.js';

export interface MaskingWorkflowPort {
  startMasking(
    input: string,
    options?: Record<string, unknown>,
    chatMessageId?: string,
  ): Promise<{ jobId: string; approvalSessionId: string }>;
}

export interface StatusFeedPort {
  getSnapshot(): MaskingStatusEvent[];
}

export interface McpServerAdapter {
  tool(name: string, definition: { handler: ToolHandler }): void;
  resource(name: string, definition: { handler: ResourceHandler }): void;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResponse>;
type ResourceHandler = () => Promise<McpResourceResponse>;

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  data: {
    jobId: string;
    approvalSessionId: string;
    statusResource: string;
  };
}

export interface McpResourceResponse {
  data: unknown;
  mimeType: string;
}

export interface McpServerDependencies {
  config: BootstrapConfig;
  workflow: MaskingWorkflowPort;
  statusFeed: StatusFeedPort;
  healthProbe: () => Promise<HealthSnapshot>;
}

export interface HealthSnapshot {
  queueDepth: number;
  approvalSessions: number;
  localModelReady: boolean;
}

const STATUS_RESOURCE = 'mask-cut://masking/status';
const HEALTH_RESOURCE = 'mask-cut://healthz';

export function registerMcpHandlers(
  server: McpServerAdapter,
  deps: McpServerDependencies,
): void {
  server.tool('mask_text', {
    handler: createMaskTextHandler(deps),
  });

  server.resource(STATUS_RESOURCE, {
    handler: async () => ({
      mimeType: 'application/json',
      data: {
        items: deps.statusFeed.getSnapshot(),
      },
    }),
  });

  server.resource(HEALTH_RESOURCE, {
    handler: async () => ({
      mimeType: 'application/json',
      data: {
        endpoint: deps.config.endpointUrl,
        model: deps.config.modelName,
        timeoutMs: deps.config.timeoutMs,
        ...(await deps.healthProbe()),
      },
    }),
  });
}

function createMaskTextHandler(deps: McpServerDependencies): ToolHandler {
  return async (payload) => {
    const inputText = ensureInputText(payload.inputText);
    const options = normalizeOptions(payload.options);
    const chatMessageId = typeof payload.chatMessageId === 'string' ? payload.chatMessageId : undefined;

    try {
      const result = await deps.workflow.startMasking(inputText, options, chatMessageId);
      return {
        content: [
          {
            type: 'text',
            text: `mask_text job ${result.jobId} accepted. Track progress via ${STATUS_RESOURCE}.`,
          },
        ],
        data: {
          jobId: result.jobId,
          approvalSessionId: result.approvalSessionId,
          statusResource: STATUS_RESOURCE,
        },
      } satisfies McpToolResponse;
    } catch (error) {
      throw mapWorkflowError(error);
    }
  };
}

function ensureInputText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createToolError('E_USAGE', 'inputText is required');
  }
  return value;
}

function normalizeOptions(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function mapWorkflowError(error: unknown): McpToolError {
  if (error instanceof Error) {
    if (/network/i.test(error.message)) {
      return createToolError('E_NETWORK', error.message);
    }
    if (/timeout/i.test(error.message) || error.name === 'AbortError') {
      return createToolError('E_TIMEOUT', error.message);
    }
    if (/LLM request failed/i.test(error.message) || error.name === 'MaskingOperationError') {
      return createToolError('E_MASK_FAILED', error.message);
    }
    if (/invalid|required|missing/i.test(error.message)) {
      return createToolError('E_USAGE', error.message);
    }
    return createToolError('E_INTERNAL', error.message);
  }

  return createToolError('E_INTERNAL', String(error));
}

interface McpToolError extends Error {
  code: string;
}

function createToolError(code: string, message: string): McpToolError {
  const error = new Error(message) as McpToolError;
  error.code = code;
  return error;
}
