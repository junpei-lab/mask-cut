import type { ResolvedMaskingSettings } from '../masking/maskingService';
import type { ConnectivityTester } from './connectivityTester';
import type { SettingsRepository } from './settingsStore';
import type { SecretStore } from './secureStoreAdapter';
import type {
  AppSettingsInput,
  AppSettingsRecord,
  SettingsSaveResult,
  SettingsValidationErrors,
} from './types';

export type SettingsListener = (settings: AppSettingsRecord) => void;

export type DefaultSettingsSeed = {
  record: AppSettingsRecord;
  apiKey?: string;
};

function buildDefaultSeed(timestamp: () => number): DefaultSettingsSeed {
  const now = new Date(timestamp()).toISOString();
  const timeoutMs = Number(process.env.MASK_CUT_TIMEOUT_MS ?? 60_000);
  return {
    record: {
      endpointUrl: process.env.MASK_CUT_ENDPOINT_URL ?? 'http://localhost:1234/v1',
      modelName: process.env.MASK_CUT_MODEL_NAME ?? 'gpt-4o-mini',
      vaultKeyId: process.env.MASK_CUT_VAULT_ID ?? 'default',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
      lastUpdatedAt: now,
    },
    apiKey: process.env.MASK_CUT_API_KEY,
  };
}

export class SettingsService {
  private cache: AppSettingsRecord | null = null;

  private readonly listeners = new Set<SettingsListener>();

  private readonly clock: () => number;

  private readonly defaultSeedBuilder: () => Promise<DefaultSettingsSeed>;

  constructor(
    private readonly repository: SettingsRepository,
    private readonly secureStore: SecretStore,
    private readonly connectivityTester: ConnectivityTester,
    options: {
      clock?: () => number;
      defaultSeedBuilder?: () => Promise<DefaultSettingsSeed>;
    } = {},
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.defaultSeedBuilder =
      options.defaultSeedBuilder ?? (() => Promise.resolve(buildDefaultSeed(this.clock)));
  }

  async getSettings(): Promise<AppSettingsRecord> {
    if (this.cache) {
      return this.cache;
    }

    const stored = await this.repository.load();
    if (stored) {
      this.cache = stored;
      return stored;
    }

    const seed = await this.defaultSeedBuilder();
    await this.repository.save(seed.record);
    if (seed.apiKey) {
      await this.secureStore.setSecret(seed.record.vaultKeyId, seed.apiKey);
    }
    this.cache = seed.record;
    return seed.record;
  }

  async getResolvedSettings(): Promise<ResolvedMaskingSettings> {
    const settings = await this.getSettings();
    const apiKey = await this.secureStore.getSecret(settings.vaultKeyId);
    return {
      endpointUrl: settings.endpointUrl,
      modelName: settings.modelName,
      apiKey: apiKey ?? undefined,
      endpointLabel: settings.vaultKeyId,
      timeoutMs: settings.timeoutMs,
    };
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async saveSettings(input: AppSettingsInput): Promise<SettingsSaveResult> {
    const errors = this.validateInput(input);
    if (Object.keys(errors).length > 0) {
      return { ok: false, validationErrors: errors };
    }

    const sanitizedTimeout =
      typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : 60_000;

    const normalized = {
      endpointUrl: input.endpointUrl.trim(),
      modelName: input.modelName.trim(),
      vaultKeyId: input.vaultKeyId.trim(),
      timeoutMs: sanitizedTimeout,
    } satisfies Omit<AppSettingsRecord, 'lastUpdatedAt'>;

    const previousSettings = await this.getSettings();
    const vaultChanged = previousSettings.vaultKeyId !== normalized.vaultKeyId;

    let apiKey: string | undefined = input.apiKey?.trim() || undefined;
    if (!apiKey) {
      apiKey = (await this.secureStore.getSecret(normalized.vaultKeyId)) ?? undefined;
      if (!apiKey && vaultChanged) {
        const existing = await this.secureStore.getSecret(previousSettings.vaultKeyId);
        if (existing) {
          await this.secureStore.setSecret(normalized.vaultKeyId, existing);
          apiKey = existing;
        }
      }
    }
    try {
      await this.connectivityTester.test({
        endpointUrl: normalized.endpointUrl,
        modelName: normalized.modelName,
        apiKey,
        timeoutMs: normalized.timeoutMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '接続テストに失敗しました';
      return {
        ok: false,
        connectivityError: message,
      };
    }

    const record: AppSettingsRecord = {
      ...normalized,
      lastUpdatedAt: new Date(this.clock()).toISOString(),
    };

    await this.repository.save(record);
    this.cache = record;

    if (input.apiKey && input.apiKey.trim()) {
      await this.secureStore.setSecret(record.vaultKeyId, input.apiKey.trim());
    }

    this.emit(record);
    return { ok: true, settings: record };
  }

  private validateInput(input: AppSettingsInput): SettingsValidationErrors {
    const errors: SettingsValidationErrors = {};

    if (!input.endpointUrl || !input.endpointUrl.trim()) {
      errors.endpointUrl = '接続�E URL を�E力してください';
    } else {
      try {
        const url = new URL(input.endpointUrl.trim());
        if (!/^https?:$/.test(url.protocol)) {
          errors.endpointUrl = 'http また�E https の URL を指定してください';
        }
      } catch {
        errors.endpointUrl = '有効な URL ではありません';
      }
    }

    if (!input.modelName || !input.modelName.trim()) {
      errors.modelName = 'モチE��名を入力してください';
    }

    if (!input.vaultKeyId || !input.vaultKeyId.trim()) {
      errors.vaultKeyId = 'API キー参�E ID を�E力してください';
    }

    if (typeof input.timeoutMs === 'number' && input.timeoutMs <= 0) {
      errors.timeoutMs = 'タイムアウト�E 0 より大きい値にしてください';
    }

    return errors;
  }

  private emit(record: AppSettingsRecord): void {
    this.listeners.forEach((listener) => listener(record));
  }
}

