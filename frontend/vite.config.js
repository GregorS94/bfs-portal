// Vite statt Create React App. Grund für den Wechsel: react-scripts 5.0.1 ist
// von April 2022 und wird seit Anfang 2025 nicht mehr gepflegt — eine
// Bauwerkzeugkette ohne Sicherheitsfixes ist in einem beaufsichtigten Haus
// ein Prüfungsthema. Am React-Code selbst ändert sich nichts.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Vites Standardport 5173 bleibt, damit er nicht mit dem Backend (3000)
    // kollidiert. Beim Entwickeln zeigt /api auf das Backend, damit der
    // Browser nicht über Ursprünge hinweg reden muss; im Betrieb macht das
    // nginx.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Für die Fehlersuche im Betrieb: ohne Quellkarten ist ein Stapelabbild
    // aus dem gebauten Bündel nicht lesbar.
    sourcemap: true,
  },
});
