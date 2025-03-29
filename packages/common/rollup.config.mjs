import fs from 'node:fs';
import path from 'node:path';
import commonjs from '@rollup/plugin-commonjs';
import plugin_json from '@rollup/plugin-json';
import node_resolve from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';

export default {
  input: 'src/facade.js',
  output: {
    file: 'dist/index.js',
    format: 'cjs'
  },
  plugins: [
    plugin_json(),
    node_resolve(),
    commonjs({
    }),
    copy({
      targets: [
        { src: 'src/prisma/.env.dev', dest: 'dist' },
        { src: 'src/prisma/.env', dest: 'dist' },
        { src: 'src/storage/models/*', dest: 'dist/storage/models' },
        { src: 'src/prisma/**/*', dest: 'dist' },
      ],
      flatten: true 
    }),
    copy({
      targets: [
        { src: 'src/**/*.d.ts', dest: 'dist' },
      ],
      flatten: false
    })
  ]
};