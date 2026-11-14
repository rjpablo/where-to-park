// Copies maplibre-gl's standalone worker into public/ for the web map (see Map.web.tsx).
const fs = require('fs');
const path = require('path');
const src = path.join(
  __dirname,
  '..',
  'node_modules',
  'maplibre-gl',
  'dist',
  'maplibre-gl-csp-worker.js'
);
const destDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(src)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, 'maplibre-gl-csp-worker.js'));
}
