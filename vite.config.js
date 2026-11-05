import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()], base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: { supabase: ['@supabase/supabase-js'], motion: ['motion/react'] },
      },
    },
  },
  server: {
    host: '0.0.0.0', port: 5174, strictPort: true,
    fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/server/**', '**/*.test.mjs'] },
  },
});
