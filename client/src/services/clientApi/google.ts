/**
 * Google Gemini provider adapter for client-side API calls.
 * Makes direct fetch() calls to the Google Generative AI API
 * and parses the SSE stream into ClientApiStreamChunk objects.
 */
import type { ClientApiProvider, ClientApiRequest, ClientApiStreamChunk } from './types';

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function* streamChat(
  apiKey: string,
  request: ClientApiRequest,
  signal?: AbortSignal,
): AsyncGenerator<ClientApiStreamChunk> {
  const systemMessages = request.messages.filter((m) => m.role === 'system');
  const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

  // Map roles: user -> user, assistant -> model
  const contents = nonSystemMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      ...(request.temperature != null && { temperature: request.temperature }),
      ...(request.max_tokens != null && { maxOutputTokens: request.max_tokens }),
      ...(request.top_p != null && { topP: request.top_p }),
      ...(request.stop != null && { stopSequences: request.stop }),
    },
  };

  if (systemMessages.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }],
    };
  }

  const url = `${GOOGLE_API_BASE}/${request.model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
    throw new Error(`Google API error (${response.status}): ${errorMessage}`);
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
        yield { text: '', done: true };
        return;
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
          const candidate = parsed.candidates?.[0];

          if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                yield {
                  text: part.text,
                  done: false,
                };
              }
            }
          }

          if (candidate?.finishReason) {
            const usage = parsed.usageMetadata;
            yield {
              text: '',
              done: true,
              usage: usage
                ? {
                    prompt_tokens: usage.promptTokenCount,
                    completion_tokens: usage.candidatesTokenCount,
                    total_tokens: usage.totalTokenCount,
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

export const googleProvider: ClientApiProvider = {
  name: 'google',
  streamChat,
};
