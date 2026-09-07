import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import LinkPage from './LinkPage';

vi.mock('../api', () => ({
  gearApi: {
    getAssetBySerial: vi.fn(),
    createLink: vi.fn(),
    closeLink: vi.fn(),
    getAssetLinks: vi.fn(),
  },
}));

import { gearApi } from '../api';

const CHILD = {
  id: 10,
  serial_number: 'BATT-001',
  asset_type_id: 2,
  asset_type_name: 'Battery',
  lifecycle_state_id: 1,
  lifecycle_state_name: 'Available',
  location_id: null,
  location_name: null,
  owner_party_name: null,
  custodian_party_name: null,
  notes: null,
};

const PARENT = {
  id: 20,
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

async function resolveChildThenParent() {
  vi.mocked(gearApi.getAssetBySerial).mockImplementation(serial =>
    Promise.resolve(
      serial === 'BATT-001' ? { ok: true, data: CHILD } : { ok: true, data: PARENT }
    )
  );

  render(<LinkPage />);
  fillAndSubmit('Child serial (e.g. the battery)', 'BATT-001');
  await screen.findByPlaceholderText('Parent serial (e.g. the robot)');
  fillAndSubmit('Parent serial (e.g. the robot)', 'ROBOT-001');
}

describe('LinkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scans a child then a parent and opens a link (G5.2)', async () => {
    vi.mocked(gearApi.createLink).mockResolvedValue({
      ok: true,
      data: { id: 1, parent_asset_id: 20, child_asset_id: 10, link_type: 'installed_in', valid_from: '2026-01-01', valid_to: null } as any,
    });

    await resolveChildThenParent();

    await waitFor(() =>
      expect(gearApi.createLink).toHaveBeenCalledWith({
        parent_asset_id: 20,
        child_asset_id: 10,
        link_type: 'installed_in',
      })
    );
    expect(await screen.findByText(/Linked/)).toBeTruthy();
  });

  it('on a 409 conflict, offers to close the existing link and relink', async () => {
    vi.mocked(gearApi.createLink)
      .mockResolvedValueOnce({ ok: false, error: 'This asset already has an open link', status: 409 })
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 2, parent_asset_id: 20, child_asset_id: 10, link_type: 'installed_in', valid_from: '2026-01-01', valid_to: null } as any,
      });
    vi.mocked(gearApi.getAssetLinks).mockResolvedValue({
      ok: true,
      data: [{ id: 99, parent_asset_id: 5, child_asset_id: 10, link_type: 'installed_in', valid_from: '2025-01-01', valid_to: null } as any],
    });
    vi.mocked(gearApi.closeLink).mockResolvedValue({
      ok: true,
      data: { id: 99, parent_asset_id: 5, child_asset_id: 10, link_type: 'installed_in', valid_from: '2025-01-01', valid_to: '2026-01-01' } as any,
    });

    await resolveChildThenParent();

    const retryButton = await screen.findByRole('button', { name: /close existing link and relink/i });
    fireEvent.click(retryButton);

    await waitFor(() => expect(gearApi.closeLink).toHaveBeenCalledWith(99));
    await waitFor(() => expect(gearApi.createLink).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Linked/)).toBeTruthy();
  });

  it('shows an error for an unknown child serial and does not advance', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    render(<LinkPage />);
    fillAndSubmit('Child serial (e.g. the battery)', 'NOPE');

    expect(await screen.findByText(/No asset found/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Child serial (e.g. the battery)')).toBeTruthy();
  });
});
