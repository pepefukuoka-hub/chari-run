// src/template.html に CSS と JS を埋め込み、docs/index.html（1ファイル）を生成する
// JS は src/js/*.js をファイル名の順に連結し、1つの即時関数に包む
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const dir = new URL('./src/js/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const body = files
  .map((f) => `// ===== ${f} =====\n` + readFileSync(new URL(f, dir), 'utf8'))
  .join('\n');
const js = `(() => {\n'use strict';\n${body}\n})();`;

const template = readFileSync(new URL('./src/template.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./src/style.css', import.meta.url), 'utf8');
const html = template.replace('%%CSS%%', () => css).replace('%%JS%%', () => js);

mkdirSync(new URL('./docs', import.meta.url), { recursive: true });
writeFileSync(new URL('./docs/index.html', import.meta.url), html);
console.log(`built docs/index.html (${html.length} bytes, ${files.length} files)`);
