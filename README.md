# Vibe2Ship

A comprehensive Chrome extension for managing tasks, habits, goals, and focus sessions with a companion dashboard.

> **Built on** [chrome-extension-boilerplate-react-vite](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite) by Seo Jong Hak

## Features

- **Task Capture**: Quickly capture tasks directly from any webpage
- **Focus Lock**: Block distracting websites during focus sessions
- **Dashboard**: Full-featured web dashboard for managing your productivity
- **Habit Tracking**: Track daily habits and routines
- **Goal Management**: Set and monitor your goals
- **Time Tracking**: Monitor focus sessions and productivity
- **Sync Storage**: Synchronized storage across all extension pages
- **Google Sign-In**: Authenticate via Google OAuth (`Dashboard/backend/auth.py`)
- **Google Calendar Sync** *(planned)*: two-way sync between the AI-generated time-blocked schedule and the user's Google Calendar — avoid conflicts when scheduling focus blocks, and surface planned blocks/deadlines on the user's calendar

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Python FastAPI
- **Extension**: Chrome Extension Manifest V3
- **Styling**: Tailwind CSS
- **Package Manager**: pnpm

## Project Structure

```
├── chrome-extension/       # Extension core and configuration
├── pages/                  # Individual extension UI pages
│   ├── popup/             # Extension popup
│   ├── side-panel/        # Side panel UI
│   ├── focus-lock/        # Focus blocking page
│   ├── task-capture/      # Task capture UI
│   └── ...
├── packages/              # Shared packages
│   ├── types/            # Shared TypeScript types
│   ├── storage/          # Storage layer
│   ├── messaging/        # Extension messaging
│   └── ui/               # Shared UI components
├── Dashboard/             # Web dashboard
│   ├── frontend/         # React dashboard UI
│   └── backend/          # Python FastAPI backend
└── tests/                # Test files
```

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.10+
- Chrome or Chromium browser

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/vibe2ship.git
cd vibe2ship
```

2. Install dependencies
```bash
pnpm install
```

3. Set up environment variables
```bash
cp .example.env .env
```

4. Build the extension
```bash
pnpm build
```

### Development

1. Start the development build with HMR:
```bash
pnpm dev
```

2. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

3. For the dashboard backend:
```bash
cd Dashboard/backend
pip install -r requirements.txt
python main.py
```

4. For the dashboard frontend:
```bash
cd Dashboard/frontend
npm install
npm run dev
```

## Available Scripts

- `pnpm dev` - Start development mode with HMR
- `pnpm build` - Build for production
- `pnpm lint` - Run ESLint
- `pnpm test` - Run tests

## Configuration

### Chrome Extension

- Manifest: `chrome-extension/manifest.ts`
- Background script: `chrome-extension/src/background/`
- Content scripts: `pages/content/`

### Environment Variables

See `.example.env` for available environment variables.

For Google Calendar sync (`Dashboard/backend/calendar_sync.py`), set in `Dashboard/.env`:
- `GOOGLE_OAUTH_CLIENT_ID` — defaults to the same client id used for sign-in
- `GOOGLE_OAUTH_CLIENT_SECRET` — required; create a Web application OAuth client in Google Cloud Console with the `https://www.googleapis.com/auth/calendar.events` scope enabled

## Acknowledgments

This project is built on top of the excellent [chrome-extension-boilerplate-react-vite](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite) starter template by [Seo Jong Hak](https://github.com/Jonghakseo), which provides a solid foundation for Chrome Extension development with React, TypeScript, and Vite.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
