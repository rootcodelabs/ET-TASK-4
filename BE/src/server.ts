import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import http from "http";
import { createAzureSession, SttSession } from "./speech/azureSpeech";
import { transcribeBatch } from "./speech/azureBatch";
import multer from "multer";
import crypto from "crypto";
import * as speechsdk from "microsoft-cognitiveservices-speech-sdk";
import {
  parseClientMessage,
  normalizeLanguage,
  ServerMessage,
} from "./types/wsMessages";
import { logger } from "./utils/logger";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const PATH = "/ws/stt";
const MAX_SESSION_SECONDS = Number(process.env.MAX_SESSION_SECONDS || 7200);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: PATH });

logger.info(`STT WebSocket server listening on ws://localhost:${PORT}${PATH}`);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const getEnv = (key: string) => process.env[key] || "";

const buildAzureChatUrl = () => {
  const endpoint = getEnv("AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
  const deployment = getEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiVersion = getEnv("AZURE_OPENAI_API_VERSION");
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
};

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const clientId =
    typeof req.body?.clientId === "string" ? req.body.clientId : undefined;

  if (!message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }

  const apiKey = getEnv("AZURE_OPENAI_KEY");
  const endpoint = getEnv("AZURE_OPENAI_ENDPOINT");
  const deployment = getEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiVersion = getEnv("AZURE_OPENAI_API_VERSION");

  if (!apiKey || !endpoint || !deployment || !apiVersion) {
    return res.status(500).json({
      error:
        "Missing AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, or AZURE_OPENAI_API_VERSION",
    });
  }

  try {
    const response = await fetch(buildAzureChatUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. Answer only in Estonian. Be concise and clear.",
          },
          { role: "user", content: message },
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error("Azure OpenAI error", text);
      return res.status(500).json({ error: "Azure OpenAI request failed" });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim?.() || "Vabandust, ma ei saanud vastust.";

    return res.json({ text: reply, clientId });
  } catch (err) {
    logger.error("Chat request failed", err);
    return res.status(500).json({ error: "Chat request failed" });
  }
});

app.post("/api/sessions/create", (req, res) => {
  const sessionId = `session_${crypto.randomUUID()}`;
  res.json({ session_id: sessionId });
});

app.post(
  "/api/transcribe/batch/:sessionId",
  upload.single("audio"),
  async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "Audio file is required" });
    }

    const key = getEnv("AZURE_SPEECH_KEY");
    const region = getEnv("AZURE_SPEECH_REGION");
    if (!key || !region) {
      return res.status(500).json({ error: "Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION" });
    }

    try {
      if (!file.mimetype.includes("wav")) {
        return res.status(400).json({ error: "Only WAV PCM 16kHz mono is supported" });
      }

      const result = await transcribeBatch(
        key,
        region,
        file.buffer,
        "et-EE"
      );

      return res.json({ text: result.text || "", duration_ms: result.durationMs });
    } catch (err) {
      logger.error("Batch transcription failed", err);
      return res.status(500).json({ error: "Batch transcription failed" });
    }
  }
);

const synthesizeSpeech = async (text: string) => {
  const key = getEnv("AZURE_SPEECH_KEY");
  const region = getEnv("AZURE_SPEECH_REGION");
  if (!key || !region) {
    throw new Error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION");
  }

  const speechConfig = speechsdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisLanguage = "et-EE";
  const voiceName = getEnv("AZURE_TTS_VOICE");
  if (voiceName) {
    speechConfig.speechSynthesisVoiceName = voiceName;
  }

  return new Promise<Buffer>((resolve, reject) => {
    const synthesizer = new speechsdk.SpeechSynthesizer(speechConfig);
    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === speechsdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(Buffer.from(result.audioData));
        } else {
          reject(new Error(result.errorDetails || "TTS failed"));
        }
      },
      (err) => {
        synthesizer.close();
        reject(err);
      }
    );
  });
};

app.post("/api/tts", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const audioBuffer = await synthesizeSpeech(text);
    res.setHeader("Content-Type", "audio/wav");
    res.send(audioBuffer);
  } catch (err) {
    logger.error("TTS request failed", err);
    return res.status(500).json({ error: "TTS request failed" });
  }
});

type ConnectionState = {
  session: SttSession | null;
  isStarted: boolean;
  startedAt: number | null;
  timeout: NodeJS.Timeout | null;
  stoppedSent: boolean;
  clientId: string | null;
};

const safeSend = (ws: WebSocket, message: ServerMessage) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendStoppedOnce = (ws: WebSocket, state: ConnectionState) => {
  if (state.stoppedSent) return;
  state.stoppedSent = true;
  safeSend(ws, { type: "stopped", clientId: state.clientId || undefined });
};

