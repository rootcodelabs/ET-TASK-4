import { useCallback, useEffect, useRef, useState } from "react";
import pcmWorkletSource from "../audio/pcmWorkletProcessor.js?raw";

interface UseSttStreamingOptions {
  url?: string;
  language?: string;
  clientId?: string;
  provider?: "cloud" | "onprem";
  onPartial?: (text: string, meta?: any) => void;
  onFinal?: (text: string, meta?: any) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onStopped?: () => void;
}

interface ServerMessage {
  type: "partial" | "final" | "error" | "stopped" | "started";
  text?: string;
  offset?: number;
  duration?: number;
  reason?: string;
  details?: string;
  clientId?: string;
}

const DEFAULT_URL =
  import.meta.env.VITE_STT_WS_URL || "ws://localhost:8080/ws/stt";

const normalizeLanguage = (language?: string) => {
  if (!language || !language.trim()) return "et-EE";
  const normalized = language.trim().replace(/[_\s]+/g, "-");
  const parts = normalized.split("-");
  if (parts.length === 2) {
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  return normalized;
};

const mergeTranscript = (existing: string, incoming: string) => {
  const base = existing.trim();
  const add = incoming.trim();
  if (!add) return base;
  if (!base) return add;

  const maxOverlap = Math.min(base.length, add.length);
  for (let len = maxOverlap; len > 0; len -= 1) {
    if (base.slice(-len) === add.slice(0, len)) {
      return `${base}${add.slice(len)}`;
    }
  }

  return `${base} ${add}`.trim();
};

export function useSttStreaming(options: UseSttStreamingOptions = {}) {
  const {
    url = DEFAULT_URL,
    language = "et-EE",
    clientId,
    provider = "cloud",
    onPartial,
    onFinal,
    onFinalTranscript,
    onError,
    onStopped,
  } = options;

  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [partialText, setPartialText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const startedRef = useRef(false);
  const stoppingRef = useRef(false);
  const finalBufferRef = useRef<string[]>([]);
  const sendBufferRef = useRef<ArrayBuffer[]>([]);
  const readyRef = useRef(false);
  const onFinalTranscriptRef = useRef<typeof onFinalTranscript>(onFinalTranscript);

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const cleanupAudio = useCallback(() => {
    try {
      if (sourceRef.current) sourceRef.current.disconnect();
    } catch {}

    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      }
    } catch {}

    sourceRef.current = null;
    workletNodeRef.current = null;

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    } catch {}

    streamRef.current = null;

    const ctx = audioContextRef.current;
    audioContextRef.current = null;

    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {});
    }
  }, []);

  const stop = useCallback(
    (sendStop = true) => {
      if (stoppingRef.current) return;
      stoppingRef.current = true;

      startedRef.current = false;
      setIsStreaming(false);
      setIsConnecting(false);
      setIsReady(false);
      readyRef.current = false;
      setPartialText("");
      if (finalBufferRef.current.length > 0) {
        const combined = finalBufferRef.current.join(" ").trim();
        // keep combined transcript in ref only
        if (combined && onFinalTranscriptRef.current) {
          onFinalTranscriptRef.current(combined);
        }
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && sendStop) {
        try {
          ws.send(JSON.stringify({ type: "stop" }));
        } catch {}
      }

      cleanupAudio();

      if (ws) {
        try {
          ws.close();
        } catch {}
      }
    },
    [cleanupAudio]
  );

  const start = useCallback(async () => {
    if (startedRef.current) return;

    setError(null);
    setPartialText("");
    setIsConnecting(true);
    setIsReady(false);
    readyRef.current = false;
    finalBufferRef.current = [];

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = mediaStream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const workletBlob = new Blob([pcmWorkletSource], {
        type: "application/javascript",
      });
      const workletUrl = URL.createObjectURL(workletBlob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const workletNode = new AudioWorkletNode(audioContext, "pcm16-processor");
      workletNodeRef.current = workletNode;

      const source = audioContext.createMediaStreamSource(mediaStream);
      sourceRef.current = source;

      source.connect(workletNode);

      const gain = audioContext.createGain();
      gain.gain.value = 0;
      workletNode.connect(gain);
      gain.connect(audioContext.destination);

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        const lang = normalizeLanguage(language);
        const message = { type: "start", language: lang, clientId, provider };
        ws.send(JSON.stringify(message));
        startedRef.current = true;
        stoppingRef.current = false;
        setIsStreaming(true);
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;

        let message: ServerMessage;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === "started") {
          readyRef.current = true;
          setIsConnecting(false);
          setIsReady(true);
          const pending = sendBufferRef.current;
          sendBufferRef.current = [];
          pending.forEach((chunk, index) => {
            const socket = wsRef.current;
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(chunk);
            }
          });
          return;
        }

        if (message.type === "partial") {
          const text = message.text || "";
          setPartialText(text);
          if (onPartial) onPartial(text, message);
          return;
        }

        if (message.type === "final") {
          const text = message.text || "";
          setPartialText("");
          if (text) {
            const combined = mergeTranscript(
              finalBufferRef.current.join(" "),
              text
            );
            finalBufferRef.current = combined ? [combined] : [];
            if (onFinal) onFinal(text, message);
          }
          return;
        }

        if (message.type === "error") {
          const details = message.details || message.reason || "STT error";
          setError(details);
          if (onError) onError(details);
          stop(false);
          return;
        }

        if (message.type === "stopped") {
          startedRef.current = false;
          setIsStreaming(false);
          setIsConnecting(false);
          setIsReady(false);
          readyRef.current = false;
          setPartialText("");
          const combined = finalBufferRef.current.join(" ").trim();
          if (combined && onFinalTranscript) onFinalTranscript(combined);
          if (onStopped) onStopped();
          return;
        }
      };

      ws.onerror = () => {
        const message = "WebSocket connection error";
        setError(message);
        if (onError) onError(message);
      };

      ws.onclose = () => {
        console.warn("STT WebSocket closed");
        wsRef.current = null;
        startedRef.current = false;
        setIsStreaming(false);
        setIsConnecting(false);
        setIsReady(false);
        readyRef.current = false;
        setPartialText("");
        cleanupAudio();
        stoppingRef.current = false;
      };

      workletNode.port.onmessage = (ev) => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        if (!startedRef.current || stoppingRef.current) {
          return;
        }
        if (readyRef.current) {
          socket.send(ev.data);
        } else {
          const data = ev.data as ArrayBuffer;
          sendBufferRef.current.push(data);
          if (sendBufferRef.current.length > 50) {
            sendBufferRef.current.shift();
          }
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start streaming";
      setError(message);
      if (onError) onError(message);
      stop(false);
      throw err;
    }
  }, [cleanupAudio, language, clientId, provider, onError, onFinal, onPartial, onStopped, stop, url]);

  useEffect(() => {
    return () => {
      stop(false);
    };
  }, [stop]);

  return {
    start,
    stop,
    isStreaming,
    isConnecting,
    isReady,
    partialText,
    error,
  };
}
