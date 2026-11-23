// Gera public/index.html a partir de src/index.html, embutindo o CSS do Tailwind (v4) compilado.
// Uso:  npm install   (instala o tailwindcss)   e depois   npm run build
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const twDir = process.env.TAILWIND_DIR || path.dirname(require.resolve('tailwindcss/package.json'));
const { compile } = await import(pathToFileURL(path.join(twDir, 'dist', 'lib.mjs')).href);

const entrada = `
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@theme {
  --font-mono: ui-monospace, Menlo, Consolas, monospace;
  --animate-subir: subir .55s cubic-bezier(.22,1,.36,1) both;
  --animate-caminhao: caminhao 1.9s ease-in-out infinite;
  --animate-pulso: pulso 1.8s ease-out infinite;
  --animate-brilho: brilho .9s ease-out 2;
  @keyframes subir { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes caminhao {
    0% { left: 4%; opacity: 0; } 12% { opacity: 1; } 50% { transform: translateY(-2px); }
    88% { opacity: 1; } 100% { left: calc(96% - 34px); opacity: 0; }
  }
  @keyframes pulso { 0%, 100% { box-shadow: 0 0 0 0 rgba(229,0,126,.45); } 50% { box-shadow: 0 0 0 8px rgba(229,0,126,0); } }
  @keyframes brilho { from { box-shadow: 0 0 0 0 rgba(229,0,126,.55); } to { box-shadow: 0 0 0 10px rgba(229,0,126,0); } }
}`;

const tw = await compile(entrada, {
  base: twDir,
  loadStylesheet: async (id) => {
    const p = path.join(twDir, id.replace(/^tailwindcss\//, ''));
    return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
  }
});

const html = fs.readFileSync(path.join(raiz, 'src', 'index.html'), 'utf8');
const candidatos = new Set(html.split(/[\s"'`<>{}=;]+/).filter(t => t && t.length < 120));
const css = tw.build([...candidatos]);
const saida = html.replace('/*__TAILWIND__*/', () => css);
fs.mkdirSync(path.join(raiz, 'public'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'public', 'index.html'), saida);
console.log(`public/index.html gerado · Tailwind ${(css.length / 1024).toFixed(1)} KB`);
