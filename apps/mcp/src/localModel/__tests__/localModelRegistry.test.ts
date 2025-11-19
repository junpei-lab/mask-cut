import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  FileSystemLocalModelRegistry,
  LocalModelRegistryError,
} from '../localModelRegistry.js';

async function createTempFile(prefix = 'mcp-model-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(dir, 'model.gguf');
  await writeFile(filePath, 'gguf');
  return filePath;
}

describe('FileSystemLocalModelRegistry', () => {
  it('resolves active config after update', async () => {
    const filePath = await createTempFile();
    const registry = new FileSystemLocalModelRegistry({ allowedScriptDirs: [tmpdir()] });

    await registry.updateActiveConfig({ engine: 'llamaCpp', modelPath: filePath });
    const config = await registry.resolveActiveConfig();

    assert.equal(config.modelPath, filePath);
    assert.equal(config.engine, 'llamaCpp');
  });

  it('throws when resolveActiveConfig is called before update', async () => {
    const registry = new FileSystemLocalModelRegistry();

    await assert.rejects(() => registry.resolveActiveConfig(), LocalModelRegistryError);
  });

  it('accepts file protocol paths for llamaCpp engines', async () => {
    const filePath = await createTempFile();
    const registry = new FileSystemLocalModelRegistry();

    await assert.doesNotReject(() =>
      registry.assertOfflineMode({ engine: 'llamaCpp', modelPath: `file://${filePath}` }),
    );
  });

  it('rejects http urls for llamaCpp engines', async () => {
    const registry = new FileSystemLocalModelRegistry();

    await assert.rejects(() =>
      registry.assertOfflineMode({ engine: 'llamaCpp', modelPath: 'http://example.com/model' }),
    );
  });

  it('enforces script whitelist for customScript engine', async () => {
    const filePath = await createTempFile();
    const registry = new FileSystemLocalModelRegistry({ allowedScriptDirs: [] });

    await assert.rejects(() =>
      registry.assertOfflineMode({ engine: 'customScript', modelPath: filePath }),
    );

    const allowedRegistry = new FileSystemLocalModelRegistry({ allowedScriptDirs: [tmpdir()] });
    await assert.doesNotReject(() =>
      allowedRegistry.assertOfflineMode({ engine: 'customScript', modelPath: filePath }),
    );
  });

  it('allows only local hosts for ollama engine', async () => {
    const registry = new FileSystemLocalModelRegistry();

    await assert.rejects(() =>
      registry.assertOfflineMode({ engine: 'ollama', modelPath: 'http://remote-host:11434' }),
    );

    await assert.doesNotReject(() =>
      registry.assertOfflineMode({ engine: 'ollama', modelPath: 'http://127.0.0.1:11434' }),
    );
  });
});
