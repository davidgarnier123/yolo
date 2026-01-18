import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Augmente la limite pour le WASM (ONNX)
      workbox: {
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024 // 30 Mo
      },
      manifest: {
        name: 'AI HYPER SCAN',
        short_name: 'Scanner',
        description: 'Scanner de codes-barres avec IA',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      }
    })
  ],
  // Optionnel : désactiver l’avertissement de taille de chunk Vite
  build: {
    chunkSizeWarningLimit: 2000, // en ko, ici 2000 ko = 2 Mo (ajuste à ta préférence)
  }
})
