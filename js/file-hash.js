export class FileHashError extends Error {
  constructor(message, code = 'HASH_ERROR') {
    super(message);
    this.name = 'FileHashError';
    this.code = code;
  }
}

export function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256Blob(blob) {
  if (!blob?.arrayBuffer) {
    throw new FileHashError('Il file non puo essere letto.', 'UNREADABLE_FILE');
  }
  if (!globalThis.crypto?.subtle) {
    throw new FileHashError(
      'Controllo duplicati non disponibile. Aprire l\'app tramite HTTPS.',
      'CRYPTO_UNAVAILABLE',
    );
  }

  const data = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}
