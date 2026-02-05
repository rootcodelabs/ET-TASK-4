export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export interface ChatSession {
  id: string;
  messages: Message[];
  createdAt: Date;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface TranscriptionResponse {
  session_id: string;
  text: string;
  confidence?: number;
  duration_ms?: number;
}
