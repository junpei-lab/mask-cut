import type { McpServerAdapter, McpResourceResponse, McpToolResponse } from './mcpServer.js';

type ToolHandler = (payload: Record<string, unknown>) => Promise<McpToolResponse>;
type ResourceHandler = () => Promise<McpResourceResponse>;

export class LocalMcpServer implements McpServerAdapter {
  readonly tools = new Map<string, ToolHandler>();
  readonly resources = new Map<string, ResourceHandler>();

  tool(name: string, definition: { handler: ToolHandler }): void {
    this.tools.set(name, definition.handler);
  }

  resource(name: string, definition: { handler: ResourceHandler }): void {
    this.resources.set(name, definition.handler);
  }

  listRegistrations(): { tools: string[]; resources: string[] } {
    return {
      tools: Array.from(this.tools.keys()),
      resources: Array.from(this.resources.keys()),
    };
  }
}
