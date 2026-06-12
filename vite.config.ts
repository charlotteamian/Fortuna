import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Quote APIs have no CORS headers; in the Capacitor app we use native HTTP,
      // in the dev browser we go through these proxies instead.
      '/qt-api': { target: 'https://qt.gtimg.cn', changeOrigin: true, rewrite: p => p.replace(/^\/qt-api/, '') },
      '/fund-api': { target: 'https://fundgz.1234567.com.cn', changeOrigin: true, rewrite: p => p.replace(/^\/fund-api/, '') },
    },
  },
})
