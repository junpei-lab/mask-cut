import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: false,
  dts: false,
  splitting: false,
  noExternal: ['@mask-cut/text-llm-core'],
});
