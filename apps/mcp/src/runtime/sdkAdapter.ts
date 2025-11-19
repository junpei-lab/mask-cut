import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import type { McpServerAdapter, McpResourceResponse, McpToolResponse } from './mcpServer.js';
import { z } from 'zod';

type GenericToolInput = Record<string, unknown>;

const GenericToolInputSchema = z.object({}).passthrough();

export class SdkServerAdapter implements McpServerAdapter {
  private readonly tools: string[] = [];

  private readonly resources: string[] = [];

  constructor(private readonly server: McpServer) {}

  tool(name: string, definition: { handler: (args: Record<string, unknown>) => Promise<McpToolResponse> }): void {
    this.tools.push(name);

    this.server.registerTool(
      name,
      {
        description: `Mask-Cut MCP tool ${name}`,
      },
      async (args: Record<string, unknown>, _extra: unknown) => {
        const parsed = GenericToolInputSchema.safeParse(args);
        const payload: GenericToolInput = parsed.success ? (parsed.data as GenericToolInput) : {};
        try {
          const response = await definition.handler(payload);
          return {
            content: response.content,
            structuredContent: response.data,
          };
        } catch (error) {
          return mapToolError(error);
        }
      },
    );
  }

  resource(name: string, definition: { handler: () => Promise<McpResourceResponse> }): void {
    this.resources.push(name);

    this.server.registerResource(
      name,
      name,
      {
        description: `Mask-Cut MCP resource ${name}`,
      },
      async () => {
        const response = await definition.handler();
        const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
        return {
          contents: [
            {
              uri: name,
              mimeType: response.mimeType,
              text,
            },
          ],
        };
      },
    );
  }

  listRegistrations(): { tools: string[]; resources: string[] } {
    return {
      tools: [...this.tools],
      resources: [...this.resources],
    };
  }
}

function mapToolError(error: unknown): CallToolResult {
  const code = isToolError(error) ? error.code : 'E_INTERNAL';
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: 'text',
        text: `[${code}] ${message}`,
      },
    ],
    structuredContent: { code, message },
    isError: true,
  };
}

function isToolError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}
