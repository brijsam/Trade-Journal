import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled locally (self-hosted via @fontsource) rather than pulled
// from the Google Fonts CDN. The packaged desktop app runs offline, and a
// remote @import would silently fall back to system fonts with no network —
// losing the whole terminal-desk aesthetic. Vite fingerprints the woff2 files
// into dist/assets, so these ship inside the app. Weights match the families
// used in App.jsx: Inter 400/500/600, Space Grotesk 500/600/700,
// JetBrains Mono 400/500/600/700.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
