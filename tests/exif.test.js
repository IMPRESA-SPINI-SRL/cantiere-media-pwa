import test from 'node:test';
import assert from 'node:assert/strict';
import { readExifDateFromArrayBuffer } from '../js/exif.js';

function syntheticExifJpeg(dateText) {
  const encoder = new TextEncoder();
  const dateBytes = encoder.encode(`${dateText}\0`);
  const tiff = new Uint8Array(44 + dateBytes.length);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 0x9003, true);
  view.setUint16(30, 2, true);
  view.setUint32(32, dateBytes.length, true);
  view.setUint32(36, 44, true);
  view.setUint32(40, 0, true);
  tiff.set(dateBytes, 44);

  const payloadLength = 6 + tiff.length;
  const segmentLength = payloadLength + 2;
  const jpeg = new Uint8Array(2 + 2 + 2 + payloadLength + 2);
  let offset = 0;
  jpeg.set([0xff, 0xd8, 0xff, 0xe1], offset);
  offset += 4;
  jpeg[offset] = (segmentLength >> 8) & 0xff;
  jpeg[offset + 1] = segmentLength & 0xff;
  offset += 2;
  jpeg.set([0x45, 0x78, 0x69, 0x66, 0, 0], offset);
  offset += 6;
  jpeg.set(tiff, offset);
  offset += tiff.length;
  jpeg.set([0xff, 0xd9], offset);
  return jpeg.buffer;
}

test('EXIF DateTimeOriginal has priority and is parsed as local time', () => {
  const actual = readExifDateFromArrayBuffer(syntheticExifJpeg('2024:01:02 03:04:05'));
  const expected = new Date(2024, 0, 2, 3, 4, 5, 0).getTime();
  assert.equal(actual, expected);
});

test('a non-JPEG buffer returns null', () => {
  assert.equal(readExifDateFromArrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer), null);
});

test('invalid EXIF calendar values are rejected instead of normalized', () => {
  assert.equal(readExifDateFromArrayBuffer(syntheticExifJpeg('2024:02:31 03:04:05')), null);
});
