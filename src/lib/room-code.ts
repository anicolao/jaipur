export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type RandomBytes = (length: number) => Uint8Array;

const browserRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

export function generateRoomCode(randomBytes: RandomBytes = browserRandomBytes): string {
  let code = '';
  const unbiasedLimit =
    Math.floor(256 / ROOM_CODE_ALPHABET.length) * ROOM_CODE_ALPHABET.length;

  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of randomBytes(ROOM_CODE_LENGTH - code.length)) {
      if (byte >= unbiasedLimit) continue;
      code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      if (code.length === ROOM_CODE_LENGTH) break;
    }
  }

  return code;
}

export function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(value: string): boolean {
  return new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`).test(value);
}
