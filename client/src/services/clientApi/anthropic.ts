/**
 * Anthropic provider adapter for client-side API calls.
 * Makes direct fetch() calls to the Anthropic Messages API
 * and parses the SSE stream into ClientApiStreamChunk objects.
 */
import type { ClientApiProvider, ClientApiRequest, ClientApiStreamChunk } from './types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

async function* streamChat(
  apiKey: string,
  request: ClientApiRequest,
  signal?: AbortSignal,
): AsyncGenerator<ClientApiStreamChunk> {
  // Anthropic uses a different message format - separate system from messages
  const systemMessages = request.messages.filter((m) => m.role === 'system');
  const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

  const system = systemMessages.map((m) => m.content).join('\n\n') || undefined;

  const messages = nonSystemMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: true,
    max_tokens: request.max_tokens ?? 4096,
    ...(system && { system }),
    ...(request.temperature != null && { temperature: request.temperature }),
    ...(request.top_p != null && { top_p: request.top_p }),
    ...(request.stop != null && { stop_sequences: request.stop }),
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
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
    throw new Error(`Anthropic API error (${response.status}): ${errorMessage}`);
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
        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            case 'content_block_delta':
              if (parsed.delta?.type === 'text_delta') {
                yield {
                  text: parsed.delta.text,
                  done: false,
                };
              }
              break;

            case 'message_delta':
              if (parsed.usage) {
                yield {
                  text: '',
                  done: true,
                  usage: {
                    completion_tokens: parsed.usage.output_tokens,
                  },
                };
                return;
              }
              if (parsed.delta?.stop_reason) {
                yield { text: '', done: true };
                return;
              }
              break;

            case 'message_start':
              if (parsed.message?.usage) {
                // We can capture input tokens here but don't yield yet
              }
              break;

            case 'message_stop':
              yield { text: '', done: true };
              return;

            case 'error':
              throw new Error(
                `Anthropic stream error: ${parsed.error?.message || JSON.stringify(parsed.error)}`,
              );
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('Anthropic')) {
            throw e;
          }
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const anthropicProvider: ClientApiProvider = {
  name: 'anthropic',
  streamChat,
};
