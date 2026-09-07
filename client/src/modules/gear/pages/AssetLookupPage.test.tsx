import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AssetLookupPage from './AssetLookupPage';

vi.mock('../api', () => ({
  gearApi: {
    getAssetBySerial: vi.fn(),
  },
}));

import { gearApi } from '../api';

function renderAtSerial(serial: string) {
  return render(
    <MemoryRouter initialEntries={[`/a/${serial}`]}>
      <Routes>
        <Route path="/a/:serial" element={<AssetLookupPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AssetLookupPage', () => {
  it('renders asset details on a successful lookup', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({
      ok: true,
      data: {
        id: 5,
        serial_number: 'SN-100',
        asset_type_id: 1,
        asset_type_name: 'Drone',
        lifecycle_state_id: 1,
        lifecycle_state_name: 'In Use',
        location_id: null,
        location_name: null,
        owner_party_name: null,
        custodian_party_name: null,
        notes: null,
      },
    });

    renderAtSerial('SN-100');

    expect(await screen.findByRole('heading', { name: 'SN-100' })).toBeTruthy();
    expect(screen.getByText('Drone')).toBeTruthy();
    expect(screen.getByText('In Use')).toBeTruthy();
    expect(gearApi.getAssetBySerial).toHaveBeenCalledWith('SN-100');
  });

  it('renders a not-found message for an unknown serial, without crashing', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    renderAtSerial('UNKNOWN');

    expect(await screen.findByText('Asset not found')).toBeTruthy();
  });
});
