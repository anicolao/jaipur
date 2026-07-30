import { describe, expect, it } from 'vitest';
import { readFirebaseConfig } from './firebase-config';

const complete = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'example',
  VITE_FIREBASE_STORAGE_BUCKET: 'example.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: 'app'
};

describe('readFirebaseConfig', () => {
  it('maps the public Vite environment', () => {
    expect(readFirebaseConfig(complete).projectId).toBe('example');
  });

  it('reports every missing variable', () => {
    expect(() => readFirebaseConfig({})).toThrow('VITE_FIREBASE_API_KEY');
  });
});
