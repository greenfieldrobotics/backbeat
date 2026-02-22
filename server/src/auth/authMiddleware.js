/**
 * Require authentication middleware.
 * Bypassed when NODE_ENV=test (keeps existing integration tests working)
 * and when Google credentials are not configured (dev without OAuth setup).
 */
export function requireAuth(req, res, next) {
  // Bypass auth in test environment
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  // Bypass auth when Google OAuth is not configured (dev convenience)
  if (!process.env.GOOGLE_CLIENT_ID) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }

  res.status(401).json({ error: 'Authentication required' });
}

/**
 * Require admin role middleware.
 * Bypassed in test/dev (same as requireAuth).
 */
export function requireAdmin(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return next();
  }

  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}
