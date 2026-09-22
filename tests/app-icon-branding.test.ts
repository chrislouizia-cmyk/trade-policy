import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function pngDimensions(relativePath: string) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('installed app icons use full-resolution, square Trade Police artwork', () => {
  assert.deepEqual(pngDimensions('app/icon.png'), { width: 512, height: 512 });
  assert.deepEqual(pngDimensions('app/apple-icon.png'), { width: 180, height: 180 });
  assert.deepEqual(pngDimensions('public/brand/trade-police-app-icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions('public/brand/trade-police-app-icon-512.png'), { width: 512, height: 512 });
});

test('metadata and manifest expose the refreshed install artwork', () => {
  const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'app/manifest.ts'), 'utf8');

  assert.match(layout, /manifest: '\/manifest\.webmanifest'/);
  assert.match(layout, /sizes: '512x512'/);
  assert.match(layout, /sizes: '180x180'/);
  assert.match(manifest, /short_name: 'Trade Police'/);
  assert.match(manifest, /purpose: 'maskable'/);
  assert.match(manifest, /trade-police-app-icon-512\.png/);
});
