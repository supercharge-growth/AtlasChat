import { useRecoilValue } from 'recoil';
import type { TSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import useSSE from './useSSE';
import useResumableSSE from './useResumableSSE';
import useClientSideChat from './useClientSideChat';
import store from '~/store';

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'newConversation'
  | 'resetLatestMessage'
>;

/**
 * Adaptive SSE hook that switches between standard, resumable, and client-side modes.
 * Uses Recoil state to determine which mode to use.
 *
 * Modes:
 * - clientSideApi: Call AI providers directly from the browser (no backend proxy)
 * - resumableStreams: Use resumable SSE streams via the backend
 * - default: Use standard SSE streams via the backend
 *
 * Note: All hooks are always called to comply with React's Rules of Hooks.
 * We pass null submission to the inactive ones.
 */
export default function useAdaptiveSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const resumableEnabled = useRecoilValue(store.resumableStreams);
  const clientSideEnabled = useRecoilValue(store.clientSideApi);

  // Client-side mode: call AI APIs directly from the browser
  useClientSideChat(
    clientSideEnabled ? submission : null,
    chatHelpers,
    isAddedRequest,
    runIndex,
  );

  // Standard SSE mode: backend proxies the request
  useSSE(
    !clientSideEnabled && !resumableEnabled ? submission : null,
    chatHelpers,
    isAddedRequest,
    runIndex,
  );

  // Resumable SSE mode: backend proxies with resume support
  const { streamId } = useResumableSSE(
    !clientSideEnabled && resumableEnabled ? submission : null,
    chatHelpers,
    isAddedRequest,
    runIndex,
  );

  return { streamId, resumableEnabled, clientSideEnabled };
}
