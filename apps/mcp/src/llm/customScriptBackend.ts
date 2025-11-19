import { pathToFileURL } from 'node:url';

import type { LLMRequest, LLMResponse } from '@mask-cut/text-llm-core';

import type { LocalModelConfig } from '../localModel/localModelRegistry.js';
import type { LocalLlmBackend } from './localLlmGateway.js';

export interface ScriptModuleContext {
  config: LocalModelConfig;
  env: NodeJS.ProcessEnv;
}

export interface ScriptModule {
  warmup?(context: ScriptModuleContext): Promise<void> | void;
  generate(request: LLMRequest, context: ScriptModuleContext): Promise<LLMResponse> | LLMResponse;
}

function ensureModuleExports(candidate: unknown, scriptPath: string): ScriptModule {
  const module = (candidate as { default?: ScriptModule }).default ?? candidate;
  if (!module || typeof (module as ScriptModule).generate !== 'function') {
    throw new Error(`Custom script '${scriptPath}' must export a 'generate' function.`);
  }
  return module as ScriptModule;
}

export class CustomScriptBackend implements LocalLlmBackend {
  private modulePromise: Promise<ScriptModule> | null = null;

  constructor(private readonly scriptPath: string) {}

  private loadModule(): Promise<ScriptModule> {
    if (!this.modulePromise) {
      this.modulePromise = (async () => {
        const url = pathToFileURL(this.scriptPath);
        const imported = await import(url.href);
        return ensureModuleExports(imported, this.scriptPath);
      })();
    }
    return this.modulePromise;
  }

  private buildContext(config: LocalModelConfig): ScriptModuleContext {
    return {
      config,
      env: process.env,
    };
  }

  async warmup(config: LocalModelConfig): Promise<void> {
    const module = await this.loadModule();
    if (typeof module.warmup === 'function') {
      await module.warmup(this.buildContext(config));
    }
  }

  async generate(config: LocalModelConfig, request: LLMRequest): Promise<LLMResponse> {
    const module = await this.loadModule();
    return module.generate(request, this.buildContext(config));
  }
}
