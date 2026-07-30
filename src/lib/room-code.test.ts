import { describe, expect, it } from 'vitest';
import {
  generateRoomCode,
  isRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET
} from './room-code';

describe('room codes', () => {
  it('generates five unbiased uppercase letters', () => {
    const batches = [
      Uint8Array.from([0, 25, 26, 51, 233]),
      Uint8Array.from([255, 52])
    ];
    expect(generateRoomCode(() => batches.shift() ?? new Uint8Array())).toBe('AZAZZ');
  });

  it('normalizes pasted codes and removes non-letters', () => {
    expect(normalizeRoomCode(' a1b-c_d!eF ')).toBe('ABCDE');
  });

  it('accepts exactly five ASCII letters', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(26);
    expect(isRoomCode('JAIPR')).toBe(true);
    expect(isRoomCode('J4IPR')).toBe(false);
    expect(isRoomCode('JAIPUR')).toBe(false);
  });
});
