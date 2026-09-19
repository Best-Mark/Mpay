import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // 相对路径产物：部署在根域名（https://pay.example.com/）或子路径（https://x.com/www/）都能直接跑
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
