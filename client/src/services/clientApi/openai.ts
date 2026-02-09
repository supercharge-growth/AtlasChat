/**
 * OpenAI provider adapter for client-side API calls.
 * Makes direct fetch() calls to the OpenAI Chat Completions API
 * and parses the SSE stream into ClientApiStreamChunk objects.
 */
import type { ClientApiProvider, ClientApiRequest, ClientApiStreamChunk } from './types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

async function* streamChat(
  apiKey: string,
  request: ClientApiRequest,
  signal?: AbortSignal,
): AsyncGenerator<ClientApiStreamChunk> {
  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(request.temperature != null && { temperature: request.temperature }),
    ...(request.max_tokens != null && { max_tokens: request.max_tokens }),
    ...(request.top_p != null && { top_p: request.top_p }),
    ...(request.frequency_penalty != null && { frequency_penalty: request.frequency_penalty }),
    ...(request.presence_penalty != null && { presence_penalty: request.presence_penalty }),
    ...(request.stop != null && { stop: request.stop }),
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
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
    throw new Error(`OpenAI API error (${response.status}): ${errorMessage}`);
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

          // Final chunk with usage
          if (parsed.usage) {
            yield {
              text: '',
              done: true,
              usage: {
                prompt_tokens: parsed.usage.prompt_tokens,
                completion_tokens: parsed.usage.completion_tokens,
                total_tokens: parsed.usage.total_tokens,
              },
            };
            return;
          }

          if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
            yield { text: '', done: true };
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

export const openAIProvider: ClientApiProvider = {
  name: 'openAI',
  streamChat,
};
