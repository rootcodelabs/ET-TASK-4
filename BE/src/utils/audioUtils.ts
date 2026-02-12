/**
 * Audio processing utilities for Triton STT/TTS
 */

/**
 * Parse WAV file and extract PCM data
 */
export const parseWavPcm = (buffer: Buffer) => {
  if (buffer.length < 44) {
    throw new Error("Invalid WAV: too small");
  }

  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Invalid WAV header");
  }

  let offset = 12;
  let fmtFound = false;
  let dataFound = false;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkStart + 0);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      fmtFound = true;
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = chunkSize;
      dataFound = true;
      break;
    }

    offset = chunkStart + chunkSize;
  }

  if (!fmtFound || !dataFound) {
    throw new Error("Invalid WAV: missing fmt or data");
  }

  return {
    audioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    data: buffer.slice(dataOffset, dataOffset + dataSize),
  };
};

/**
 * Convert PCM int16 buffer to Float32Array normalized to [-1, 1]
 */
export const pcmToFloat32 = (buffer: Buffer): Float32Array => {
  const samples = buffer.length / 2;
  const float32 = new Float32Array(samples);
  
  for (let i = 0; i < samples; i++) {
    const int16 = buffer.readInt16LE(i * 2);
    float32[i] = int16 / 32768.0; // Normalize to [-1, 1]
  }
  
  return float32;
};

/**
 * Convert Float32Array to PCM int16 buffer
 */
export const float32ToPcm = (float32: Float32Array): Buffer => {
  const buffer = Buffer.allocUnsafe(float32.length * 2);
  
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i])); // Clamp
    const int16 = Math.round(sample * 32767);
    buffer.writeInt16LE(int16, i * 2);
  }
  
  return buffer;
};

/**
 * Create WAV file buffer from Float32Array
 */
export const audioToWavBytes = (audio: Float32Array, sampleRate: number): Buffer => {
  const pcmData = float32ToPcm(audio);
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4); // File size - 8
  header.write("WAVE", 8);

  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // Audio format (PCM)
  header.writeUInt16LE(1, 22); // Channels (mono)
  header.writeUInt32LE(sampleRate, 24); // Sample rate
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // Bits per sample

  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
};

/**
 * Pad or trim audio to target length
 */
export const padOrTrimAudio = (audio: Float32Array, targetLength: number): Float32Array => {
  if (audio.length === targetLength) {
    return audio;
  }

  const result = new Float32Array(targetLength);
  if (audio.length > targetLength) {
    // Trim
    result.set(audio.subarray(0, targetLength));
  } else {
    // Pad with zeros
    result.set(audio);
  }
  return result;
};

/**
 * Streaming audio buffer with chunking and overlap
 */
export class StreamingAudioBuffer {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly chunkSizeBytes: number;
  private readonly overlapBytes: number;
  private readonly sampleRate: number;

  constructor(chunkSeconds: number, overlapPercent: number, sampleRate: number) {
    this.sampleRate = sampleRate;
    // PCM 16-bit mono: 2 bytes per sample
    this.chunkSizeBytes = Math.floor(chunkSeconds * sampleRate * 2);
    this.overlapBytes = Math.floor(this.chunkSizeBytes * overlapPercent);
  }

  /**
   * Add audio data to buffer
   */
  write(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  /**
   * Check if we have a complete chunk ready
   */
  hasCompleteChunk(): boolean {
    return this.buffer.length >= this.chunkSizeBytes;
  }

  /**
   * Get next audio chunk with overlap, return as Float32Array
   */
  getNextChunk(): Float32Array {
    if (!this.hasCompleteChunk()) {
      throw new Error("No complete chunk available");
    }

    // Extract chunk
    const chunk = this.buffer.slice(0, this.chunkSizeBytes);
    
    // Keep overlap for next chunk
    this.buffer = this.buffer.slice(this.chunkSizeBytes - this.overlapBytes);

    // Convert to Float32Array
    return pcmToFloat32(chunk);
  }

  /**
   * Get remaining audio in buffer (for final transcription)
   */
  getRemainingAudio(): Float32Array {
    if (this.buffer.length === 0) {
      return new Float32Array(0);
    }

    const remaining = this.buffer;
    this.buffer = Buffer.alloc(0);
    return pcmToFloat32(remaining);
  }

  /**
   * Flush and get all remaining audio
   */
  flush(): Float32Array {
    return this.getRemainingAudio();
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Get current buffer size in bytes
   */
  getBufferSize(): number {
    return this.buffer.length;
  }
}
