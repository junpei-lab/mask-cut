export interface BootstrapConfig {
  endpointUrl: string;
  modelName: string;
  apiKey: string;
  vaultKeyId: string;
  timeoutMs: number;
}

export class BootstrapConfigError extends Error {
  readonly missingKeys: string[];

  constructor(message: string, missingKeys: string[]) {
    super(message);
    this.name = 'BootstrapConfigError';
    this.missingKeys = missingKeys;
  }
}

const REQUIRED_KEYS = [
  'MASK_CUT_ENDPOINT_URL',
  'MASK_CUT_MODEL_NAME',
  'MASK_CUT_API_KEY',
  'MASK_CUT_VAULT_ID',
] as const;

const DEFAULT_TIMEOUT_MS = 60_000;

export function resolveBootstrapConfig(
  env: Record<string, string | undefined> = process.env,
): BootstrapConfig {
  const missingKeys = REQUIRED_KEYS.filter((key) => !env[key]?.trim());
  if (missingKeys.length > 0) {
    throw new BootstrapConfigError(
      `Missing required environment variables: ${missingKeys.join(', ')}`,
      missingKeys,
    );
  }

  const timeoutRaw = env.MASK_CUT_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;

  return {
    endpointUrl: env.MASK_CUT_ENDPOINT_URL!.trim(),
    modelName: env.MASK_CUT_MODEL_NAME!.trim(),
    apiKey: env.MASK_CUT_API_KEY!.trim(),
    vaultKeyId: env.MASK_CUT_VAULT_ID!.trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}
