/**
 * Custom/OpenAI-compatible provider adapter for client-side API calls.
 * Works with any OpenAI-compatible API (Ollama, OpenRouter, LM Studio, etc.)
 * by allowing a custom base URL.
 */
import type { ClientApiProvider, ClientApiRequest, ClientApiStreamChunk } from './types';

async function* streamChat(
  apiKey: string,
  request: ClientApiRequest,
  signal?: AbortSignal,
  baseUrl?: string,
): AsyncGenerator<ClientApiStreamChunk> {
  const url = `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;

  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
    ...(request.temperature != null && { temperature: request.temperature }),
    ...(request.max_tokens != null && { max_tokens: request.max_tokens }),
    ...(request.top_p != null && { top_p: request.top_p }),
    ...(request.frequency_penalty != null && { frequency_penalty: request.frequency_penalty }),
    ...(request.presence_penalty != null && { presence_penalty: request.presence_penalty }),
    ...(request.stop != null && { stop: request.stop }),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error?.message || parsed.message || errorBody;
    } catch {
      errorMessage = errorBody;
    }
    throw new Error(`API error (${response.status}): ${errorMessage}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) {
          continue;
        }

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          yield { text: '', done: true };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield {
              text: delta.content,
              done: false,
            };
          }

          if (choice?.finish_reason) {
            yield {
              text: '',
              done: true,
              usage: parsed.usage
                ? {
                    prompt_tokens: parsed.usage.prompt_tokens,
                    completion_tokens: parsed.usage.completion_tokens,
                    total_tokens: parsed.usage.total_tokens,
                  }
                : undefined,
            };
            return;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Creates a custom provider with a specific base URL */
export function createCustomProvider(baseUrl: string): ClientApiProvider {
  return {
    name: 'custom',
    streamChat: (apiKey, request, signal) => streamChat(apiKey, request, signal, baseUrl),
  };
}

export const customProvider: ClientApiProvider = {
  name: 'custom',
  streamChat: (apiKey, request, signal) => streamChat(apiKey, request, signal),
};
