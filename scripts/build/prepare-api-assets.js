#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..', '..');

// Python's Vercel builder excludes public/**, even with includeFiles configured.
// Keep the source assets in public/ and stage only the API's dependencies outside it.
const runtimeFiles = [
  'icon-512.png',
  'fonts/PlusJakartaSans-Variable.ttf',
  'fonts/OFL.txt',
  'support_card.json',
  'uma_data.json',
  'career.json',
];

function prepareApiAssets({
  sourceDir = path.join(projectRoot, 'public', 'assets'),
  outputDir = path.join(projectRoot, 'runtime-assets'),
} = {}) {
  // Fail the build before copying if a required source file is missing.
  for (const file of runtimeFiles) {
    const source = path.join(sourceDir, file);
    if (!fs.statSync(source).isFile()) throw new Error(`Missing API asset: ${source}`);
  }

  for (const file of runtimeFiles) {
    const destination = path.join(outputDir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, file), destination);
  }
  console.log(`Staged ${runtimeFiles.length} API assets in ${outputDir}`);
}

if (require.main === module) prepareApiAssets();

module.exports = { prepareApiAssets };
