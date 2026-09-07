import { Router } from 'express';
import passport from './passport.js';

const router = Router();

// Initiate Google OAuth flow
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google OAuth is not configured' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Google OAuth callback
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', {
    failureRedirect: '/login?error=not-allowed',
  })(req, res, next);
}, (req, res) => {
  res.redirect('/');
});

// Get current user
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    const { id, email, name, picture, role } = req.user;
    return res.json({ id, email, name, picture, role });
  }

  // If Google OAuth is not configured, return a dev user
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ id: 0, email: 'dev@localhost', name: 'Dev User', picture: null, role: 'admin' });
  }

  res.status(401).json({ error: 'Not authenticated' });
});

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session?.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });
});

export default router;
