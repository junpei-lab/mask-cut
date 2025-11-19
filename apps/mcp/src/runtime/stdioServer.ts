import { stderr as processStderr } from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

import { createMcpRuntime, type MainOptions } from '../index.js';
import { registerMcpHandlers } from './mcpServer.js';
import { SdkServerAdapter } from './sdkAdapter.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { name: string; version: string };

export async function runStdioServer(options: MainOptions = {}): Promise<void> {
  const stderr = options.stderr ?? processStderr;
  try {
    const runtime = await createMcpRuntime({ env: options.env ?? process.env });
    const server = new McpServer({ name: pkg.name, version: pkg.version });
    const adapter = new SdkServerAdapter(server);
    registerMcpHandlers(adapter, runtime.deps);

    const registrations = adapter.listRegistrations();
    stderr.write(
      `STDIO MCP server ready (tools: ${registrations.tools.join(', ') || 'none'}, resources: ${
        registrations.resources.join(', ') || 'none'
      }).\n`,
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Failed to start STDIO MCP server: ${message}\n`);
    throw error;
  }
}

const executedDirectly = (() => {
  try {
    return fileURLToPath(import.meta.url) === (process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (executedDirectly) {
  runStdioServer().catch(() => {
    process.exitCode = process.exitCode || 1;
  });
}
