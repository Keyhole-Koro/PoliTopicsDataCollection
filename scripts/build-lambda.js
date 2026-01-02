#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function ensureCleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

function main() {
  ensureCleanDist();
  run('npx tsc');
  run('npx tsc-alias -p tsconfig.json');
  copyFile(path.join(root, 'package.json'), path.join(distDir, 'package.json'));
  if (fs.existsSync(path.join(root, 'package-lock.json'))) {
    copyFile(path.join(root, 'package-lock.json'), path.join(distDir, 'package-lock.json'));
  }
  run('npm install --omit=dev', distDir);
}

main();
