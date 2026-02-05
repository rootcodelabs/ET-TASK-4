# Burokratt Chat Widget (FE)

React + TypeScript frontend for the Burokratt chat widget. Includes text chat, live STT streaming, batch voice capture, and TTS playback.

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Axios

## Project Structure (FE)

```
src/
  audio/
    pcmWorkletProcessor.js   # AudioWorklet for PCM16 capture
  components/
    ChatWidget.tsx           # Main chat widget UI
    ui/                      # shadcn/ui components
  hooks/
    useSttStreaming.ts       # Live STT WebSocket hook
  lib/
    axios.ts                 # Axios instance (API base)
  services/
    chatService.ts           # API calls (chat, TTS, batch)
  types/
    index.ts                 # Shared types
  styles/
    globals.css
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Environment

Create `.env`:

```bash
copy .env.example .env
```

Set values (typical local dev):

```
VITE_API_BASE_URL=http://localhost:8080
VITE_LLM_API_URL=http://localhost:8080
VITE_STT_WS_URL=ws://localhost:8080/ws/stt
```

### Run

```bash
npm run dev
```

App runs at `http://localhost:5173`.

## Features

- Text chat with Azure OpenAI responses (Estonian)
- Live STT streaming over WebSocket
- Batch voice capture with WAV PCM upload
- TTS playback for assistant messages
- Thinking/processing states
- Responsive chat UI

## Notes

- `.env` files are ignored by git. Do not commit secrets.
- Backend endpoints expected on the Node server:
  - `POST /api/chat`
  - `POST /api/tts`
  - `POST /api/sessions/create`
  - `POST /api/transcribe/batch/:sessionId`
  - `ws://host/ws/stt`

## Scripts

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run lint`
