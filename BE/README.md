# BE (Node Backend)

Node.js backend for live STT, batch transcription, chat (Azure OpenAI), and TTS.

## Features

- WebSocket STT: `ws://localhost:8080/ws/stt`
- Batch transcription: `POST /api/transcribe/batch/:sessionId`
- Chat completions: `POST /api/chat`
- TTS: `POST /api/tts`
- Session create: `POST /api/sessions/create`

## Setup

```bash
cd BE
npm install
```

Create `.env`:

```bash
copy .env.example .env
```

Fill in Azure credentials in `.env`.

## Run (Development)

```bash
cd BE
npm run dev
```

## Environment Variables

```
PORT=8080
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_VERSION=2024-04-01-preview

AZURE_TTS_VOICE_ET=et-EE-AnuNeural
AZURE_TTS_VOICE_EN=en-US-JennyNeural
AZURE_TTS_VOICE_RU=ru-RU-SvetlanaNeural
```
