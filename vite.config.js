import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/Metra/',
  plugins: [react()],
  server: {
    allowedHosts: ['localhost', '127.0.0.1', 'ff00f61a11ac.ngrok.app']
  }
})
