/**
 * Triton STT Streaming Session (equivalent to azureSpeech.ts)
 */

import { logger } from "../utils/logger";
import { inferTriton, STT_MODEL } from "./tritonClient";
import { StreamingAudioBuffer, padOrTrimAudio } from "../utils/audioUtils";

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
  language: string;
  onPartial: (event: RecognitionEvent) => void;
  onFinal: (event: RecognitionEvent) => void;
  onError: (event: ErrorEvent) => void;
  onStopped: () => void;
}

/**
 * Create Triton STT streaming session
 */
export const createTritonSession = (options: CreateSessionOptions): SttSession => {
  const modelName = STT_MODEL();
  const sampleRate = 16000;
  const chunkSeconds = 3.0; // Process every 3 seconds
  const overlapPercent = 0.2; // 20% overlap
  
  const buffer = new StreamingAudioBuffer(chunkSeconds, overlapPercent, sampleRate);
  let isStarted = false;
  let isProcessing = false;
  
  logger.info(`Triton STT session created. model=${modelName}, language=${options.language}`);

  // Convert language code (et-EE -> et)
  const languageCode = options.language.split('-')[0];

  /**
   * Process audio chunk with Triton
   */
  const processChunk = async (audioChunk: Float32Array, isFinal: boolean = false) => {
    if (isProcessing) {
      return; // Skip if already processing
    }

    isProcessing = true;

    try {
      // Pad to 30 seconds (Whisper requirement)
      const targetSamples = 30 * sampleRate; // 480,000 samples
      const paddedAudio = padOrTrimAudio(audioChunk, targetSamples);

      // Prepare inputs for Whisper model
      const inputs: Record<string, any> = {
        audio: paddedAudio,
      };

      // Add language if supported by model
      if (languageCode) {
        inputs.language = [languageCode];
      }

      // Run inference
      const outputs = await inferTriton(modelName, inputs, ['transcription']);
      
      // Extract text
      let text = '';
      if (typeof outputs.transcription === 'string') {
        text = outputs.transcription;
      } else if (Array.isArray(outputs.transcription)) {
        text = outputs.transcription[0] || '';
      } else if (outputs.transcription) {
        text = String(outputs.transcription);
      }

      text = text.trim();

      if (text) {
        if (isFinal) {
          options.onFinal({ text });
        } else {
          options.onPartial({ text });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Triton inference error: ${message}`);
      options.onError({
        reason: 'InferenceError',
        details: message,
      });
    } finally {
      isProcessing = false;
    }
  };

  return {
    async start() {
      isStarted = true;
      logger.info('Triton STT session started');
    },

    write(data: Buffer | ArrayBuffer) {
      if (!isStarted) return;

      const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data);
      buffer.write(bufferData);

      // Process complete chunks
      while (buffer.hasCompleteChunk()) {
        const chunk = buffer.getNextChunk();
        // Process asynchronously without awaiting
        processChunk(chunk, false).catch(err => {
          logger.error(`Chunk processing failed: ${err.message}`);
        });
      }
    },

    async stop() {
      if (!isStarted) return;

      isStarted = false;
      logger.info('Triton STT session stopping...');

      // Process remaining audio as final
      const remaining = buffer.getRemainingAudio();
      if (remaining.length > 0) {
        await processChunk(remaining, true);
      }

      options.onStopped();
      logger.info('Triton STT session stopped');
    },

    close() {
      buffer.clear();
      isStarted = false;
      logger.info('Triton STT session closed');
    },
  };
};
