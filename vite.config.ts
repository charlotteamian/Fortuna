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
      // Sina needs a Referer header or it 403s; add it server-side (the browser can't set it).
      '/sina-api': { target: 'https://hq.sinajs.cn', changeOrigin: true, headers: { Referer: 'https://finance.sina.com.cn' }, rewrite: p => p.replace(/^\/sina-api/, '') },
      '/cboe-option-api': { target: 'https://cdn.cboe.com/api/global/delayed_quotes/options', changeOrigin: true, rewrite: p => p.replace(/^\/cboe-option-api/, '') },
    },
  },
})
