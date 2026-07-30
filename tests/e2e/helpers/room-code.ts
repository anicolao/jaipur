const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function e2eRoomCode(label: string): string {
  let hash = 2166136261;
  for (const character of label) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  let code = '';
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[(hash >>> (index * 5)) % alphabet.length];
  }
  return code;
}
