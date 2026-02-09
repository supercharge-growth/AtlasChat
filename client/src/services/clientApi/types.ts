/**
 * Types for client-side AI provider API calls.
 * These types define the common interface for all provider adapters
 * so they can be used interchangeably by the client-side chat hook.
 */

export interface ClientApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ClientApiRequest {
  model: string;
  messages: ClientApiMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
}

export interface ClientApiStreamChunk {
  /** The text delta for this chunk */
  text: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Usage info (only on final chunk for some providers) */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ClientApiProvider {
  /** Provider identifier */
  name: string;
  /** Make a streaming chat completion request. Returns an async iterator of chunks. */
  streamChat(
    apiKey: string,
    request: ClientApiRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ClientApiStreamChunk>;
}

/** Supported provider names for client-side API calls */
export type ProviderName = 'openAI' | 'anthropic' | 'google' | 'custom';
