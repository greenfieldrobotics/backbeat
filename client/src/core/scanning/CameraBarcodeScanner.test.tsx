import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CameraBarcodeScanner from './CameraBarcodeScanner';

const originalIsSecureContext = window.isSecureContext;
const originalMediaDevices = navigator.mediaDevices;

afterEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: originalIsSecureContext, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
});

describe('CameraBarcodeScanner', () => {
  it('shows a clear HTTPS message on an insecure context, not a permission error', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    render(<CameraBarcodeScanner onDetect={vi.fn()} />);

    expect(screen.getByText(/needs a secure connection/i)).toBeTruthy();
  });

  it('shows a no-camera-API message when the browser has no mediaDevices support', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });

    render(<CameraBarcodeScanner onDetect={vi.fn()} />);

    expect(screen.getByText(/doesn't support camera access/i)).toBeTruthy();
  });
});
