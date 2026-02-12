/**
 * Triton Batch Transcription
 */

import { logger } from "../utils/logger";
import { inferTriton, STT_MODEL } from "./tritonClient";
import { parseWavPcm, pcmToFloat32, padOrTrimAudio } from "../utils/audioUtils";

/**
 * Transcribe audio file using Triton Inference Server
 */
export const transcribeBatch = async (
  audioBuffer: Buffer,
  language: string = "et-EE"
): Promise<{ text: string; durationMs: number }> => {
  const modelName = STT_MODEL();
  const startTime = Date.now();
  
  try {
    logger.info(`Triton batch transcription started. model=${modelName}, language=${language}`);

    // Parse WAV file
    const wav = parseWavPcm(audioBuffer);

    // Validate format
    if (wav.audioFormat !== 1) {
      throw new Error("Only PCM WAV is supported");
    }
    if (wav.channels !== 1) {
      throw new Error("WAV must be mono (1 channel)");
    }
    if (wav.bitsPerSample !== 16) {
      throw new Error("WAV must be 16-bit");
    }

    // Convert PCM to Float32Array
    let audioFloat32 = pcmToFloat32(wav.data);

    // Resample
    if (wav.sampleRate !== 16000) {
      logger.warn(`Audio sample rate is ${wav.sampleRate}Hz, expected 16000Hz`);
      // TODO: Implement proper resampling using a library
      // For now, we'll just pad/trim
    }

    // Pad to 30 seconds
    const targetSamples = 30 * 16000; // 480,000 samples at 16kHz
    audioFloat32 = padOrTrimAudio(audioFloat32, targetSamples);

    // Convert language code (et-EE -> et)
    const languageCode = language.split('-')[0];

    // Prepare inputs
    const inputs: Record<string, any> = {
      audio: audioFloat32,
    };

    // Add language if supported
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
    
    const durationMs = Date.now() - startTime;
    logger.info(`Triton batch transcription completed. Length: ${text.length} chars, duration: ${durationMs}ms`);
    
    return {
      text,
      durationMs,
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Triton batch transcription failed: ${message}`);
    throw error;
  }
};
