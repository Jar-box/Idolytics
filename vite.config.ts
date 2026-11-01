import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { mediaSyncPlugin } from './scripts/mediaSyncPlugin.ts';
import { workspaceBackupPlugin } from './scripts/workspaceBackupPlugin.ts';

export default defineConfig({
  plugins: [react(), mediaSyncPlugin(), workspaceBackupPlugin()],
  server: {
    port: 3000,
    strictPort: true,
    watch: {
      ignored: ['**/media/**', '**/backups/**'],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'node',
  },
});
