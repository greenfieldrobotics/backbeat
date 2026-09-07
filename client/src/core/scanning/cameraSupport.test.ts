import { describe, it, expect } from 'vitest';
import { getCameraScanSupport } from './cameraSupport';

describe('getCameraScanSupport', () => {
  it('is ready on a secure context with a camera API', () => {
    const result = getCameraScanSupport(
      { isSecureContext: true },
      { mediaDevices: { getUserMedia: () => Promise.resolve() } }
    );
    expect(result).toEqual({ ready: true });
  });

  it('reports an insecure context rather than a generic failure', () => {
    const result = getCameraScanSupport(
      { isSecureContext: false },
      { mediaDevices: { getUserMedia: () => Promise.resolve() } }
    );
    expect(result).toEqual({ ready: false, reason: 'insecure-context' });
  });

  it('reports a missing camera API on an otherwise-secure context', () => {
    const result = getCameraScanSupport({ isSecureContext: true }, {});
    expect(result).toEqual({ ready: false, reason: 'no-camera-api' });
  });
});
