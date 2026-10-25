import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Plugin to remove dangling sourceMappingURL comments from vendor assets (e.g. maplibre-gl-worker)
// that cause 404 warnings in browser Developer Resources
function removeSourceMappingURLPlugin() {
  return {
    name: 'remove-sourcemap-url',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'asset' && typeof asset.source === 'string') {
          asset.source = asset.source.replace(/\/\/# sourceMappingURL=.*$/gm, '');
        } else if (asset.type === 'asset' && asset.source instanceof Uint8Array) {
          const text = new TextDecoder().decode(asset.source);
          if (text.includes('sourceMappingURL=')) {
            const cleaned = text.replace(/\/\/# sourceMappingURL=.*$/gm, '');
            asset.source = new TextEncoder().encode(cleaned);
          }
        }
      }
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    removeSourceMappingURLPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: 'NesterApp',
        short_name: 'NesterApp',
        description: 'Taubennester erfassen und verwalten',
        theme_color: '#3b82f6',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png'
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,mjs}'],
        runtimeCaching: [
          {
            // VersaTiles vector tiles, styles, fonts, sprites
            urlPattern: /^https:\/\/tiles\.versatiles\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'versatiles-vector-cache',
              expiration: {
                maxEntries: 1500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
