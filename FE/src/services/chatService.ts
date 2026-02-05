import axiosInstance from '@/lib/axios';
import axios from 'axios';
import type { Message, ChatSession, TranscriptionResponse } from '@/types';

const llmAxios = axios.create({
  baseURL: import.meta.env.VITE_LLM_API_URL || 'http://localhost:8080',
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const chatService = {
  async sendMessage(sessionId: string, message: string): Promise<Message> {
    const response = await axiosInstance.post(`/chat/${sessionId}/messages`, {
      content: message,
    });
    return response.data;
  },

  async getChatSession(sessionId: string): Promise<ChatSession> {
    const response = await axiosInstance.get(`/chat/${sessionId}`);
    return response.data;
  },

  async createChatSession(): Promise<ChatSession> {
    const response = await axiosInstance.post('/chat/sessions');
    return response.data;
  },

  async getChatHistory(): Promise<ChatSession[]> {
    const response = await axiosInstance.get('/chat/sessions');
    return response.data;
  },

  async createAudioSession(clientId: string): Promise<{ session_id: string }> {
    const response = await axiosInstance.post('/api/sessions/create', {
      client_id: clientId,
      language_code: "et-EE"  // Estonian language
    });
    return response.data;
  },

  async transcribeBatch(sessionId: string, audioBlob: Blob): Promise<TranscriptionResponse> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.wav');

    const response = await axiosInstance.post(`/api/transcribe/batch/${sessionId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000,
    });
    return response.data;
  },

  async getAssistantReply(message: string, clientId?: string): Promise<{ text: string }> {
    const response = await llmAxios.post('/api/chat', {
      message,
      clientId,
    });
    return response.data;
  },

  async synthesizeSpeech(text: string): Promise<ArrayBuffer> {
    const response = await llmAxios.post('/api/tts', { text }, { responseType: 'arraybuffer' });
    return response.data;
  },
};
