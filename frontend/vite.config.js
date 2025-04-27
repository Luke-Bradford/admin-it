import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,   // Important: override 5173 to 3000 if you want
    host: true,
    strictPort: true,
  },
})
