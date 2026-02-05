import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { logger } from "../utils/logger";

export interface RecognitionEvent {
  text: string;
  offset?: number;
  duration?: number;
}

export interface ErrorEvent {
  reason: string;
  details?: string;
}

export interface SttSession {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  write: (data: Buffer | ArrayBuffer) => void;
  close: () => void;
}

interface CreateSessionOptions {
  key: string;
  region: string;
  language: string;
  onPartial: (event: RecognitionEvent) => void;
  onFinal: (event: RecognitionEvent) => void;
  onError: (event: ErrorEvent) => void;
  onStopped: () => void;
}

export const createAzureSession = (options: CreateSessionOptions): SttSession => {
  const speechConfig = sdk.SpeechConfig.fromSubscription(
    options.key,
    options.region
  );
  speechConfig.speechRecognitionLanguage = options.language;
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    "10000"
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    "2000"
  );
  logger.info(`Azure Speech configured. language=${options.language}`);

  const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => {
    const text = e.result?.text || "";
    logger.info(`Azure recognizing: ${text}`);
    if (!text) return;
    options.onPartial({
      text,
      offset: e.result.offset,
      duration: e.result.duration,
    });
  };

  recognizer.recognized = (_s, e) => {
    const text = e.result?.text || "";
    logger.info(`Azure recognized: ${text}`);
    if (!text) return;
    options.onFinal({
      text,
      offset: e.result.offset,
      duration: e.result.duration,
    });
  };

  recognizer.canceled = (_s, e) => {
    const reason =
      (sdk.CancellationReason as any)[e.reason] || "canceled";
    logger.error(`Azure canceled: ${reason}`, e.errorDetails);
    options.onError({
      reason,
      details: e.errorDetails,
    });
  };

  recognizer.sessionStopped = () => {
    logger.info("Azure session stopped");
    options.onStopped();
  };

  const start = () =>
    new Promise<void>((resolve, reject) => {
      recognizer.startContinuousRecognitionAsync(
        () => resolve(),
        (err) => reject(err)
      );
    });

  const stop = () =>
    new Promise<void>((resolve, reject) => {
      recognizer.stopContinuousRecognitionAsync(
        () => resolve(),
        (err) => reject(err)
      );
    });

  const write = (data: Buffer | ArrayBuffer) => {
    try {
      let buffer: ArrayBuffer;

      if (data instanceof ArrayBuffer) {
        buffer = data;
      } else {
        buffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        );
      }

      pushStream.write(buffer);
    } catch (err) {
      logger.error("Failed to write to push stream", err);
    }
  };

  const close = () => {
    try {
      recognizer.close();
    } catch {
      // ignore close errors
    }

    try {
      pushStream.close();
    } catch {
      // ignore close errors
    }
  };

  return { start, stop, write, close };
};
