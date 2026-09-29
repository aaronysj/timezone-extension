// Renders one icon per config mode into public/icons/{mode}-{size}.png, plus the SVG sources into assets/.
// off = grey, nothing lit; global = teal, whole globe lit; rules = indigo, a single time-zone band lit.
// Usage: node scripts/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SIZES = [16, 32, 48, 128];
const BAND = 'M50 14A15 36 0 0 1 50 86Z';
const GLOBE = 'M14 50A36 36 0 1 1 86 50A36 36 0 1 1 14 50Z';
const MODES = {
  off: { from: '#b3bbbf', to: '#838c91', lit: '' },
  global: { from: '#1ec6b8', to: '#0b8a82', lit: GLOBE },
  rules: { from: '#8b7cf8', to: '#5a45d6', lit: BAND },
};

const logo = ({ from, to, lit }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round">
    ${lit && `<path d="${lit}" fill="#fff" fill-opacity=".38" stroke="none"/>`}
    <circle cx="50" cy="50" r="36"/>
    <ellipse cx="50" cy="50" rx="15" ry="36"/>
    <path d="M14 50H86"/>
  </g>
  <circle cx="88" cy="88" r="36" fill="url(#bg)"/>
  <circle cx="88" cy="88" r="28" fill="#fff"/>
  <path d="M88 88V70M88 88L101 95" fill="none" stroke="${to}" stroke-width="7" stroke-linecap="round"/>
</svg>
`.replace(/[ \t]+$/gm, '');

fs.mkdirSync(path.join(ROOT, 'public/icons'), { recursive: true });
for (const [mode, palette] of Object.entries(MODES)) {
  const svg = logo(palette);
  fs.writeFileSync(path.join(ROOT, `assets/${mode}.svg`), svg);
  for (const size of SIZES) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
    fs.writeFileSync(path.join(ROOT, `public/icons/${mode}-${size}.png`), png);
  }
}
