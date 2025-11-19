import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { LLMRequest, LLMResponse } from '@mask-cut/text-llm-core';

import { LocalLlmGateway } from '../localLlmGateway.js';
import type {
  LocalModelConfig,
  LocalModelRegistry,
} from '../../localModel/localModelRegistry.js';

class StubRegistry implements LocalModelRegistry {
  constructor(private config: LocalModelConfig) {}

  async resolveActiveConfig(): Promise<LocalModelConfig> {
    return this.config;
  }

  async assertOfflineMode(): Promise<void> {
    // noop for tests
  }
}

type BackendCall = {
  config: LocalModelConfig;
  request: LLMRequest;
};

function createGateway(options: {
  config: LocalModelConfig;
  response?: LLMResponse;
  backendError?: Error;
}) {
  const calls: BackendCall[] = [];
  const backend = {
    warmupCalls: 0,
    async warmup() {
      this.warmupCalls += 1;
    },
    async generate(config: LocalModelConfig, request: LLMRequest): Promise<LLMResponse> {
      calls.push({ config, request });
      if (options.backendError) {
        throw options.backendError;
      }
      return options.response ?? { text: 'ok' };
    },
  };

  const gateway = new LocalLlmGateway(new StubRegistry(options.config), {
    backends: {
      [options.config.engine]: () => backend,
    },
  });

  return { gateway, backend, calls };
}

describe('LocalLlmGateway', () => {
  it('delegates complete requests to backend for resolved config', async () => {
    const config: LocalModelConfig = {
      engine: 'llamaCpp',
      modelPath: '/models/local.gguf',
    };

    const { gateway, calls } = createGateway({ config });

    const response = await gateway.complete({ model: 'ignored', prompt: 'hello' });

    assert.equal(response.text, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.config.modelPath, config.modelPath);
    assert.equal(calls[0]?.request.prompt, 'hello');
  });

  it('runs backend warmup only once per config', async () => {
    const config: LocalModelConfig = { engine: 'llamaCpp', modelPath: '/models/a.gguf' };
    const { gateway, backend } = createGateway({ config });

    await gateway.warmup();
    await gateway.warmup();

    assert.equal(backend.warmupCalls, 1);
  });

  it('throws descriptive error when backend is not registered', async () => {
    const registry = new StubRegistry({ engine: 'ollama', modelPath: 'http://localhost:11434' });
    const gateway = new LocalLlmGateway(registry, { backends: {} });

    await assert.rejects(() => gateway.complete({ model: '', prompt: 'text' }), /No backend registered/);
  });

  it('uses customScript backend by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-script-'));
    const scriptPath = join(dir, 'echo-backend.mjs');
    writeFileSync(
      scriptPath,
      "export async function generate(request) { return { text: request.prompt.toUpperCase() }; }",
      'utf-8',
    );

    const registry = new StubRegistry({ engine: 'customScript', modelPath: scriptPath });
    const gateway = new LocalLlmGateway(registry);

    const result = await gateway.complete({ model: '', prompt: 'hello world' });

    assert.equal(result.text, 'HELLO WORLD');
  });

  it('wraps backend errors as MaskingOperationError', async () => {
    const backendError = new Error('backend failed');
    const config: LocalModelConfig = { engine: 'ollama', modelPath: 'http://127.0.0.1:11434' };
    const { gateway } = createGateway({ config, backendError });

    await assert.rejects(
      () => gateway.complete({ model: '', prompt: 'hello' }),
      (error: unknown) => {
        const err = error as Error & { name?: string };
        assert.equal(err.name, 'MaskingOperationError');
        assert.match(err.message, /backend failed/);
        return true;
      },
    );
  });
});
