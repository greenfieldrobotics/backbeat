import { describe, it, expect } from 'vitest';
import { initialSentinelState, stepSentinel, SCAN_SENTINEL, type SentinelState } from './sentinelParser';

function feed(chars: string, terminate = true): { state: SentinelState; scannedSerial?: string } {
  let state = initialSentinelState;
  let scannedSerial: string | undefined;
  for (const char of chars) {
    const step = stepSentinel(state, { type: 'char', char });
    state = step.state;
    if (step.scannedSerial) scannedSerial = step.scannedSerial;
  }
  if (terminate) {
    const step = stepSentinel(state, { type: 'terminator' });
    state = step.state;
    if (step.scannedSerial) scannedSerial = step.scannedSerial;
  }
  return { state, scannedSerial };
}

describe('stepSentinel', () => {
  it('recognizes a full sentinel-prefixed scan terminated by Enter', () => {
    const { scannedSerial, state } = feed(`${SCAN_SENTINEL}ABC-123`);
    expect(scannedSerial).toBe('ABC-123');
    expect(state).toEqual(initialSentinelState);
  });

  it('does not trigger on ordinary typing, even ending in Enter', () => {
    const { scannedSerial } = feed('hello world this is a normal sentence');
    expect(scannedSerial).toBeUndefined();
  });

  it('does not trigger on ordinary typing that happens to share a prefix character', () => {
    // '~' is the sentinel's first character; typing it without following through
    // should not produce a false match.
    const { scannedSerial } = feed('~not really a scan');
    expect(scannedSerial).toBeUndefined();
  });

  it('does not trigger on a partial sentinel sequence with no terminator', () => {
    const { scannedSerial } = feed(SCAN_SENTINEL.slice(0, -1), false);
    expect(scannedSerial).toBeUndefined();
  });

  it('does not trigger when the sentinel is typed but nothing follows before Enter', () => {
    const { scannedSerial } = feed(SCAN_SENTINEL);
    expect(scannedSerial).toBeUndefined();
  });

  it('recovers from an interleaved/interrupted sequence and matches the next real scan', () => {
    // A false start ("~SCbogus") should not poison state for the real scan that follows.
    const bogus = '~SCbogus';
    let state = initialSentinelState;
    for (const char of bogus) {
      state = stepSentinel(state, { type: 'char', char }).state;
    }
    state = stepSentinel(state, { type: 'terminator' }).state;
    expect(state).toEqual(initialSentinelState);

    let scannedSerial: string | undefined;
    for (const char of `${SCAN_SENTINEL}XYZ-9`) {
      const step = stepSentinel(state, { type: 'char', char });
      state = step.state;
      if (step.scannedSerial) scannedSerial = step.scannedSerial;
    }
    const finalStep = stepSentinel(state, { type: 'terminator' });
    scannedSerial = finalStep.scannedSerial ?? scannedSerial;
    expect(scannedSerial).toBe('XYZ-9');
  });

  it('handles a mismatch that restarts on the sentinel\'s own first character', () => {
    // "~~SCAN~SERIAL" — the first '~' starts a match, the second '~' is a mismatch at
    // position 1 but is itself a valid restart (position 0 -> 1), and the real sentinel
    // completes right after it.
    const { scannedSerial } = feed(`~${SCAN_SENTINEL}SERIAL1`);
    expect(scannedSerial).toBe('SERIAL1');
  });

  it('bails out of a runaway capture instead of buffering forever', () => {
    const runaway = SCAN_SENTINEL + 'x'.repeat(200);
    const { scannedSerial, state } = feed(runaway, false);
    expect(scannedSerial).toBeUndefined();
    expect(state).toEqual(initialSentinelState);
  });
});
