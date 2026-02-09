import { useState, useCallback, useEffect, memo } from 'react';
import { useRecoilValue } from 'recoil';
import { Button, Label, Input } from '@librechat/client';
import {
  getClientApiKey,
  setClientApiKey,
  removeClientApiKey,
  getClientApiBaseUrl,
  setClientApiBaseUrl,
} from '~/services/clientApi';
import store from '~/store';

interface KeyEntry {
  provider: string;
  label: string;
  placeholder: string;
  hasBaseUrl?: boolean;
}

const providers: KeyEntry[] = [
  {
    provider: 'openAI',
    label: 'OpenAI',
    placeholder: 'sk-...',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-...',
  },
  {
    provider: 'google',
    label: 'Google (Gemini)',
    placeholder: 'AI...',
  },
  {
    provider: 'custom',
    label: 'Custom (OpenAI-compatible)',
    placeholder: 'API key',
    hasBaseUrl: true,
  },
];

function ProviderKeyInput({ entry }: { entry: KeyEntry }) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    const existing = getClientApiKey(entry.provider);
    if (existing) {
      setHasExisting(true);
    }
    if (entry.hasBaseUrl) {
      const existingUrl = getClientApiBaseUrl(entry.provider);
      if (existingUrl) {
        setBaseUrl(existingUrl);
      }
    }
  }, [entry.provider, entry.hasBaseUrl]);

  const handleSave = useCallback(() => {
    if (key.trim()) {
      setClientApiKey(entry.provider, key.trim());
      setHasExisting(true);
      setSaved(true);
      setKey('');
      setTimeout(() => setSaved(false), 2000);
    }
    if (entry.hasBaseUrl && baseUrl.trim()) {
      setClientApiBaseUrl(entry.provider, baseUrl.trim());
    }
  }, [key, baseUrl, entry.provider, entry.hasBaseUrl]);

  const handleRemove = useCallback(() => {
    removeClientApiKey(entry.provider);
    setHasExisting(false);
    setKey('');
  }, [entry.provider]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-text-secondary">
          {entry.label}
          {hasExisting && (
            <span className="ml-2 text-xs text-green-500">(configured)</span>
          )}
        </Label>
        {hasExisting && (
          <button
            onClick={handleRemove}
            className="text-xs text-red-500 hover:text-red-600"
          >
            Remove
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={hasExisting ? '••••••••' : entry.placeholder}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="h-8 flex-1 text-xs"
        />
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={!key.trim()}
          className="h-8 text-xs"
        >
          {saved ? 'Saved!' : 'Save'}
        </Button>
      </div>
      {entry.hasBaseUrl && (
        <Input
          type="text"
          placeholder="Base URL (e.g., http://localhost:11434/v1)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}

function ClientApiKeys() {
  const clientSideEnabled = useRecoilValue(store.clientSideApi);

  if (!clientSideEnabled) {
    return null;
  }

  return (
    <div className="border-border-medium flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <Label className="text-sm font-medium">Client API Keys</Label>
        <p className="text-xs text-text-secondary">
          Set API keys for direct browser-to-provider API calls. Keys are stored locally in your browser.
        </p>
      </div>
      {providers.map((entry) => (
        <ProviderKeyInput key={entry.provider} entry={entry} />
      ))}
    </div>
  );
}

export default memo(ClientApiKeys);
