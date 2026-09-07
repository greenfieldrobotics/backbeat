// Lets a page take temporary ownership of the scan stream instead of the default
// "navigate to /a/:serial" behaviour that GlobalScanListener otherwise applies to every
// sentinel-prefixed scan (G4.2). Multi-step scan flows — scan-to-locate (G3.3),
// two-scan linking (G5.2) — need a scan to feed whichever step is currently active
// instead of leaving the page, and that has to be arbitrated somewhere both flows and
// the root listener can see it.
//
// A plain module-level singleton, not React context: there is at most one physical
// scanner and one page claiming it at a time, and GlobalScanListener is mounted once at
// the root regardless of where in the tree the claiming page lives — a singleton is the
// simplest thing that lets it ask "is anyone claiming scans right now?" without
// threading a provider through the whole app. Lives in core (not Gear) for the same
// reason the listener itself does: Stash's receiving/picking flows will want this too.
type ScanClaimHandler = (value: string) => void;

let activeHandler: ScanClaimHandler | null = null;

/**
 * Claim the scan stream. Returns a release function — call it (e.g. from a `useEffect`
 * cleanup) when the claiming step/page is done, so scans fall back to the default
 * navigate-to-asset behaviour. Safe to call release more than once, and safe if a later
 * claim has already replaced this one (release is a no-op unless this handler is still
 * the active one).
 */
export function claimScans(handler: ScanClaimHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

/** Called by GlobalScanListener. Returns true if a claim consumed the scan (so the
 * listener should not also navigate). */
export function dispatchClaimedScan(value: string): boolean {
  if (activeHandler) {
    activeHandler(value);
    return true;
  }
  return false;
}
