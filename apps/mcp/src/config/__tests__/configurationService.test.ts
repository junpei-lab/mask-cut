import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ConfigurationService, ConfigurationValidationError } from '../configurationService.js';
import type { SecretStore } from '../secureStoreAdapter.js';
import type {
  LocalModelConfig,
  MutableLocalModelRegistry,
} from '../../localModel/localModelRegistry.js';

class InMemorySecretStore implements SecretStore {
  readonly store = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

class StubRegistry implements MutableLocalModelRegistry {
  active?: LocalModelConfig;
  readonly asserted: LocalModelConfig[] = [];

  async resolveActiveConfig(): Promise<LocalModelConfig> {
    if (!this.active) {
      throw new Error('no active config');
    }
    return this.active;
  }

  async assertOfflineMode(config: LocalModelConfig): Promise<void> {
    this.asserted.push(config);
    if (config.modelPath.includes('forbidden')) {
      throw new Error('invalid path');
    }
  }

  async updateActiveConfig(config: LocalModelConfig): Promise<void> {
    this.active = config;
  }
}

async function createService(tempPrefix = 'mcp-config-') {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  const settingsPath = join(dir, 'settings.json');
  const modelPath = join(dir, 'local-model');
  await writeFile(modelPath, 'placeholder');

  const secretStore = new InMemorySecretStore();
  const registry = new StubRegistry();

  const service = new ConfigurationService({
    settingsPath,
    secretStore,
    registry,
    env: {
      MASK_CUT_ENDPOINT_URL: 'http://localhost:9999/v1',
      MASK_CUT_MODEL_NAME: 'local-model',
      MASK_CUT_API_KEY: 'seed-key',
      MASK_CUT_VAULT_ID: 'vault-profile',
      MASK_CUT_TIMEOUT_MS: '90000',
    },
    defaultLocalModel: { engine: 'llamaCpp', modelPath },
  });

  return { service, settingsPath, secretStore, registry, modelPath };
}

describe('ConfigurationService', () => {
  it('seeds settings file when missing and stores api key', async () => {
    const { service, settingsPath, secretStore, registry, modelPath } = await createService();

    const record = await service.load();

    assert.equal(record.endpointLabel, 'vault-profile');
    assert.equal(record.timeoutMs, 90_000);
    assert.equal(record.localModel.modelPath, modelPath);
    assert.equal(secretStore.store.get('vault-profile'), 'seed-key');
    assert.deepEqual((await readFile(settingsPath, 'utf-8')).length > 0, true);
    assert.equal((await registry.resolveActiveConfig()).modelPath, modelPath);
  });

  it('saves settings and persists api key', async () => {
    const { service, settingsPath, secretStore, registry, modelPath } = await createService('mcp-config-save-');
    await service.load();

    const nextModel: LocalModelConfig = { engine: 'customScript', modelPath: modelPath.replace('local-model', 'script.sh') };

    await service.save(
      {
        endpointLabel: 'custom-profile',
        timeoutMs: 30_000,
        logFile: '/tmp/mcp.log',
        localModel: nextModel,
      },
      'new-secret',
    );

    const saved = JSON.parse(await readFile(settingsPath, 'utf-8'));
    assert.equal(saved.endpointLabel, 'custom-profile');
    assert.equal(saved.schemaVersion, 1);
    assert.equal(secretStore.store.get('custom-profile'), 'new-secret');
    assert.equal(registry.active?.modelPath, nextModel.modelPath);
  });

  it('validates required fields and surfaces issues', async () => {
    const { service } = await createService('mcp-config-validate-');

    await assert.rejects(
      () =>
        service.validate({
          endpointLabel: '',
          timeoutMs: 0,
          localModel: { engine: 'llamaCpp', modelPath: 'forbidden' },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationValidationError);
        assert.ok(error.issues.endpointLabel);
        assert.ok(error.issues.timeoutMs);
        assert.ok(error.issues.localModel);
        return true;
      },
    );
  });
});
