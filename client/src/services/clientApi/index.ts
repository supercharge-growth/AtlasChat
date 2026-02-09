/**
 * Client-side AI API module.
 * Provides direct browser-to-AI-provider communication,
 * bypassing the backend for chat completions.
 */

export { openAIProvider } from './openai';
export { anthropicProvider } from './anthropic';
export { googleProvider } from './google';
export { customProvider, createCustomProvider } from './custom';
export {
  getClientApiKey,
  setClientApiKey,
  removeClientApiKey,
  getClientApiBaseUrl,
  setClientApiBaseUrl,
  isClientSideApiEnabled,
  setClientSideApiEnabled,
  endpointToProviderKey,
  hasClientApiKey,
} from './keys';
export type {
  ClientApiProvider,
  ClientApiRequest,
  ClientApiMessage,
  ClientApiStreamChunk,
  ProviderName,
} from './types';

import type { ClientApiProvider } from './types';
import { openAIProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { customProvider, createCustomProvider } from './custom';
import { getClientApiBaseUrl } from './keys';

/**
 * Get the appropriate provider adapter for a given endpoint name.
 */
export function getProviderForEndpoint(endpoint: string): ClientApiProvider {
  switch (endpoint) {
    case 'openAI':
    case 'azureOpenAI':
      return openAIProvider;
    case 'anthropic':
      return anthropicProvider;
    case 'google':
      return googleProvider;
    default: {
      // For custom endpoints and unknown providers, use OpenAI-compatible adapter
      const baseUrl = getClientApiBaseUrl(endpoint);
      if (baseUrl) {
        return createCustomProvider(baseUrl);
      }
      return customProvider;
    }
  }
}
