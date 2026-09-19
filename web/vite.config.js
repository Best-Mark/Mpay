import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * 构建时把仓库根 docs/sdk-node.js 同步到 public/sdk/，
 * 供官网「接入文档」页提供 SDK 下载。单一来源，无需手工复制维护。
 */
function syncOpenSdk() {
  const nodeSdk = fileURLToPath(new URL('../docs/sdk-node.js', import.meta.url));
  const sdkDir = fileURLToPath(new URL('../docs/sdk', import.meta.url));
  const destDir = fileURLToPath(new URL('./public/sdk', import.meta.url));
  return {
    name: 'sync-open-sdk',
    buildStart() {
      fs.mkdirSync(destDir, { recursive: true });
      if (fs.existsSync(nodeSdk)) {
        fs.copyFileSync(nodeSdk, path.join(destDir, 'pay-sdk-node.js'));
      }
      if (fs.existsSync(sdkDir)) {
        for (const file of fs.readdirSync(sdkDir)) {
          const from = path.join(sdkDir, file);
          if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(destDir, file));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), syncOpenSdk()],
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
