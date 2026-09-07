import { describe, it, expect, vi } from 'vitest';
import { claimScans, dispatchClaimedScan } from './scanClaim';

describe('scanClaim', () => {
  it('dispatches to no one when nothing has claimed the scan stream', () => {
    expect(dispatchClaimedScan('ABC-123')).toBe(false);
  });

  it('routes a scan to the active claim instead of the default behaviour', () => {
    const handler = vi.fn();
    claimScans(handler);

    const consumed = dispatchClaimedScan('ABC-123');

    expect(consumed).toBe(true);
    expect(handler).toHaveBeenCalledWith('ABC-123');
  });

  it('falls back to unclaimed once the claim is released', () => {
    const handler = vi.fn();
    const release = claimScans(handler);

    release();

    expect(dispatchClaimedScan('ABC-123')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a later claim replaces an earlier one', () => {
    const first = vi.fn();
    const second = vi.fn();
    claimScans(first);
    claimScans(second);

    dispatchClaimedScan('ABC-123');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('ABC-123');
  });

  it("releasing a claim that has already been replaced does not clear the new one", () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = claimScans(first);
    claimScans(second);

    releaseFirst();
    dispatchClaimedScan('ABC-123');

    expect(second).toHaveBeenCalledWith('ABC-123');
  });
});
