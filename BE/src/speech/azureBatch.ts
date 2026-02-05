import * as sdk from "microsoft-cognitiveservices-speech-sdk";

const parseWavPcm = (buffer: Buffer) => {
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

export const transcribeBatch = async (
  key: string,
  region: string,
  audioBuffer: Buffer,
  language: string = "et-EE"
) => {
  const wav = parseWavPcm(audioBuffer);

  if (wav.audioFormat !== 1) {
    throw new Error("Only PCM WAV is supported");
  }
  if (wav.channels !== 1 || wav.sampleRate !== 16000 || wav.bitsPerSample !== 16) {
    throw new Error("WAV must be 16kHz mono 16-bit PCM");
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = language;

  const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  pushStream.write(wav.data);
  pushStream.close();

  const result = await new Promise<sdk.SpeechRecognitionResult>((resolve, reject) => {
    recognizer.recognizeOnceAsync(resolve, reject);
  });

  recognizer.close();

  return {
    text: result.text || "",
    durationMs: result.duration || undefined,
  };
};
