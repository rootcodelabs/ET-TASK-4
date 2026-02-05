# Bürokratt Chat Widget

A production-ready React web application featuring an AI-powered chat widget interface.

## Technology Stack

- **React 19** with TypeScript
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Re-usable component library
- **TanStack Query** - Data fetching and caching
- **Axios** - HTTP client with shared instance
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **React Router v6+** - Client-side routing

## Project Structure

```
src/
├── components/          # React components
│   ├── ui/             # shadcn/ui components (Button, Input, Card)
│   └── ChatWidget.tsx  # Main chat widget component
├── pages/              # Route pages
│   ├── Home.tsx        # Home page with chat widget
│   └── Contact.tsx     # Example form page
├── lib/                # Utilities and configurations
│   ├── utils.ts        # Utility functions (cn)
│   ├── axios.ts        # Axios instance with interceptors
│   └── queryClient.ts  # TanStack Query configuration
├── services/           # API service layer
│   └── chatService.ts  # Chat API methods
├── hooks/              # Custom React hooks
│   └── useChatQueries.ts # TanStack Query hooks for chat
├── types/              # TypeScript type definitions
│   └── index.ts        # Common types
└── styles/             # Global styles
    └── globals.css     # Tailwind imports and CSS variables
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Update `.env` with your API configuration:
```env
VITE_API_BASE_URL=http://localhost:3000/api
```

### Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Build

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Features

### Chat Widget
- Real-time messaging interface
- AI assistant integration ready
- Voice input button (UI placeholder)
- Expandable/collapsible interface
- Message history
- Auto-scroll to latest message

### Axios Configuration
- Single shared instance with interceptors
- Automatic authentication header injection
- Global error handling
- 401 redirect to login
- Configurable base URL and timeout

### TanStack Query Integration
- Optimized data fetching and caching
- Custom hooks for chat operations
- Automatic query invalidation
- 1-minute stale time default
- Retry logic

### Form Validation
- React Hook Form integration
- Zod schema validation
- Type-safe form handling
- Real-time validation feedback
- Example contact form included

### Routing
- React Router v6+ setup
- Multiple page example
- Navigation component
- Type-safe route definitions

## Component Library

### UI Components (shadcn/ui)
- **Button** - Multiple variants and sizes
- **Input** - Accessible form input
- **Card** - Content container with header/footer
- All components are customizable via Tailwind classes

### Custom Components
- **ChatWidget** - Complete chat interface
- Fully typed props
- Responsive design
- Extensible architecture

## API Integration

The application includes a complete API service layer:

```typescript
// Example: Send a message
const { mutate: sendMessage } = useSendMessage(sessionId);
sendMessage('Hello, AI assistant!');

// Example: Get chat history
const { data: history } = useChatHistory();
```

## Styling

- Tailwind CSS with custom design tokens
- CSS variables for theming
- Dark mode support (configured)
- Responsive design utilities
- Custom utility functions (`cn`)

## Type Safety

Full TypeScript support with:
- Strict mode enabled
- Type definitions for all components
- API response types
- Form schema types
- No implicit any

## Best Practices

- ✅ Component composition
- ✅ Custom hooks for logic reuse
- ✅ Service layer pattern
- ✅ Centralized API configuration
- ✅ Error handling
- ✅ Type safety throughout
- ✅ Responsive design
- ✅ Accessibility considerations

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:3000/api` |

## License

Private project for Estonia challenge.
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
