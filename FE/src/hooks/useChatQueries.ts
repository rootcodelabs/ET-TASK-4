import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';

export const useChatSession = (sessionId: string) => {
  return useQuery({
    queryKey: ['chat-session', sessionId],
    queryFn: () => chatService.getChatSession(sessionId),
    enabled: !!sessionId,
  });
};

export const useSendMessage = (sessionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: string) => chatService.sendMessage(sessionId, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-session', sessionId] });
    },
  });
};

export const useCreateChatSession = () => {
  return useMutation({
    mutationFn: () => chatService.createChatSession(),
  });
};

export const useChatHistory = () => {
  return useQuery({
    queryKey: ['chat-history'],
    queryFn: () => chatService.getChatHistory(),
  });
};
