'use strict';

/**
 * Genereert placeholder-iconen voor de PWA (public/icon-192.png en 512.png).
 * Pure Node stdlib (zlib) — geen extra deps. Handmatig PNG-bytes samenstellen.
 * Draaien: node scripts/gen-icons.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// PNG-signature en CRC32 (IEEE 802.3 polynoom).
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Tekent een gevulde cirkel met anti-alias-loze pixel-check.
function isInCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Tekent een simpele "J": verticale streep + gebogen voetje.
function isInJ(x, y, size) {
  const strokeW = Math.round(size * 0.11);
  const stemX = Math.round(size * 0.60);
  const stemTop = Math.round(size * 0.22);
  const stemBottom = Math.round(size * 0.66);
  const footCy = Math.round(size * 0.66);
  const footCx = Math.round(size * 0.44);
  const footR = Math.round(size * 0.16);
  const inStem = x >= stemX - strokeW / 2 && x <= stemX + strokeW / 2 && y >= stemTop && y <= stemBottom;
  // Onderste halve cirkel (open aan de bovenkant).
  const d = Math.hypot(x - footCx, y - footCy);
  const inCurve = d >= footR - strokeW / 2 && d <= footR + strokeW / 2 && y >= footCy;
  return inStem || inCurve;
}

function makeIcon(size) {
  // Kleuren: --accent uit styles.css (#2563eb) en wit voor de "J".
  const BG = [0x25, 0x63, 0xeb];
  const FG = [0xff, 0xff, 0xff];

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter "None"
    for (let x = 0; x < size; x++) {
      const p = y * rowLen + 1 + x * 3;
      const color = isInJ(x, y, size) ? FG : BG;
      raw[p] = color[0];
      raw[p + 1] = color[1];
      raw[p + 2] = color[2];
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makeIcon(512));
console.log('icoontjes geschreven naar public/icon-192.png en icon-512.png');
