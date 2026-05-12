import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/cli/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/cli/prompt-registry-bundle.js',
  format: 'cjs',
  external: [],
  minify: true,
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  sourcemap: false,
  treeShaking: true,
  metafile: true,
});
