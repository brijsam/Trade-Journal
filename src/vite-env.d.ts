/// <reference types="vite/client" />

// Injected by vite.config.js's `define` from package.json's version at build
// time (see RELEASING.md) — never a real binding, hence the ambient
// declaration rather than an import. Also declared as an eslint global in
// eslint.config.js for the same reason.
declare const __APP_VERSION__: string;
