/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Chemin de base configurable (ex. "/calendrier-dividendes/finances/" pour GitHub Pages).
  base: process.env.VITE_BASE_PATH ?? '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Le SDK Firestore (avec cache hors-ligne) pèse ~190 ko gzip à lui seul.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Firebase dans son propre fichier : mis en cache une fois, indépendamment du code de l'app.
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Foyer — Finances familiales',
        short_name: 'Foyer',
        description: 'Votre directeur financier personnel : revenus, dépenses, épargne, dettes et patrimoine du foyer.',
        lang: 'fr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#070a12',
        theme_color: '#070a12',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Seules les polices latines sont mises en cache hors-ligne. Les
        // fichiers du moteur OCR (~8 Mo) ne sont volontairement pas
        // pré-mis en cache à l'installation : ils ne sont téléchargés
        // qu'au premier scan de ticket (voir runtimeCaching ci-dessous).
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2', 'worker.min.js', 'tesseract-core/**', 'tesseract-lang/**'],
        navigateFallback: 'index.html',
        // Les données Firestore ont leur propre cache hors-ligne (IndexedDB) :
        // le service worker ne met en cache que la coquille de l'application.
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [
          {
            // Fichiers immuables (nommés par version) : une fois téléchargés,
            // jamais re-demandés au réseau.
            urlPattern: /\/(worker\.min\.js|tesseract-core\/.*|tesseract-lang\/.*)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-engine',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
