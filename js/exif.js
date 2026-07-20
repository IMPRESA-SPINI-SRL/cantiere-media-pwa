const JPEG_SOI = 0xffd8;
const APP1 = 0xe1;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME = 0x0132;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;

function inBounds(view, offset, length = 1) {
  return offset >= 0 && offset + length <= view.byteLength;
}

function readAscii(view, offset, length) {
  if (!inBounds(view, offset, length)) return '';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    const code = view.getUint8(offset + index);
    if (code === 0) break;
    value += String.fromCharCode(code);
  }
  return value;
}

function parseExifDate(value) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
    return null;
  }
  return date.getTime();
}

function readIfdDate(view, tiffStart, ifdOffset, littleEndian) {
  const absoluteIfd = tiffStart + ifdOffset;
  if (!inBounds(view, absoluteIfd, 2)) return { date: null, exifIfdOffset: null };

  const entryCount = view.getUint16(absoluteIfd, littleEndian);
  let exifIfdOffset = null;
  let fallbackDate = null;

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = absoluteIfd + 2 + index * 12;
    if (!inBounds(view, entryOffset, 12)) break;

    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffsetField = entryOffset + 8;

    if (tag === TAG_EXIF_IFD && type === 4 && count === 1) {
      exifIfdOffset = view.getUint32(valueOffsetField, littleEndian);
      continue;
    }

    if (tag !== TAG_DATE_TIME && tag !== TAG_DATE_TIME_ORIGINAL && tag !== TAG_DATE_TIME_DIGITIZED) {
      continue;
    }

    if (type !== 2 || count < 19 || count > 64) continue;
    const dataOffset = count <= 4
      ? valueOffsetField
      : tiffStart + view.getUint32(valueOffsetField, littleEndian);
    const parsed = parseExifDate(readAscii(view, dataOffset, count));
    if (!parsed) continue;

    if (tag === TAG_DATE_TIME_ORIGINAL) return { date: parsed, exifIfdOffset };
    if (tag === TAG_DATE_TIME_DIGITIZED && !fallbackDate) fallbackDate = parsed;
    if (tag === TAG_DATE_TIME && !fallbackDate) fallbackDate = parsed;
  }

  return { date: fallbackDate, exifIfdOffset };
}

function parseTiff(view, tiffStart) {
  if (!inBounds(view, tiffStart, 8)) return null;
  const byteOrder = readAscii(view, tiffStart, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return null;
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0 = readIfdDate(view, tiffStart, ifd0Offset, littleEndian);

  if (ifd0.exifIfdOffset != null) {
    const exif = readIfdDate(view, tiffStart, ifd0.exifIfdOffset, littleEndian);
    if (exif.date) return exif.date;
  }
  return ifd0.date;
}

export function readExifDateFromArrayBuffer(buffer) {
  const view = new DataView(buffer);
  if (!inBounds(view, 0, 4) || view.getUint16(0) !== JPEG_SOI) return null;

  let offset = 2;
  while (inBounds(view, offset, 4)) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    offset += 2;

    if (marker === 0xda || marker === 0xd9) break;
    if (!inBounds(view, offset, 2)) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || !inBounds(view, offset, segmentLength)) break;

    if (marker === APP1 && segmentLength >= 8) {
      const signature = readAscii(view, offset + 2, 4);
      const hasNullSuffix = inBounds(view, offset + 6, 2)
        && view.getUint16(offset + 6) === 0;
      if (signature === 'Exif' && hasNullSuffix) {
        return parseTiff(view, offset + 8);
      }
    }
    offset += segmentLength;
  }
  return null;
}

export async function readExifDate(file) {
  if (!file || !/image\/jpe?g/i.test(file.type || file.name)) return null;
  const maxBytes = Math.min(file.size, 2 * 1024 * 1024);
  const buffer = await file.slice(0, maxBytes).arrayBuffer();
  return readExifDateFromArrayBuffer(buffer);
}
