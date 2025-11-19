import { stderr as processStderr } from 'node:process';
import { fileURLToPath } from 'node:url';

import { maskSensitiveInfo } from '@mask-cut/text-llm-core';

import { BootstrapConfigError, resolveBootstrapConfig } from './config/bootstrapConfig.js';
import { ConfigurationService } from './config/configurationService.js';
import { SecureStoreAdapter } from './config/secureStoreAdapter.js';
import { FileSystemLocalModelRegistry } from './localModel/localModelRegistry.js';
import { LocalLlmGateway } from './llm/localLlmGateway.js';
import { MaskingWorkflow } from './workflow/maskingWorkflow.js';
import { InMemoryStatusStore } from './workflow/statusStore.js';
import { AuditTrailWriter } from './audit/auditTrailWriter.js';
import { AutoApprovalTransport } from './approval/autoApprovalTransport.js';
import { ApprovalControllerImpl } from './approval/controllerImpl.js';
import { ConsoleChatRelayAdapter } from './chat/consoleChatRelayAdapter.js';
import { LocalMcpServer } from './runtime/localServer.js';
import { registerMcpHandlers, type McpServerDependencies } from './runtime/mcpServer.js';

export interface MainOptions {
  env?: Record<string, string | undefined>;
  stderr?: NodeJS.WritableStream;
}

export interface RuntimeOptions {
  env?: Record<string, string | undefined>;
}

export interface RuntimeContext {
  deps: McpServerDependencies;
  approvalController: ApprovalControllerImpl;
  workflow: MaskingWorkflow;
  registry: FileSystemLocalModelRegistry;
  statusStore: InMemoryStatusStore;
}

export async function createMcpRuntime(options: RuntimeOptions = {}): Promise<RuntimeContext> {
  const env = options.env ?? process.env;
  const config = resolveBootstrapConfig(env);
  const settingsPath = resolveSettingsPath();
  const localModelsDir = resolveLocalModelsDir();
  const defaultLocalModelPath = resolveDefaultLocalModelPath();

  const registry = new FileSystemLocalModelRegistry({
    allowedScriptDirs: [process.cwd(), localModelsDir],
  });
  const configurationService = new ConfigurationService({
    settingsPath,
    secretStore: new SecureStoreAdapter(),
    registry,
    defaultLocalModel: { engine: 'customScript', modelPath: defaultLocalModelPath },
  });

  const settings = await configurationService.load();

  const statusStore = new InMemoryStatusStore();
  const llmGateway = new LocalLlmGateway(registry);
  const approvalController = new ApprovalControllerImpl({
    transport: new AutoApprovalTransport(),
  });
  const chatRelay = new ConsoleChatRelayAdapter();
  const auditTrailWriter = new AuditTrailWriter({ filePath: settings.logFile });
  const workflow = new MaskingWorkflow({
    llmClient: llmGateway,
    approvalController,
    chatRelay,
    maskSensitiveInfo,
    statusStore,
    config: { endpoint: config.endpointUrl, model: config.modelName },
    auditTrailWriter,
  });

  const deps: McpServerDependencies = {
    config,
    workflow,
    statusFeed: statusStore,
    healthProbe: () => buildHealthSnapshot(workflow, approvalController, registry),
  };

  return {
    deps,
    approvalController,
    workflow,
    registry,
    statusStore,
  };
}

export async function main(options: MainOptions = {}): Promise<void> {
  const stderr = options.stderr ?? processStderr;

  try {
    const runtime = await createMcpRuntime({ env: options.env ?? process.env });
    const server = new LocalMcpServer();
    registerMcpHandlers(server, runtime.deps);

    const registrations = server.listRegistrations();
    stderr.write(
      `Registered MCP handlers (tools: ${registrations.tools.join(', ') || 'none'}, resources: ${registrations.resources.join(', ') || 'none'}).\n`,
    );
  } catch (error) {
    if (error instanceof BootstrapConfigError) {
      stderr.write(`${error.message}\n`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Failed to bootstrap MCP server: ${message}\n`);
    }
    throw error;
  }
}

function resolveSettingsPath(): string {
  return fileURLToPath(new URL('../config/settings.json', import.meta.url));
}

function resolveLocalModelsDir(): string {
  return fileURLToPath(new URL('../local-models', import.meta.url));
}

function resolveDefaultLocalModelPath(): string {
  return fileURLToPath(new URL('../local-models/remote-openai-backend.mjs', import.meta.url));
}

async function buildHealthSnapshot(
  workflow: MaskingWorkflow,
  approvalController: ApprovalControllerImpl,
  registry: FileSystemLocalModelRegistry,
) {
  return {
    queueDepth: workflow.getQueueDepth(),
    approvalSessions: approvalController.getActiveSessionCount?.() ?? 0,
    localModelReady: await isLocalModelReady(registry),
  };
}

async function isLocalModelReady(registry: FileSystemLocalModelRegistry): Promise<boolean> {
  try {
    await registry.resolveActiveConfig();
    return true;
  } catch {
    return false;
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
  main().catch(() => {
    process.exitCode = process.exitCode || 1;
  });
}






