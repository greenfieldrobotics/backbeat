// G4.2 — scan from anywhere. A dedicated scanner is programmed to emit a fixed sentinel
// prefix before every scan, and this listener keys off that literal prefix rather than
// any timing heuristic ("keys arrived fast, so it must be a scanner"): timing heuristics
// produce false positives from ordinary fast typing, which would mean a keystroke that
// silently navigates a user away mid-form. Matching only on the sentinel is what makes a
// global keystroke listener safe.
//
// SENTINEL is a placeholder pending the platform owner picking a real value and
// programming it into scanner hardware — see handoff/phase-8-response.md.
export const SCAN_SENTINEL = '~SCAN~';

// Bails out of a runaway capture (e.g. focus never lands on a terminator) rather than
// buffering forever. Comfortably longer than any real serial.
const MAX_CAPTURE_LENGTH = 128;

export type SentinelState =
  | { phase: 'seeking'; matchedPrefixLen: number }
  | { phase: 'capturing'; captured: string };

export const initialSentinelState: SentinelState = { phase: 'seeking', matchedPrefixLen: 0 };

export type SentinelEvent = { type: 'char'; char: string } | { type: 'terminator' };

export interface SentinelStep {
  state: SentinelState;
  /** Set only on the step where a full sentinel-prefixed scan completes. */
  scannedSerial?: string;
}

export function stepSentinel(state: SentinelState, event: SentinelEvent): SentinelStep {
  if (state.phase === 'seeking') {
    if (event.type === 'terminator') {
      return { state: initialSentinelState };
    }
    const { char } = event;
    if (char === SCAN_SENTINEL[state.matchedPrefixLen]) {
      const matchedPrefixLen = state.matchedPrefixLen + 1;
      if (matchedPrefixLen === SCAN_SENTINEL.length) {
        return { state: { phase: 'capturing', captured: '' } };
      }
      return { state: { phase: 'seeking', matchedPrefixLen } };
    }
    // Mismatch: restart the match, but the mismatching character might itself be the
    // sentinel's first character (e.g. typing "~x~SCAN~" shouldn't need a full reset
    // before the real prefix begins).
    const matchedPrefixLen = char === SCAN_SENTINEL[0] ? 1 : 0;
    return { state: { phase: 'seeking', matchedPrefixLen } };
  }

  // capturing
  if (event.type === 'terminator') {
    const serial = state.captured;
    return { state: initialSentinelState, scannedSerial: serial.length > 0 ? serial : undefined };
  }
  const captured = state.captured + event.char;
  if (captured.length > MAX_CAPTURE_LENGTH) {
    return { state: initialSentinelState };
  }
  return { state: { phase: 'capturing', captured } };
}
