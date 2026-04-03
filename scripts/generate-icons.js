/**
 * Generates build/icon.png (512x512) from build/icon.svg.
 * electron-builder converts the PNG to .ico automatically during build.
 *
 * Run once:  node scripts/generate-icons.js
 * Requires:  npm install sharp --save-dev
 */

const sharp = require('sharp');
const path  = require('path');

const src = path.join(__dirname, '../build/icon.svg');
const dst = path.join(__dirname, '../build/icon.png');

sharp(src)
  .resize(512, 512)
  .png()
  .toFile(dst)
  .then(() => console.log('Icon generated →', dst))
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
