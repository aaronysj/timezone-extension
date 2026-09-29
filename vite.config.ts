import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome125',
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    modulePreload: false,
    rolldownOptions: {
      input: {
        background: 'src/background/index.ts',
        popup: 'popup.html',
        options: 'options.html',
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
}));
