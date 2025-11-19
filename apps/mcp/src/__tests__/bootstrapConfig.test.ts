import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveBootstrapConfig, BootstrapConfigError } from '../config/bootstrapConfig.js';

describe('resolveBootstrapConfig', () => {
  it('returns trimmed values and default timeout when env is provided', () => {
    const config = resolveBootstrapConfig({
      MASK_CUT_ENDPOINT_URL: ' https://example.local/v1 ',
      MASK_CUT_MODEL_NAME: ' local-model ',
      MASK_CUT_API_KEY: ' secret ',
      MASK_CUT_VAULT_ID: ' vault-one ',
    });

    assert.equal(config.endpointUrl, 'https://example.local/v1');
    assert.equal(config.modelName, 'local-model');
    assert.equal(config.apiKey, 'secret');
    assert.equal(config.vaultKeyId, 'vault-one');
    assert.equal(config.timeoutMs, 60_000);
  });

  it('throws BootstrapConfigError listing missing keys when env is incomplete', () => {
    try {
      resolveBootstrapConfig({
        MASK_CUT_TIMEOUT_MS: '1000',
      });
      assert.fail('Expected resolveBootstrapConfig to throw');
    } catch (error) {
      assert.ok(error instanceof BootstrapConfigError);
      assert.match(error.message, /MASK_CUT_ENDPOINT_URL/);
      assert.match(error.message, /MASK_CUT_MODEL_NAME/);
      assert.match(error.message, /MASK_CUT_API_KEY/);
      assert.match(error.message, /MASK_CUT_VAULT_ID/);
      assert.deepEqual(error.missingKeys, [
        'MASK_CUT_ENDPOINT_URL',
        'MASK_CUT_MODEL_NAME',
        'MASK_CUT_API_KEY',
        'MASK_CUT_VAULT_ID',
      ]);
    }
  });
});
