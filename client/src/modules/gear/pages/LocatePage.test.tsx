import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import LocatePage from './LocatePage';

vi.mock('../api', () => ({
  gearApi: {
    getAssetBySerial: vi.fn(),
    moveAsset: vi.fn(),
  },
}));

vi.mock('../../../core/api', () => ({
  api: {
    getLocations: vi.fn(),
  },
}));

import { gearApi } from '../api';
import { api } from '../../../core/api';

const ASSET = {
  id: 5,
  serial_number: 'ROBOT-001',
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

function fillAndSubmit(placeholder: string, value: string) {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
}

describe('LocatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getLocations).mockResolvedValue([{ id: 1, name: 'Warehouse A' }]);
  });

  it('scans an asset then a location and moves the asset (G3.3)', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: true, data: ASSET });
    vi.mocked(gearApi.moveAsset).mockResolvedValue({
      ok: true,
      data: { ...ASSET, location_id: 1, location_name: 'Warehouse A' },
    });

    render(<LocatePage />);
    await waitFor(() => expect(api.getLocations).toHaveBeenCalled());

    fillAndSubmit('Asset serial', 'ROBOT-001');
    expect(await screen.findByText(/ROBOT-001/)).toBeTruthy();
    expect(gearApi.getAssetBySerial).toHaveBeenCalledWith('ROBOT-001');

    await screen.findByPlaceholderText('Location name');
    fillAndSubmit('Location name', 'Warehouse A');

    await waitFor(() => expect(gearApi.moveAsset).toHaveBeenCalledWith(5, 1));
    expect(await screen.findByText(/Moved/)).toBeTruthy();
  });

  it('shows an error for an unknown asset serial and does not advance', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    render(<LocatePage />);
    fillAndSubmit('Asset serial', 'NOPE');

    expect(await screen.findByText(/No asset found/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Asset serial')).toBeTruthy();
  });

  it('shows an error for a location that does not match any known location', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: true, data: ASSET });

    render(<LocatePage />);
    await waitFor(() => expect(api.getLocations).toHaveBeenCalled());
    fillAndSubmit('Asset serial', 'ROBOT-001');
    await screen.findByPlaceholderText('Location name');

    fillAndSubmit('Location name', 'Nonexistent Place');

    expect(await screen.findByText(/No location matches/)).toBeTruthy();
    expect(gearApi.moveAsset).not.toHaveBeenCalled();
  });
});
