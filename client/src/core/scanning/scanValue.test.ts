import { describe, it, expect } from 'vitest';
import { extractSerialFromScan } from './scanValue';

describe('extractSerialFromScan', () => {
  it('returns a bare serial unchanged', () => {
    expect(extractSerialFromScan('ABC-123')).toBe('ABC-123');
  });

  it('trims surrounding whitespace', () => {
    expect(extractSerialFromScan('  ABC-123  ')).toBe('ABC-123');
  });

  it('extracts the serial from a full label URL', () => {
    expect(extractSerialFromScan('https://backbeat.example/a/ABC-123')).toBe('ABC-123');
  });

  it('extracts the serial from a label URL with a trailing slash', () => {
    expect(extractSerialFromScan('https://backbeat.example/a/ABC-123/')).toBe('ABC-123');
  });

  it('decodes a URL-encoded serial', () => {
    expect(extractSerialFromScan('https://backbeat.example/a/ABC%20123')).toBe('ABC 123');
  });
});
