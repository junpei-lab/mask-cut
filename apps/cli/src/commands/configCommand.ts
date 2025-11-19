import type { ConfigService } from '../config/configService.js';
import type { ProfileSummary } from '../config/types.js';
import { CliUsageError } from '../errors.js';
import type { CommandDescriptor, CommandResult } from '../types.js';

export interface ConfigCommandDependencies {
  configService: ConfigService;
}

interface SetCommandOptions {
  endpoint?: string;
  model?: string;
  logFile?: string;
  vaultKeyId?: string;
  apiKey?: string;
}

function buildListOutput(profiles: ProfileSummary[]): string {
  if (profiles.length === 0) {
    return 'No profiles configured yet. Use `mask-cut config set` to add one.';
  }

  const nameWidth = Math.max(...profiles.map((profile) => profile.name.length)) + 2;
  const lines: string[] = [];
  lines.push('Configured profiles:');

  for (const profile of profiles) {
    const indicator = profile.isDefault ? '*' : ' ';
    const endpoint = profile.endpoint || '(endpoint not set)';
    const nameColumn = profile.name.padEnd(nameWidth, ' ');
    lines.push(
      `${indicator} ${nameColumn} ${endpoint}  model=${profile.model}  updated=${profile.updatedAt}`,
    );
  }

  lines.push('');
  lines.push("'*' indicates the default profile.");
  return lines.join('\n');
}

async function handleList(
  deps: ConfigCommandDependencies,
): Promise<CommandResult> {
  const profiles = await deps.configService.listProfiles();
  return {
    exitCode: 0,
    output: { kind: 'text', text: `${buildListOutput(profiles)}\n` },
  };
}

async function handleUse(
  deps: ConfigCommandDependencies,
  argv: string[],
): Promise<CommandResult> {
  const target = argv[1];

  if (!target) {
    throw new CliUsageError('Profile name is required for `mask-cut config use <name>`');
  }

  try {
    await deps.configService.setDefaultProfile(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      output: {
        kind: 'error',
        code: 'CONFIG_ERROR',
        message,
      },
    };
  }

  return {
    exitCode: 0,
    output: { kind: 'text', text: `Default profile set to '${target}'.\n`, scope: 'info' },
  };
}

async function handleInit(
  deps: ConfigCommandDependencies,
): Promise<CommandResult> {
  const { created, path } = await deps.configService.ensureConfigFile();
  const text = created
    ? `Config file initialized at ${path}.\n`
    : `Config file already exists at ${path}.\n`;
  return {
    exitCode: 0,
    output: { kind: 'text', text, scope: 'info' },
  };
}

function readOptionValue(argv: string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return [value, index + 1];
}

function parseSetOptions(argv: string[]): { name: string; options: SetCommandOptions } {
  const name = argv[1];
  if (!name) {
    throw new CliUsageError('Profile name is required for `mask-cut config set <name>`');
  }

  const options: SetCommandOptions = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--endpoint': {
        const [value, next] = readOptionValue(argv, i, '--endpoint');
        options.endpoint = value;
        i = next;
        break;
      }
      case '--model': {
        const [value, next] = readOptionValue(argv, i, '--model');
        options.model = value;
        i = next;
        break;
      }
      case '--log-file': {
        const [value, next] = readOptionValue(argv, i, '--log-file');
        options.logFile = value;
        i = next;
        break;
      }
      case '--vault-key-id': {
        const [value, next] = readOptionValue(argv, i, '--vault-key-id');
        options.vaultKeyId = value;
        i = next;
        break;
      }
      case '--api-key': {
        const [value, next] = readOptionValue(argv, i, '--api-key');
        options.apiKey = value;
        i = next;
        break;
      }
      default:
        throw new CliUsageError(`Unknown option '${token}' for config set`);
    }
  }

  return { name, options };
}

async function handleSet(
  deps: ConfigCommandDependencies,
  argv: string[],
): Promise<CommandResult> {
  const { name, options } = parseSetOptions(argv);

  if (!options.endpoint) {
    throw new CliUsageError('--endpoint is required for `mask-cut config set`');
  }
  if (!options.model) {
    throw new CliUsageError('--model is required for `mask-cut config set`');
  }

  await deps.configService.upsertProfile(name, {
    endpoint: options.endpoint,
    model: options.model,
    logFile: options.logFile,
    vaultKeyId: options.vaultKeyId,
    apiKey: options.apiKey,
  });

  return {
    exitCode: 0,
    output: {
      kind: 'text',
      scope: 'info',
      text: `Profile '${name}' updated.\n`,
    },
  };
}

function buildUsage(): string {
  return `Mask-Cut CLI - Config command

Usage:
  mask-cut config list             # Show configured profiles
  mask-cut config use <name>       # Switch default profile
  mask-cut config init             # Create default config.json if missing
  mask-cut config set <name> ...   # Create or update a profile

Sub-commands:
  list    Show configured profiles with metadata
  use     Set the default profile to the provided name
  init    Generate a seed config.json when it does not exist
  set     Upsert a profile (requires --endpoint and --model)
`;
}

export function createConfigCommandDescriptor(
  deps: ConfigCommandDependencies,
): CommandDescriptor {
  return {
    name: 'config',
    summary: 'ê⁄ë±ê›íËÇä«óùÇ∑ÇÈ',
    usage: 'config <sub-command>',
    handler: async (context) => {
      const [subcommand] = context.argv;

      if (!subcommand || subcommand === '--help' || subcommand === '-h') {
        return {
          exitCode: 0,
          output: { kind: 'text', text: `${buildUsage()}\n`, scope: 'info' },
        };
      }

      switch (subcommand) {
        case 'list':
          return handleList(deps);
        case 'use':
          return handleUse(deps, context.argv);
        case 'init':
          return handleInit(deps);
        case 'set':
          return handleSet(deps, context.argv);
        default:
          throw new CliUsageError(
            `Unknown config sub-command '${subcommand}'. Available: list, use, init, set`,
          );
      }
    },
  };
}
