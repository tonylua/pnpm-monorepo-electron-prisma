import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'

const emptyModulePlugin: Plugin = {
  name: 'vite-plugin-empty-module',
  resolveId(id) {
    if (id.startsWith('@main/')) {
      return id; // 返回 id 以确保后续处理
    }
  },
  load(id) {
    if (id.startsWith('@main/')) {
      return 'export default {}'; // 返回空对象
    }
  }
};

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve('src'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  define: {
    __ELECTRON__: false,
    __WEB__: true
  },
  css: {
    preprocessorOptions: {
      less: {
        charset: false,
      }
    }
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html')
    }
  },
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'vue-router'],
      dts: 'src/auto-import.d.ts'
    }),
    Components({
    }),
    emptyModulePlugin 
  ]
})
