export interface StartMessage {
  type: "start";
  language?: string;
  clientId?: string;
  provider?: "cloud" | "onprem";
}

export interface StopMessage {
  type: "stop";
}

export type ClientMessage = StartMessage | StopMessage;

export interface PartialMessage {
  type: "partial";
  text: string;
  offset?: number;
  duration?: number;
  clientId?: string;
}

export interface FinalMessage {
  type: "final";
  text: string;
  offset?: number;
  duration?: number;
  clientId?: string;
}

export interface ErrorMessage {
  type: "error";
  reason: string;
  details?: string;
  clientId?: string;
}

export interface StoppedMessage {
  type: "stopped";
  clientId?: string;
}

export interface StartedMessage {
  type: "started";
  clientId?: string;
}

export type ServerMessage =
  | PartialMessage
  | FinalMessage
  | ErrorMessage
  | StoppedMessage
  | StartedMessage;

export const parseClientMessage = (raw: string): ClientMessage | null => {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;

    if (data.type === "start") {
      return {
        type: "start",
        language: typeof data.language === "string" ? data.language : undefined,
        clientId: typeof data.clientId === "string" ? data.clientId : undefined,
        provider: data.provider === "onprem" || data.provider === "cloud" 
        ? data.provider 
        : undefined,
      };
    }

    if (data.type === "stop") {
      return { type: "stop" };
    }

    return null;
  } catch {
    return null;
  }
};

export const normalizeLanguage = (language?: string): string => {
  if (!language || !language.trim()) return "et-EE";

  const normalized = language.trim().replace(/[_\s]+/g, "-");
  const parts = normalized.split("-");

  if (parts.length === 2) {
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }

  return normalized;
};
