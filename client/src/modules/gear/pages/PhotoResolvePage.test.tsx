import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PhotoResolvePage from './PhotoResolvePage';

// analyzePhoto() wraps createImageBitmap/crypto.subtle/the wasm decoder/EXIF parsing —
// none of which jsdom implements — so it's mocked as a whole, the same way ScanPage's
// camera path has no test at all (see handoff/phase-11-response.md). This suite covers
// everything downstream of that analysis: asset resolution, the occurred_at form, and
// rendering the duplicate vs. new-event result.
vi.mock('../photoResolve', () => ({
  analyzePhoto: vi.fn(),
}));

vi.mock('../api', () => ({
  gearApi: {
    getAssetBySerial: vi.fn(),
    resolvePhotoScan: vi.fn(),
  },
}));

import { analyzePhoto } from '../photoResolve';
import { gearApi } from '../api';

const ASSET = {
  id: 7,
  serial_number: 'ROBOT-PHOTO-1',
  asset_type_id: 1,
  asset_type_name: 'Robot',
  lifecycle_state_id: 1,
  lifecycle_state_name: 'Available',
  location_id: null,
  location_name: null,
  owner_party_name: null,
  custodian_party_name: null,
  notes: null,
};

function pickFile() {
  const input = screen.getByLabelText('Photo') as HTMLInputElement;
  const file = new File(['fake-image-bytes'], 'label.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('PhotoResolvePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a decoded photo with an EXIF timestamp and submits without asking the user for a date', async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({
      serial: 'ROBOT-PHOTO-1',
      clientKey: 'hash-abc',
      takenAt: '2026-08-01T14:00:00.000Z',
    });
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: true, data: ASSET });
    vi.mocked(gearApi.resolvePhotoScan).mockResolvedValue({
      ok: true,
      data: { asset: ASSET, event: { id: 1, event_type: 'photo_scan', occurred_at: '2026-08-01T14:00:00.000Z', from_value: null, to_value: null, location_name: null, notes: null }, duplicate: false },
    });

    render(<PhotoResolvePage />);
    pickFile();

    await screen.findByText(/ROBOT-PHOTO-1/);
    expect(screen.getByText(/from the photo's EXIF data/)).toBeTruthy();
    expect(screen.queryByLabelText(/When was this photo taken/)).toBeNull();

    fireEvent.click(screen.getByText('Resolve'));

    await waitFor(() => expect(gearApi.resolvePhotoScan).toHaveBeenCalledWith({
      serial: 'ROBOT-PHOTO-1',
      occurred_at: '2026-08-01T14:00:00.000Z',
      client_key: 'hash-abc',
    }));
    expect(await screen.findByText('Recorded.')).toBeTruthy();
  });

  it('asks the user for a date when the photo has no EXIF timestamp, and omits occurred_at if left blank', async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({
      serial: 'ROBOT-PHOTO-1',
      clientKey: 'hash-def',
      takenAt: null,
    });
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: true, data: ASSET });
    vi.mocked(gearApi.resolvePhotoScan).mockResolvedValue({
      ok: true,
      data: { asset: ASSET, event: { id: 2, event_type: 'photo_scan', occurred_at: '2026-09-07T00:00:00.000Z', from_value: null, to_value: null, location_name: null, notes: null }, duplicate: false },
    });

    render(<PhotoResolvePage />);
    pickFile();

    await screen.findByLabelText(/When was this photo taken/);
    fireEvent.click(screen.getByText('Resolve'));

    await waitFor(() => expect(gearApi.resolvePhotoScan).toHaveBeenCalledWith({
      serial: 'ROBOT-PHOTO-1',
      occurred_at: null,
      client_key: 'hash-def',
    }));
  });

  it('shows a duplicate result without treating it as an error', async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({
      serial: 'ROBOT-PHOTO-1',
      clientKey: 'hash-ghi',
      takenAt: '2026-08-01T14:00:00.000Z',
    });
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: true, data: ASSET });
    vi.mocked(gearApi.resolvePhotoScan).mockResolvedValue({
      ok: true,
      data: { asset: ASSET, event: { id: 1, event_type: 'photo_scan', occurred_at: '2026-08-01T14:00:00.000Z', from_value: null, to_value: null, location_name: null, notes: null }, duplicate: true },
    });

    render(<PhotoResolvePage />);
    pickFile();
    await screen.findByText(/ROBOT-PHOTO-1/);
    fireEvent.click(screen.getByText('Resolve'));

    expect(await screen.findByText(/Already recorded/)).toBeTruthy();
  });

  it('shows an error when the photo decodes to no recognizable code', async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({ serial: null, clientKey: 'hash-jkl', takenAt: null });

    render(<PhotoResolvePage />);
    pickFile();

    expect(await screen.findByText(/No QR or DataMatrix code was found/)).toBeTruthy();
    expect(gearApi.getAssetBySerial).not.toHaveBeenCalled();
  });

  it('shows an error when the decoded serial matches no asset', async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({ serial: 'UNKNOWN-1', clientKey: 'hash-mno', takenAt: null });
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    render(<PhotoResolvePage />);
    pickFile();

    expect(await screen.findByText(/No asset is registered with serial/)).toBeTruthy();
    expect(screen.getByText('UNKNOWN-1')).toBeTruthy();
  });
});
