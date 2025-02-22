import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import {terser} from 'rollup-plugin-terser';
import nodeResolve from '@rollup/plugin-node-resolve';

const extensions = ['.js', '.ts'];

export default {
  input: 'src/index.ts',
  output: {
    file: 'lib/index.iife.min.js',
    format: 'iife',
    name: 'walletStandardVeera',
    sourcemap: true,
    plugins: [terser({mangle: false, compress: false})],
  },
  plugins: [
    commonjs(),
    nodeResolve({
      browser: true,
      dedupe: ['bn.js', 'buffer'],
      extensions,
      preferBuiltins: false,
    }),
    babel({
      exclude: '**/node_modules/**',
      extensions,
      babelHelpers: 'bundled',
      plugins: [],
    }),
  ]
};
