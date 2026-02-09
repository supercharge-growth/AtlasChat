/**
 * Client-side API key management.
 * Stores and retrieves API keys from localStorage for direct provider API calls.
 */

const KEY_PREFIX = 'clientApiKey_';
const BASE_URL_PREFIX = 'clientApiBaseUrl_';
const CLIENT_SIDE_MODE_KEY = 'clientSideApiEnabled';

/** Get the API key for a provider from localStorage */
export function getClientApiKey(provider: string): string | null {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${provider}`);
  } catch {
    return null;
  }
}

/** Save an API key for a provider to localStorage */
export function setClientApiKey(provider: string, key: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${provider}`, key);
  } catch {
    console.error('[ClientApi] Failed to save API key to localStorage');
  }
}

/** Remove an API key for a provider from localStorage */
export function removeClientApiKey(provider: string): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}${provider}`);
  } catch {
    console.error('[ClientApi] Failed to remove API key from localStorage');
  }
}

/** Get the custom base URL for a provider */
export function getClientApiBaseUrl(provider: string): string | null {
  try {
    return localStorage.getItem(`${BASE_URL_PREFIX}${provider}`);
  } catch {
    return null;
  }
}

/** Save a custom base URL for a provider */
export function setClientApiBaseUrl(provider: string, url: string): void {
  try {
    localStorage.setItem(`${BASE_URL_PREFIX}${provider}`, url);
  } catch {
    console.error('[ClientApi] Failed to save base URL to localStorage');
  }
}

/** Check if client-side API mode is enabled */
export function isClientSideApiEnabled(): boolean {
  try {
    return localStorage.getItem(CLIENT_SIDE_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Enable or disable client-side API mode */
export function setClientSideApiEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CLIENT_SIDE_MODE_KEY, String(enabled));
  } catch {
    console.error('[ClientApi] Failed to save client-side API mode setting');
  }
}

/**
 * Maps LibreChat endpoint names to provider key names.
 * Needed because LibreChat uses endpoint names like "openAI" while
 * we store keys by provider name.
 */
export function endpointToProviderKey(endpoint: string): string {
  const map: Record<string, string> = {
    openAI: 'openAI',
    azureOpenAI: 'openAI',
    anthropic: 'anthropic',
    google: 'google',
    agents: 'openAI', // agents endpoint typically uses OpenAI by default
    bedrock: 'bedrock',
    custom: 'custom',
  };
  return map[endpoint] || endpoint;
}

/** Check if we have a client-side API key for the given endpoint */
export function hasClientApiKey(endpoint: string): boolean {
  const provider = endpointToProviderKey(endpoint);
  const key = getClientApiKey(provider);
  return key != null && key.length > 0;
}
