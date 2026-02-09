import { useEffect, useState, useRef, useCallback } from 'react';
import { v4 } from 'uuid';
import { useSetRecoilState } from 'recoil';
import {
  request,
  Constants,
  ContentTypes,
  LocalStorageKeys,
} from 'librechat-data-provider';
import type { TMessage, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import { useGetStartupConfig, useGetUserBalance, queueTitleGeneration } from '~/data-provider';
import {
  getProviderForEndpoint,
  getClientApiKey,
  endpointToProviderKey,
} from '~/services/clientApi';
import type { ClientApiMessage } from '~/services/clientApi';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import store from '~/store';

const clearDraft = (conversationId?: string | null) => {
  if (conversationId) {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${conversationId}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${conversationId}`);
  } else {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.NEW_CONVO}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`);
  }
};

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
 * Converts LibreChat TMessage[] into the format expected by AI provider APIs.
 */
function convertMessages(
  messages: TMessage[],
  systemPrompt?: string,
): ClientApiMessage[] {
  const result: ClientApiMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    const role = msg.isCreatedByUser ? 'user' : 'assistant';
    let text = msg.text || '';

    // If message has content array, extract text from it
    if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
      const textParts = msg.content
        .filter(
          (part) =>
            part.type === ContentTypes.TEXT &&
            (part[ContentTypes.TEXT]?.value || part[ContentTypes.TEXT]),
        )
        .map((part) => {
          const textContent = part[ContentTypes.TEXT];
          return typeof textContent === 'string' ? textContent : textContent?.value || '';
        });
      if (textParts.length > 0) {
        text = textParts.join('\n');
      }
    }

    if (text) {
      result.push({ role, content: text });
    }
  }

  return result;
}

/**
 * Saves messages and conversation to the backend for persistence.
 * Uses the existing POST /api/messages/:conversationId endpoint.
 */
async function persistMessages(
  token: string,
  conversationId: string,
  userMessage: TMessage,
  responseMessage: TMessage,
) {
  try {
    // Save user message
    await request.post(`/api/messages/${conversationId}`, {
      ...userMessage,
      conversationId,
    });

    // Save response message
    await request.post(`/api/messages/${conversationId}`, {
      ...responseMessage,
      conversationId,
    });
  } catch (error) {
    console.error('[ClientSideChat] Error persisting messages:', error);
  }
}

/**
 * Hook for client-side AI API calls.
 * Instead of sending messages to the backend, this hook calls AI provider APIs
 * directly from the browser and streams the response to the UI.
 * After completion, it persists messages to the backend for storage.
 */
