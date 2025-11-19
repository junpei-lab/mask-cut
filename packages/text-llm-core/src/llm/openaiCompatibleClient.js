function resolveFetch() {
    if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch;
    }
    throw new Error('Global fetch API is not available in this runtime. Provide fetchImpl when constructing OpenAICompatibleClient.');
}
export class OpenAICompatibleClient {
    constructor(baseUrl, apiKey, defaultModel, options = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.fetchImpl = options.fetchImpl ?? resolveFetch();
    }
    async complete(req) {
        const model = req.model || this.defaultModel;
        if (!model) {
            throw new Error('LLM model name is required. Provide it in the request or configure a default model.');
        }
        const messages = [];
        if (req.systemPrompt) {
            messages.push({ role: 'system', content: req.systemPrompt });
        }
        messages.push({ role: 'user', content: req.prompt });
        const payload = {
            model,
            messages,
        };
        if (typeof req.temperature === 'number') {
            payload.temperature = req.temperature;
        }
        if (typeof req.maxTokens === 'number') {
            payload.max_tokens = req.maxTokens;
        }
        const url = `${this.baseUrl}/chat/completions`;
        const response = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM request failed with status ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        const completion = data?.choices?.[0]?.message?.content;
        if (typeof completion !== 'string') {
            throw new Error('LLM response did not include a message content string.');
        }
        return {
            text: completion,
            raw: data,
        };
    }
}
export default OpenAICompatibleClient;
