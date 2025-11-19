import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';

import type {
  LocalModelConfig,
  MutableLocalModelRegistry,
} from '../localModel/localModelRegistry.js';
import type { SecretStore } from './secureStoreAdapter.js';

const SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface McpSettingsRecord {
  endpointLabel: string;
  timeoutMs: number;
  localModel: LocalModelConfig;
  logFile?: string;
}

interface StoredSettingsRecord extends McpSettingsRecord {
  schemaVersion: number;
  updatedAt: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ConfigurationValidationError extends Error {
  readonly issues: Record<string, string>;

  constructor(message: string, issues: Record<string, string>) {
    super(message);
    this.name = 'ConfigurationValidationError';
    this.issues = issues;
  }
}

export interface ConfigurationServiceOptions {
  settingsPath: string;
  secretStore: SecretStore;
  registry: MutableLocalModelRegistry;
  env?: Record<string, string | undefined>;
  clock?: () => number;
  defaultLocalModel?: LocalModelConfig;
}

export class ConfigurationService {
  private cache: McpSettingsRecord | null = null;

  private readonly settingsPath: string;

  private readonly secretStore: SecretStore;

  private readonly registry: MutableLocalModelRegistry;

  private readonly env: Record<string, string | undefined>;

  private readonly clock: () => number;

  private readonly defaultLocalModel: LocalModelConfig;

  constructor(options: ConfigurationServiceOptions) {
    this.settingsPath = options.settingsPath;
    this.secretStore = options.secretStore;
    this.registry = options.registry;
    this.env = options.env ?? process.env;
    this.clock = options.clock ?? (() => Date.now());
    this.defaultLocalModel =
      options.defaultLocalModel ?? buildDefaultLocalModel(resolvePath(process.cwd(), 'apps/mcp/local-models/remote-openai-backend.mjs'));
  }

  async load(): Promise<McpSettingsRecord> {
    if (this.cache) {
      return this.cache;
    }

    const stored = await this.readSettingsFile();
    if (stored) {
      const record = this.normalizeRecord(stored);
      try {
        await this.validate(record);
        await this.registry.updateActiveConfig(record.localModel);
        this.cache = record;
        return record;
      } catch (error) {
        if (error instanceof ConfigurationValidationError && error.issues.localModel) {
          const repaired = { ...record, localModel: this.defaultLocalModel };
          await this.validate(repaired);
          await this.persist(repaired);
          await this.registry.updateActiveConfig(repaired.localModel);
          this.cache = repaired;
          return repaired;
        }
        throw error;
      }
    }
    const seed = await this.buildSeedRecord();
    await this.validate(seed.record);
    await this.persist(seed.record);
    if (seed.apiKey) {
      await this.secretStore.setSecret(seed.record.endpointLabel, seed.apiKey);
    }
    await this.registry.updateActiveConfig(seed.record.localModel);
    this.cache = seed.record;
    return seed.record;
  }

  async validate(input: Partial<McpSettingsRecord>): Promise<void> {
    const issues: Record<string, string> = {};
    const endpointLabel = input.endpointLabel?.trim();

    if (!endpointLabel) {
      issues.endpointLabel = 'endpointLabel is required';
    }

    if (typeof input.timeoutMs !== 'number' || Number.isNaN(input.timeoutMs)) {
      issues.timeoutMs = 'timeoutMs must be a number';
    } else if (input.timeoutMs <= 0) {
      issues.timeoutMs = 'timeoutMs must be greater than 0';
    }

    const localModel = input.localModel;
    let shouldVerifyLocalModel = false;
    if (!localModel) {
      issues.localModel = 'localModel configuration is required';
    } else if (!isValidEngine(localModel.engine)) {
      issues.localModel = 'localModel.engine must be ollama, llamaCpp, or customScript';
    } else if (!localModel.modelPath?.trim()) {
      issues.localModel = 'localModel.modelPath is required';
    } else {
      shouldVerifyLocalModel = true;
    }

    if (shouldVerifyLocalModel) {
      try {
        await this.registry.assertOfflineMode(localModel!);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.localModel = message;
      }
    }

    if (Object.keys(issues).length > 0) {
      throw new ConfigurationValidationError('Configuration validation failed', issues);
    }
  }

  async save(record: McpSettingsRecord, apiKey?: string): Promise<void> {
    const normalized = this.normalizeRecord(record);
    await this.validate(normalized);
    await this.persist(normalized);
    if (apiKey) {
      await this.secretStore.setSecret(normalized.endpointLabel, apiKey);
    }
    await this.registry.updateActiveConfig(normalized.localModel);
    this.cache = normalized;
  }

  private async buildSeedRecord(): Promise<{ record: McpSettingsRecord; apiKey?: string }> {
    const endpointLabel = this.env.MASK_CUT_VAULT_ID?.trim() || 'mcp-default';
    const logFile = this.env.MASK_CUT_LOG_FILE?.trim() || undefined;
    const timeoutMs = sanitizeTimeout(this.env.MASK_CUT_TIMEOUT_MS);
    const apiKey = this.env.MASK_CUT_API_KEY?.trim();

    return {
      record: {
        endpointLabel,
        timeoutMs,
        logFile,
        localModel: this.defaultLocalModel,
      },
      apiKey,
    };
  }

  private normalizeRecord(record: McpSettingsRecord | StoredSettingsRecord): McpSettingsRecord {
    return {
      endpointLabel: record.endpointLabel.trim(),
      timeoutMs: record.timeoutMs,
      logFile: record.logFile?.trim() || undefined,
      localModel: {
        engine: record.localModel.engine,
        modelPath: record.localModel.modelPath.trim(),
        modelName: record.localModel.modelName?.trim() || undefined,
        contextSize: record.localModel.contextSize,
      },
    };
  }

  private async readSettingsFile(): Promise<StoredSettingsRecord | null> {
    try {
      const raw = await readFile(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(raw) as StoredSettingsRecord;
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        throw new ConfigurationError('Unsupported settings schema version');
      }
      return parsed;
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      if (error instanceof ConfigurationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigurationError(`Failed to read settings: ${message}`);
    }
  }

  private async persist(record: McpSettingsRecord): Promise<void> {
    const payload: StoredSettingsRecord = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date(this.clock()).toISOString(),
      ...record,
    };
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(payload, null, 2));
  }
}

function isValidEngine(engine: string): engine is LocalModelConfig['engine'] {
  return engine === 'ollama' || engine === 'llamaCpp' || engine === 'customScript';
}

function sanitizeTimeout(raw: string | undefined): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function buildDefaultLocalModel(modelPath: string): LocalModelConfig {
  return {
    engine: 'customScript',
    modelPath,
  };
}


