import type { LLMClient, LLMRequest, LLMResponse } from '@mask-cut/text-llm-core';

import { MaskingOperationError } from '../errors.js';
import type {
  LocalModelConfig,
  LocalModelEngine,
  LocalModelRegistry,
} from '../localModel/localModelRegistry.js';
import { CustomScriptBackend } from './customScriptBackend.js';

export interface LocalLlmBackend {
  warmup(config: LocalModelConfig): Promise<void>;
  generate(config: LocalModelConfig, request: LLMRequest): Promise<LLMResponse>;
}

export type LocalLlmBackendFactory = (config: LocalModelConfig) => LocalLlmBackend;

export interface LocalLlmGatewayOptions {
  backends?: Partial<Record<LocalModelEngine, LocalLlmBackendFactory>>;
}

export class LocalLlmGateway implements LLMClient {
  private readonly backendCache = new Map<string, LocalLlmBackend>();

  private readonly warmedBackends = new Set<string>();

  constructor(
    private readonly registry: LocalModelRegistry,
    private readonly options: LocalLlmGatewayOptions = {},
  ) {}

  async warmup(): Promise<void> {
    const config = await this.registry.resolveActiveConfig();
    const key = this.buildCacheKey(config);
    if (this.warmedBackends.has(key)) {
      return;
    }
    const backend = this.getOrCreateBackend(config);
    await backend.warmup(config);
    this.warmedBackends.add(key);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const config = await this.registry.resolveActiveConfig();
    const backend = this.getOrCreateBackend(config);

    try {
      return await backend.generate(config, normalizeRequest(request, config));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MaskingOperationError(`Local LLM backend failed: ${message}`);
    }
  }

  private getOrCreateBackend(config: LocalModelConfig): LocalLlmBackend {
    const key = this.buildCacheKey(config);
    let backend = this.backendCache.get(key);
    if (backend) {
      return backend;
    }

    backend = this.createBackend(config);
    this.backendCache.set(key, backend);
    return backend;
  }

  private buildCacheKey(config: LocalModelConfig): string {
    return `${config.engine}:${config.modelPath}`;
  }

  private createBackend(config: LocalModelConfig): LocalLlmBackend {
    const factory =
      this.options.backends?.[config.engine] ?? this.createDefaultFactory(config.engine);
    if (!factory) {
      throw new Error(`No backend registered for engine ${config.engine}`);
    }
    return factory(config);
  }

  private createDefaultFactory(engine: LocalModelEngine): LocalLlmBackendFactory | undefined {
    if (engine === 'customScript') {
      return (config) => new CustomScriptBackend(config.modelPath);
    }
    return undefined;
  }
}

function normalizeRequest(request: LLMRequest, config: LocalModelConfig): LLMRequest {
  if (request.model?.trim()) {
    return request;
  }
  if (config.modelName) {
    return { ...request, model: config.modelName };
  }
  return { ...request, model: config.engine };
}
