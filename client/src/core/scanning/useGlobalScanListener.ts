import { useEffect, useRef } from 'react';
import { initialSentinelState, stepSentinel, type SentinelState } from './sentinelParser';

// A user entering a serial by hand into a form field must not trigger a navigation —
// the listener is global, but it must not hijack typing into a form field (G4.2).
// Skipping capture entirely while an editable element is focused also means a physical
// scanner can still be pointed at a focused input to type directly into it, which is a
// separate, legitimate use — this hook only owns the "no field is focused" case.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Registers a single document-level keydown listener that recognizes the sentinel-
// prefixed scan pattern (G4.2) and calls `onScan(serial)` once a full scan completes.
// Lives in core, not Gear, because Stash's receiving and picking flows want scan-
// anywhere just as much.
export function useGlobalScanListener(onScan: (serial: string) => void) {
  const stateRef = useRef<SentinelState>(initialSentinelState);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      const isTerminator = event.key === 'Enter';
      if (!isTerminator && event.key.length !== 1) return; // ignore Shift, Arrow keys, etc.

      const step = stepSentinel(
        stateRef.current,
        isTerminator ? { type: 'terminator' } : { type: 'char', char: event.key }
      );
      stateRef.current = step.state;
      if (step.scannedSerial) {
        event.preventDefault();
        onScanRef.current(step.scannedSerial);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
