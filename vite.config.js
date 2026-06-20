import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // relative base so the build works on GitHub Pages project sites
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5200, host: true },
})
