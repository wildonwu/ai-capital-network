import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => mode === 'single'
  ? { base: './', plugins: [react(), viteSingleFile()], publicDir: false, build: { outDir: 'dist-single', emptyOutDir: true } }
  : { base: './', plugins: [react()] });
