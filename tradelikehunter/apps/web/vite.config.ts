import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tlh/domain': r('../../packages/domain/src/index.ts'),
      '@tlh/ui': r('../../packages/ui/src/index.ts'),
      '@tlh/contracts': r('../../packages/contracts/src/index.ts'),
      '@': r('./src'),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
