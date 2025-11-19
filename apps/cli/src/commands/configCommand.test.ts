import assert from 'node:assert/strict';
import test from 'node:test';

import type { CliCommandContext, ProcessIO } from '../types.js';

import { createConfigCommandDescriptor } from './configCommand.js';

function createIO(): ProcessIO {
  return {
    writeStdout: () => {},
    writeStderr: () => {},
    setExitCode: () => {},
  };
}

function createContext(argv: string[]): CliCommandContext {
  return {
    globals: {
      quiet: false,
      dryRun: false,
      logFile: undefined,
    },
    argv,
    io: createIO(),
  };
}

test('config list prints profiles with default indicator', async () => {
  const descriptor = createConfigCommandDescriptor({
    configService: {
      listProfiles: async () => [
        {
          name: 'default',
          endpoint: 'http://localhost:1234/v1',
          model: 'llama3',
          updatedAt: '2024-01-01T00:00:00.000Z',
          isDefault: true,
        },
        {
          name: 'prod',
          endpoint: 'https://api.example.com',
          model: 'gpt-4o',
          updatedAt: '2024-02-02T00:00:00.000Z',
          isDefault: false,
        },
      ],
    } as any,
  });

  const result = await descriptor.handler(createContext(['list']));

  assert.equal(result.exitCode, 0);
  assert.equal(result.output?.kind, 'text');
  assert.ok(result.output?.text.includes('* default'));
  assert.ok(result.output?.text.includes('  prod'));
});

test('config use switches default profile and reports success', async () => {
  let selected: string | undefined;

  const descriptor = createConfigCommandDescriptor({
    configService: {
      listProfiles: async () => [],
      setDefaultProfile: async (name: string) => {
        selected = name;
      },
    } as any,
  });

  const result = await descriptor.handler(createContext(['use', 'prod']));

  assert.equal(result.exitCode, 0);
  assert.equal(selected, 'prod');
  assert.equal(result.output?.kind, 'text');
  assert.equal(result.output?.scope, 'info');
  assert.ok(result.output?.text.includes("Default profile set to 'prod'"));
});

test('config use without profile reports error', async () => {
  const descriptor = createConfigCommandDescriptor({
    configService: {
      listProfiles: async () => [],
      setDefaultProfile: async () => {},
    } as any,
  });

  await assert.rejects(
    descriptor.handler(createContext(['use'])),
    /Profile name is required/,
  );
});

test('config init reports whether config file was created', async () => {
  let created = true;
  const descriptor = createConfigCommandDescriptor({
    configService: {
      ensureConfigFile: async () => ({ created, path: '/tmp/mask-cut/config.json' }),
    } as any,
  });

  const createdResult = await descriptor.handler(createContext(['init']));
  assert.equal(createdResult.exitCode, 0);
  const createdOutput = createdResult.output;
  assert.ok(createdOutput && createdOutput.kind === 'text');
  assert.ok(createdOutput.text.includes('initialized'));

  created = false;
  const existingResult = await descriptor.handler(createContext(['init']));
  assert.equal(existingResult.exitCode, 0);
  const existingOutput = existingResult.output;
  assert.ok(existingOutput && existingOutput.kind === 'text');
  assert.ok(existingOutput.text.includes('already exists'));
});
test('config set upserts profile with provided options', async () => {
  let saved: any;

  const descriptor = createConfigCommandDescriptor({
    configService: {
      listProfiles: async () => [],
      upsertProfile: async (_name: string, input: any) => {
        saved = input;
      },
    } as any,
  });

  const result = await descriptor.handler(
    createContext([
      'set',
      'prod',
      '--endpoint',
      'https://api.example.com',
      '--model',
      'gpt-4o',
      '--log-file',
      '/tmp/audit.log',
      '--vault-key-id',
      'vault-1',
      '--api-key',
      'sk-test',
    ]),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.output?.kind, 'text');
  assert.deepEqual(saved, {
    endpoint: 'https://api.example.com',
    model: 'gpt-4o',
    logFile: '/tmp/audit.log',
    vaultKeyId: 'vault-1',
    apiKey: 'sk-test',
  });
});

test('config set requires mandatory options', async () => {
  const descriptor = createConfigCommandDescriptor({
    configService: {
      listProfiles: async () => [],
      upsertProfile: async () => {},
    } as any,
  });

  await assert.rejects(
    descriptor.handler(createContext(['set', 'prod', '--model', 'gpt-4o'])),
    /--endpoint is required/,
  );

  await assert.rejects(
    descriptor.handler(
      createContext(['set', 'prod', '--endpoint', 'https://api.example.com']),
    ),
    /--model is required/,
  );
});
