const TARGET_SAMPLE_RATE = 16000;

const downsampleBuffer = (
  buffer: Float32Array,
  inRate: number,
  outRate: number
): Float32Array => {
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

const floatTo16BitPCM = (input: Float32Array): Int16Array => {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};

class PCM16Processor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      const downsampled = downsampleBuffer(
        channel,
        sampleRate,
        TARGET_SAMPLE_RATE
      );
      const pcm16 = floatTo16BitPCM(downsampled);
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-processor", PCM16Processor);
