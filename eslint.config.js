import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // __APP_VERSION__ is substituted at build time by vite.config.js `define`,
      // so it never exists as a real binding for eslint to resolve.
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Build-time config runs under Node, not the browser — `process` etc.
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Import direction is one-way: App.jsx → lib/* and App.jsx → Charts.jsx.
    // The reverse is circular AND drags the whole app into the lazily-loaded
    // chart chunk, undoing the ~300kB code split (see ARCHITECTURE.md). This
    // was convention enforced by comments; now the linter holds the line.
    files: ['src/lib/**/*.{js,jsx}', 'src/Charts.jsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/App', '**/App.jsx', '../App', '../App.jsx', './App', './App.jsx'],
          message: 'lib/* and Charts.jsx must never import App.jsx — circular, and it defeats the chart code split. Move shared code into lib/.',
        }],
      }],
    },
  },
])
