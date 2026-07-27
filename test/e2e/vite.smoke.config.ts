import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  resolve: {
    alias: {
      '@client': path.resolve(__dirname, '../../client'),
      '@shared': path.resolve(__dirname, '../../shared'),
      '@': path.resolve(__dirname, '../../client/src'),
    },
  },
})