const stopSession = async (
  ws: WebSocket,
  state: ConnectionState,
  sendStopped: boolean
) => {
  if (state.timeout) {
    clearTimeout(state.timeout);
    state.timeout = null;
  }

  if (!state.isStarted) {
    if (sendStopped) sendStoppedOnce(ws, state);
    return;
  }

  state.isStarted = false;
  const session = state.session;
  state.session = null;

  if (session) {
    try {
      await session.stop();
    } catch (err) {
      logger.error("Failed to stop recognition", err);
    }

    try {
      session.close();
    } catch {
      // ignore close errors
    }
  }

  if (sendStopped) sendStoppedOnce(ws, state);
};

server.listen(PORT, () => {
  logger.info(`HTTP server listening on http://localhost:${PORT}`);
});

wss.on("connection", (ws) => {
  logger.info("Client connected");
  const state: ConnectionState = {
    session: null,
    isStarted: false,
    startedAt: null,
    timeout: null,
    stoppedSent: false,
    clientId: null,
  };
  let audioBytes = 0;

  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      if (!state.isStarted || !state.session) {
        safeSend(ws, {
          type: "error",
          reason: "not_started",
          details: "Start message required before streaming audio",
        });
        return;
      }

      try {
        audioBytes += (data as Buffer).byteLength;
        if (audioBytes % (16000 * 2 * 5) < (data as Buffer).byteLength) {
          logger.info(`Audio received ~${Math.round(audioBytes / 1000)} KB`);
        }
        state.session.write(data as Buffer);
      } catch (err) {
        safeSend(ws, {
          type: "error",
          reason: "audio_write_failed",
          details: err instanceof Error ? err.message : "Audio write failed",
        });
      }

      return;
    }

    const msg = parseClientMessage(data.toString());
    if (!msg) {
      safeSend(ws, {
        type: "error",
        reason: "bad_request",
        details: "Invalid JSON control message",
      });
      return;
    }

    if (msg.type === "start") {
      if (state.isStarted) {
        safeSend(ws, {
          type: "error",
          reason: "already_started",
          details: "Session already started",
        });
        return;
      }

      const key = process.env.AZURE_SPEECH_KEY;
      const region = process.env.AZURE_SPEECH_REGION;
      if (!key || !region) {
        safeSend(ws, {
          type: "error",
          reason: "config",
          details: "Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION",
        });
        return;
      }

      const language = normalizeLanguage(msg.language);
      state.clientId = msg.clientId || null;
      if (state.clientId) {
        logger.info(`Client id: ${state.clientId}`);
      }
      logger.info(`Start requested. language=${language}`);

      state.stoppedSent = false;

      try {
        const session = createAzureSession({
          key,
          region,
          language,
          onPartial: (event) => {
            safeSend(ws, {
              type: "partial",
              text: event.text,
              offset: event.offset,
              duration: event.duration,
              clientId: state.clientId || undefined,
            });
          },
          onFinal: (event) => {
            safeSend(ws, {
              type: "final",
              text: event.text,
              offset: event.offset,
              duration: event.duration,
              clientId: state.clientId || undefined,
            });
          },
          onError: (event) => {
            safeSend(ws, {
              type: "error",
              reason: event.reason,
              details: event.details,
              clientId: state.clientId || undefined,
            });
          },
          onStopped: () => {
            sendStoppedOnce(ws, state);
          },
        });

        state.session = session;
        state.isStarted = true;
        state.startedAt = Date.now();
        logger.info("Recognition session started");

        state.timeout = setTimeout(() => {
          safeSend(ws, {
            type: "error",
            reason: "max_session_exceeded",
            details: `Maximum session length ${MAX_SESSION_SECONDS}s exceeded`,
          });
          stopSession(ws, state, true).catch(() => {});
        }, MAX_SESSION_SECONDS * 1000);

        await session.start();
        safeSend(ws, { type: "started", clientId: state.clientId || undefined });
      } catch (err) {
        safeSend(ws, {
          type: "error",
          reason: "start_failed",
          details: err instanceof Error ? err.message : "Failed to start session",
        });
        await stopSession(ws, state, true);
      }

      return;
    }

    if (msg.type === "stop") {
      logger.info("Stop requested");
      await stopSession(ws, state, true);
      return;
    }
  });

  ws.on("close", (code, reason) => {
    const detail = reason ? reason.toString() : "";
    logger.info(`Client disconnected. code=${code}${detail ? ` reason=${detail}` : ""}`);
    stopSession(ws, state, false).catch(() => {});
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error", err);
  });
});
