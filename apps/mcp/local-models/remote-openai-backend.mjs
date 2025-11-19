import { OpenAICompatibleClient } from '@mask-cut/text-llm-core';

let cachedClient;

function resolveEndpoint(env) {
  return env.MASK_CUT_ENDPOINT_URL ?? 'https://api.openai.com/v1';
}

function resolveModel(env, config) {
  return env.MASK_CUT_MODEL_NAME ?? config.modelName ?? 'gpt-4o-mini';
}

function resolveClient(env, config) {
  if (cachedClient) {
    return cachedClient;
  }
  const endpoint = resolveEndpoint(env);
  const apiKey = env.MASK_CUT_API_KEY;
  const model = resolveModel(env, config);
  cachedClient = new OpenAICompatibleClient(endpoint, apiKey, model);
  return cachedClient;
}

export async function generate(request, context) {
  const env = context?.env ?? process.env;
  const config = context?.config;
  if (!config) {
    throw new Error('Custom script context is missing LocalModelConfig.');
  }
  const client = resolveClient(env, config);
  const model = request.model?.trim() || resolveModel(env, config);
  const response = await client.complete({
    ...request,
    model,
  });
  return response;
}
