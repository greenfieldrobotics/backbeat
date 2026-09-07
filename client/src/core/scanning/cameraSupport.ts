// Feature detection for camera-based scanning (G4.1). `getUserMedia` requires a secure
// context — HTTPS, with `localhost` as the only exception — so a phone on the LAN pointed
// at a plain-HTTP dev server will fail with an opaque permission error unless this is
// checked and reported honestly (requirements §6.3 / "five things that will bite" #3).
export type CameraScanSupport =
  | { ready: true }
  | { ready: false; reason: 'insecure-context' }
  | { ready: false; reason: 'no-camera-api' };

interface WindowLike {
  isSecureContext: boolean;
}

interface NavigatorLike {
  mediaDevices?: { getUserMedia?: unknown };
}

export function getCameraScanSupport(
  win: WindowLike = window,
  nav: NavigatorLike = navigator
): CameraScanSupport {
  if (!win.isSecureContext) {
    return { ready: false, reason: 'insecure-context' };
  }
  if (!nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
    return { ready: false, reason: 'no-camera-api' };
  }
  return { ready: true };
}
