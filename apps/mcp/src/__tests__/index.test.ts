import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';

import { main } from '../index.js';
import { BootstrapConfigError } from '../config/bootstrapConfig.js';

const createBufferStream = () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, read: () => chunks.join('') };
};

describe('main', () => {
  it('logs startup info when configuration is present', async () => {
    const stderr = createBufferStream();

    await main({
      env: {
        MASK_CUT_ENDPOINT_URL: 'http://localhost:9999/v1',
        MASK_CUT_MODEL_NAME: 'local-test',
        MASK_CUT_API_KEY: 'key-123',
        MASK_CUT_VAULT_ID: 'vault',
      },
      stderr: stderr.stream,
    });

    const output = stderr.read();
    assert.match(output, /Registered MCP handlers/);
    assert.match(output, /mask_text/);
  });

  it('reports missing env vars and rejects with BootstrapConfigError', async () => {
    const stderr = createBufferStream();

    await assert.rejects(
      () =>
        main({
          env: {},
          stderr: stderr.stream,
        }),
      BootstrapConfigError,
    );

    assert.match(stderr.read(), /Missing required environment variables/);
  });
});
