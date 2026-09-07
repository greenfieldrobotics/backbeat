import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useGlobalScanListener } from './useGlobalScanListener';
import { SCAN_SENTINEL } from './sentinelParser';

function TestHarness({ onScan }: { onScan: (serial: string) => void }) {
  useGlobalScanListener(onScan);
  return <input aria-label="serial" />;
}

function typeSequence(target: Element, text: string) {
  for (const char of text) {
    fireEvent.keyDown(target, { key: char });
  }
}

describe('useGlobalScanListener', () => {
  it('fires onScan for a sentinel-prefixed scan typed with no field focused', () => {
    const onScan = vi.fn();
    render(<TestHarness onScan={onScan} />);

    typeSequence(document.body, `${SCAN_SENTINEL}ABC-123`);
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(onScan).toHaveBeenCalledWith('ABC-123');
  });

  it('does not fire for ordinary typing with no field focused', () => {
    const onScan = vi.fn();
    render(<TestHarness onScan={onScan} />);

    typeSequence(document.body, 'just some ordinary keystrokes');
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not hijack the same sentinel sequence typed into a focused input', () => {
    const onScan = vi.fn();
    render(<TestHarness onScan={onScan} />);
    const input = screen.getByLabelText('serial');

    typeSequence(input, `${SCAN_SENTINEL}ABC-123`);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not fire on a partial/interleaved sequence', () => {
    const onScan = vi.fn();
    render(<TestHarness onScan={onScan} />);

    typeSequence(document.body, SCAN_SENTINEL.slice(0, -1));
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(onScan).not.toHaveBeenCalled();
  });
});
