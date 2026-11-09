// src/template.html に CSS と JS を埋め込み、docs/index.html（1ファイル）を生成する
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const template = readFileSync(new URL('./src/template.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./src/style.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');

const html = template
  .replace('%%CSS%%', () => css)
  .replace('%%JS%%', () => js);

mkdirSync(new URL('./docs', import.meta.url), { recursive: true });
writeFileSync(new URL('./docs/index.html', import.meta.url), html);
console.log(`built docs/index.html (${html.length} bytes)`);