export default function useClientSideChat(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();

  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  const [_completed, setCompleted] = useState(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const submissionRef = useRef<TSubmission | null>(null);

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const {
    finalHandler,
    errorHandler,
    createdHandler,
    contentHandler,
    clearStepMaps,
  } = useEventHandlers({
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });

  /**
   * Perform a client-side streaming chat completion.
   */
  const runClientChat = useCallback(
    async (currentSubmission: TSubmission) => {
      const {
        conversation,
        userMessage,
        messages: previousMessages,
        endpointOption,
        initialResponse,
      } = currentSubmission;

      const endpoint = endpointOption?.endpoint || conversation?.endpoint || 'openAI';
      const model = endpointOption?.model || conversation?.model || '';
      const providerKey = endpointToProviderKey(endpoint);
      const apiKey = getClientApiKey(providerKey);

      if (!apiKey) {
        console.error('[ClientSideChat] No API key found for provider:', providerKey);
        errorHandler({
          data: undefined,
          submission: {
            ...currentSubmission,
            initialResponse: {
              ...initialResponse,
              text: `No API key configured for ${providerKey}. Please set your API key in Settings > Client API Keys.`,
            },
          } as EventSubmission,
        });
        return;
      }

      // Generate a conversation ID if this is a new conversation
      const conversationId = conversation?.conversationId || v4();
      const responseMessageId = initialResponse?.messageId || `${userMessage.messageId}_`;

      // Signal that the message was "created" (mimics the backend created event)
      const runId = v4();
      setActiveRunId(runId);
      createdHandler(
        { created: true, message: userMessage } as never,
        { ...currentSubmission, userMessage } as EventSubmission,
      );

      // Build the message array for the AI provider
      const systemPrompt =
        (endpointOption as Record<string, unknown>)?.promptPrefix as string ||
        (conversation as Record<string, unknown>)?.promptPrefix as string ||
        undefined;

      const apiMessages = convertMessages(previousMessages, systemPrompt);
      // Add the current user message
      apiMessages.push({ role: 'user', content: userMessage.text || '' });

      const provider = getProviderForEndpoint(endpoint);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let fullText = '';

      try {
        const stream = provider.streamChat(
          apiKey,
          {
            model,
            messages: apiMessages,
            stream: true,
            temperature: (endpointOption as Record<string, unknown>)?.temperature as number | undefined,
            max_tokens: (endpointOption as Record<string, unknown>)?.maxOutputTokens as number | undefined,
            top_p: (endpointOption as Record<string, unknown>)?.top_p as number | undefined,
            frequency_penalty: (endpointOption as Record<string, unknown>)?.frequency_penalty as number | undefined,
            presence_penalty: (endpointOption as Record<string, unknown>)?.presence_penalty as number | undefined,
          },
          abortController.signal,
        );

        for await (const chunk of stream) {
          if (chunk.done) {
            break;
          }

          fullText += chunk.text;

          // Use the content handler to update UI via the existing content part mechanism
          // The contentHandler expects TContentData with messageId, conversationId, index, type, and content
          contentHandler({
            data: {
              type: ContentTypes.TEXT,
              [ContentTypes.TEXT]: { value: fullText },
              index: 0,
              messageId: responseMessageId,
              conversationId,
              userMessageId: userMessage.messageId,
              thread_id: '',
            } as never,
            submission: currentSubmission as EventSubmission,
          });
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          console.log('[ClientSideChat] Request was aborted');
        } else {
          console.error('[ClientSideChat] Stream error:', error);
          const errorText =
            error instanceof Error ? error.message : 'An error occurred during the API call';

          errorHandler({
            data: {
              text: errorText,
              conversationId,
              messageId: responseMessageId,
              parentMessageId: userMessage.messageId,
            } as never,
            submission: currentSubmission as EventSubmission,
          });
          return;
        }
      }

      // Build the final response message
      const responseMessage: TMessage = {
        messageId: responseMessageId,
        conversationId,
        parentMessageId: userMessage.messageId,
        isCreatedByUser: false,
        model,
        endpoint,
        sender: model,
        text: fullText,
        content: [
          {
            type: ContentTypes.TEXT,
            [ContentTypes.TEXT]: { value: fullText },
          },
        ],
        unfinished: false,
        error: false,
      };

      const updatedUserMessage: TMessage = {
        ...userMessage,
        conversationId,
      };

      // Clear draft
      clearDraft(currentSubmission.conversation?.conversationId);

      // Use the finalHandler to update conversation state
      finalHandler(
        {
          requestMessage: updatedUserMessage,
          responseMessage,
          conversation: {
            conversationId,
            title: 'New Chat',
            endpoint,
            model,
          },
        } as never,
        currentSubmission as EventSubmission,
      );

      // Queue title generation for new conversations
      const isNewConvo = userMessage.parentMessageId === Constants.NO_PARENT;
      if (isNewConvo) {
        queueTitleGeneration(conversationId);
      }

      // Persist messages to backend
      if (token) {
        persistMessages(token, conversationId, updatedUserMessage, responseMessage);
      }

      // Refetch balance if enabled
      (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

      // Clear step maps
      clearStepMaps();
    },
    [
      token,
      setActiveRunId,
      createdHandler,
      contentHandler,
      finalHandler,
      errorHandler,
      clearStepMaps,
      startupConfig?.balance?.enabled,
      balanceQuery,
    ],
  );

  useEffect(() => {
    if (!submission || Object.keys(submission).length === 0) {
      // Cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      submissionRef.current = null;
      return;
    }

    submissionRef.current = submission;

    setIsSubmitting(true);
    setShowStopButton(true);
    setAbortScroll(false);

    runClientChat(submission);

    return () => {
      // Abort on cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      clearStepMaps();
      setIsSubmitting(false);
      setShowStopButton(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);
}
