import { defineConfig } from 'tsup';

// Subpath entries let the web app import zod-free modules (utils, constants,
// json) without pulling every zod schema into its main chunk.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    types: 'src/types/index.ts',
    utils: 'src/utils/index.ts',
    constants: 'src/constants.ts',
    json: 'src/types/json.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
});
