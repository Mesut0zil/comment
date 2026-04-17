import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/api/index.ts', 'src/react/index.tsx'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    external: ['react', 'react-dom', 'knex'],
});
