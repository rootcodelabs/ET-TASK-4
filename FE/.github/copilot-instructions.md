# Project Setup Instructions

## Technology Stack
- React 19+ with TypeScript
- Vite for build tooling
- Tailwind CSS v3 for styling
- shadcn/ui for UI components
- TanStack Query for data fetching
- Axios for HTTP requests
- React Hook Form with Zod for form validation
- React Router v7+ for routing

## Progress
- [x] Create .github/copilot-instructions.md file
- [x] Scaffold React + Vite + TypeScript project
- [x] Configure Tailwind CSS
- [x] Set up shadcn/ui
- [x] Configure TanStack Query and Axios
- [x] Set up React Router v7
- [x] Configure React Hook Form with Zod
- [x] Create project structure and example components
- [x] Install dependencies and compile
- [x] Finalize documentation

## Getting Started

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Key Features Implemented
- ✅ Chat Widget component matching the design specification
- ✅ Shared Axios instance with interceptors
- ✅ TanStack Query hooks for data fetching
- ✅ React Hook Form with Zod validation
- ✅ React Router v7 with navigation
- ✅ shadcn/ui components (Button, Input, Card)
- ✅ TypeScript strict mode with path aliases
- ✅ Production build verified

## Project Structure
```
src/
├── components/      # React components
│   ├── ui/         # shadcn/ui base components
│   └── ChatWidget.tsx
├── pages/          # Route pages
├── lib/            # Utilities and configurations
├── services/       # API service layer
├── hooks/          # Custom React hooks
├── types/          # TypeScript types
└── styles/         # Global styles
```

