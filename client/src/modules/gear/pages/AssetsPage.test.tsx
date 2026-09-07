import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AssetsPage from './AssetsPage';

vi.mock('../api', () => ({
  gearApi: {
    getAssets: vi.fn(),
    getAssetTypes: vi.fn(),
    getLifecycleStates: vi.fn(),
  },
}));

vi.mock('../../../core/api', () => ({
  api: {
    getLocations: vi.fn(),
  },
}));

import { gearApi } from '../api';
import { api } from '../../../core/api';

describe('AssetsPage', () => {
  beforeEach(() => {
    vi.mocked(gearApi.getAssetTypes).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(gearApi.getLifecycleStates).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(api.getLocations).mockResolvedValue([]);
  });

  it('renders assets returned by the typed API', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({
      ok: true,
      data: [
        {
          id: 1,
          serial_number: 'SN-001',
          asset_type_id: 1,
          asset_type_name: 'Robot',
          lifecycle_state_id: 1,
          lifecycle_state_name: 'Available',
          location_id: null,
          location_name: null,
          owner_party_name: null,
          custodian_party_name: null,
          notes: null,
        },
      ],
    });

    render(<AssetsPage />);

    expect(await screen.findByText('SN-001')).toBeTruthy();
    expect(screen.getByText('Robot')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('shows the empty state when there are no assets', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({ ok: true, data: [] });

    render(<AssetsPage />);

    expect(await screen.findByText('No assets yet.')).toBeTruthy();
  });

  it('renders no rows when the typed API call fails, instead of crashing', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({ ok: false, error: 'boom' });

    render(<AssetsPage />);

    await waitFor(() => expect(screen.getByText('No assets yet.')).toBeTruthy());
  });
});
