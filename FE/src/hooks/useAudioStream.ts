import { useState, useRef, useCallback } from "react";

interface AudioStreamConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  bufferSize: number;
}

const DEFAULT_CONFIG: AudioStreamConfig = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  bufferSize: 4096,
};

interface StreamStats {
  framesSent: number;
  bytesSent: number;
  duration: number;
}

const downsampleBuffer = (buffer: Float32Array, inRate: number, outRate: number) => {
  if (outRate === inRate) return buffer;

  const ratio = inRate / outRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);

    let sum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      sum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? sum / count : 0;

    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
};

const floatTo16BitPCMBytes = (input: Float32Array) => {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
};

export function useAudioStream(sessionId: string | null, onTranscription?: (data: any) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StreamStats>({
    framesSent: 0,
    bytesSent: 0,
    duration: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const startedRef = useRef(false);
  const stoppingRef = useRef(false);

  const connect = useCallback(
    (sid: string) => {
      if (!sid) return;

      try {
        setError(null);

        const wsUrl = `ws://localhost:8000/ws/stream/${sid}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        ws.onclose = () => {
          setIsConnected(false);
          setIsRecording(false);
        };

        ws.onerror = () => {
          setError("Connection failed");
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "error") {
              setError(data.error || "Unknown error");
              return;
            }

            if (data.type && data.type.startsWith("transcription_") && onTranscription) {
              onTranscription(data);
            }
          } catch {
            // 
          }
        };

        wsRef.current = ws;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect");
      }
    },
    [onTranscription]
  );

  const startRecording = useCallback(
    async (mode: "batch" | "realtime" = "batch", languageCode: string = "en-US") => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("WebSocket not connected");
        return;
      }
      if (startedRef.current) return;

      try {
        setError(null);
        stoppingRef.current = false;

        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = mediaStream;

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;

        const inputRate = audioContext.sampleRate;

        const source = audioContext.createMediaStreamSource(mediaStream);
        sourceRef.current = source;

        // audio worklet module inline
        const workletCode = `
          class CaptureProcessor extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs[0];
              if (input && input[0]) {
                const channel = input[0];
                const copy = new Float32Array(channel.length);
                copy.set(channel);
                this.port.postMessage(copy, [copy.buffer]);
              }
              return true;
            }
          }
          registerProcessor("capture-processor", CaptureProcessor);
        `;
        const blob = new Blob([workletCode], { type: "application/javascript" });
        const workletUrl = URL.createObjectURL(blob);

        await audioContext.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        const workletNode = new AudioWorkletNode(audioContext, "capture-processor");
        workletNodeRef.current = workletNode;

        // send start control
        ws.send(
          JSON.stringify({
            type: "start",
            sessionId,
            sampleRate: DEFAULT_CONFIG.sampleRate,
            channels: DEFAULT_CONFIG.channels,
            bitDepth: DEFAULT_CONFIG.bitDepth,
            bufferSize: DEFAULT_CONFIG.bufferSize,
            languageCode,
            mode,
            inputSampleRate: inputRate,
          })
        );

        workletNode.port.onmessage = (ev) => {
          const w = wsRef.current;
          const ctx = audioContextRef.current;
          if (!w || w.readyState !== WebSocket.OPEN) return;
          if (!ctx) return;
          if (!startedRef.current) return;
          if (stoppingRef.current) return;

          // backpressure guard
          if (w.bufferedAmount > 2_000_000) return;

          const chunk = new Float32Array(ev.data as ArrayBuffer);
          const down = downsampleBuffer(chunk, ctx.sampleRate, 16000);
          const pcmBytes = floatTo16BitPCMBytes(down);

          w.send(pcmBytes);

          setStats((prev) => ({
            ...prev,
            framesSent: prev.framesSent + 1,
            bytesSent: prev.bytesSent + pcmBytes.byteLength,
            duration: prev.duration + down.length / 16000,
          }));
        };

        // connect graph
        source.connect(workletNode);

        // keep live without audible output
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        workletNode.connect(gain);
        gain.connect(audioContext.destination);

        startedRef.current = true;
        setIsRecording(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Microphone access denied");
        startedRef.current = false;
        setIsRecording(false);
      }
    },
    [sessionId]
  );

  const stopRecording = useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop", sessionId }));
      } catch {}
    }

    startedRef.current = false;
    setIsRecording(false);

    // disconnect nodes
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

    // stop mic tracks
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    // close audio context safely
    const ctx = audioContextRef.current;
    audioContextRef.current = null;

    if (ctx) {
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    }
  }, [sessionId]);

  const disconnect = useCallback(() => {
    stopRecording();

    const ws = wsRef.current;
    wsRef.current = null;

    if (ws) {
      try {
        ws.close();
      } catch {}
    }

    setIsConnected(false);
  }, [stopRecording]);

  return {
    connect,
    disconnect,
    startRecording,
    stopRecording,
    isConnected,
    isRecording,
    error,
    stats,
  };
}
