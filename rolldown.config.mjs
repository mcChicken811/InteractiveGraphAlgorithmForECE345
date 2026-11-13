// Bundles the app (src/main.ts and everything it imports) into one classic script,
// build/app.js, which index.html loads. A classic script also runs when index.html is
// opened straight from disk (file://), where browsers refuse ES modules. Rolldown strips
// the TypeScript types; `tsc -p tsconfig.build.json` type-checks first (see package.json).
// `npm run build` (once) / `npm run dev` (on every change)
export default {
  input: 'src/main.ts',
  output: { file: 'build/app.js', format: 'iife', sourcemap: true },
};
