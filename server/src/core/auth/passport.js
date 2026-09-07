import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import pool from '../../db/connection.js';
import { findUserById, findUserByEmail, recordGoogleLogin } from '../users/userService.js';

// Serialize: store user id in session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize: look up user by id
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await findUserById(pool, id));
  } catch (err) {
    done(err, null);
  }
});

// Only register Google strategy if credentials are configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const origin = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || `${origin}/auth/google/callback`;

  passport.use(new GoogleStrategy.Strategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(null, false, { message: 'No email returned from Google' });
      }

      // Check allowlist: email must already exist in users table
      const allowed = await findUserByEmail(pool, email);
      if (!allowed) {
        return done(null, false, { message: 'not-allowed' });
      }

      // Update user with Google profile info
      const user = await recordGoogleLogin(pool, {
        email,
        google_id: profile.id,
        name: profile.displayName || '',
        picture: profile.photos?.[0]?.value || null,
      });

      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }));
}

export default passport;
