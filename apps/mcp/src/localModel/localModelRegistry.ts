import { access, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve, isAbsolute, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LocalModelEngine = 'ollama' | 'llamaCpp' | 'customScript';

export interface LocalModelConfig {
  engine: LocalModelEngine;
  modelPath: string;
  modelName?: string;
  contextSize?: number;
}

export interface LocalModelRegistry {
  resolveActiveConfig(): Promise<LocalModelConfig>;
  assertOfflineMode(config: LocalModelConfig): Promise<void>;
}

export interface MutableLocalModelRegistry extends LocalModelRegistry {
  updateActiveConfig(config: LocalModelConfig): Promise<void>;
}

export class LocalModelRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalModelRegistryError';
  }
}

export interface LocalModelRegistryOptions {
  allowedScriptDirs?: string[];
}

export class FileSystemLocalModelRegistry implements MutableLocalModelRegistry {
  private active?: LocalModelConfig;

  private readonly allowedScriptDirs: string[];

  constructor(options: LocalModelRegistryOptions = {}) {
    const defaults = options.allowedScriptDirs ?? [process.cwd()];
    this.allowedScriptDirs = defaults.map((dir) => normalize(resolve(dir)));
  }

  async resolveActiveConfig(): Promise<LocalModelConfig> {
    if (!this.active) {
      throw new LocalModelRegistryError('Local model configuration has not been loaded yet');
    }
    return this.active;
  }

  async assertOfflineMode(config: LocalModelConfig): Promise<void> {
    if (config.engine === 'ollama') {
      this.assertOllamaConfig(config.modelPath);
      return;
    }

    const normalizedPath = this.normalizePath(config.modelPath);
    await this.ensureLocalPath(config.engine, normalizedPath);
  }

  async updateActiveConfig(config: LocalModelConfig): Promise<void> {
    await this.assertOfflineMode(config);
    this.active = this.normalizeConfig(config);
  }

  private normalizeConfig(config: LocalModelConfig): LocalModelConfig {
    if (config.engine === 'ollama') {
      const url = new URL(config.modelPath);
      return {
        ...config,
        modelPath: url.origin,
      };
    }

    return {
      ...config,
      modelPath: this.normalizePath(config.modelPath),
    };
  }

  private normalizePath(value: string): string {
    if (value.startsWith('file://')) {
      return fileURLToPath(value);
    }
    if (isAbsolute(value)) {
      return normalize(value);
    }
    return normalize(resolve(value));
  }

  private async ensureLocalPath(engine: LocalModelEngine, filePath: string): Promise<void> {
    if (/^https?:/i.test(filePath)) {
      throw new LocalModelRegistryError('Remote URLs are not allowed for local model paths');
    }

    try {
      await access(filePath, fsConstants.R_OK);
      const stats = await stat(filePath);

      if (!stats.isFile() && !stats.isDirectory()) {
        throw new LocalModelRegistryError('Local model path must be a file or directory');
      }

      if (engine === 'customScript') {
        this.ensureAllowedScriptDir(filePath);
      }
    } catch (error) {
      if (error instanceof LocalModelRegistryError) {
        throw error;
      }
      throw new LocalModelRegistryError(
        `Local model path '${filePath}' is not accessible: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private ensureAllowedScriptDir(filePath: string): void {
    const parent = normalize(resolve(dirname(filePath)));
    const allowed = this.allowedScriptDirs;

    const isAllowed = allowed.some((dir) => {
      if (!dir.endsWith(sep)) {
        return parent === dir || parent.startsWith(dir + sep);
      }
      return parent.startsWith(dir);
    });

    if (!isAllowed) {
      throw new LocalModelRegistryError(
        `customScript path must live under one of the allowed directories: ${allowed.join(', ')}`,
      );
    }
  }

  private assertOllamaConfig(modelPath: string): void {
    let url: URL;
    try {
      url = new URL(modelPath);
    } catch (error) {
      throw new LocalModelRegistryError(
        `Invalid Ollama endpoint '${modelPath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!/^https?:$/.test(url.protocol)) {
      throw new LocalModelRegistryError('Ollama endpoint must use http or https');
    }

    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (!localHosts.has(url.hostname)) {
      throw new LocalModelRegistryError('Ollama endpoint must point to localhost');
    }
  }
}
