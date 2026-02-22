import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import pool from '../db/connection.js';

// Serialize: store user id in session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize: look up user by id
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await pool.query('SELECT id, email, name, picture, role FROM users WHERE id = $1', [id]);
    done(null, rows[0] || null);
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
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (rows.length === 0) {
        return done(null, false, { message: 'not-allowed' });
      }

      // Update user with Google profile info
      const { rows: updated } = await pool.query(
        `UPDATE users SET google_id = $1, name = $2, picture = $3, last_login_at = NOW()
         WHERE email = $4 RETURNING id, email, name, picture, role`,
        [profile.id, profile.displayName || '', profile.photos?.[0]?.value || null, email]
      );

      done(null, updated[0]);
    } catch (err) {
      done(err, null);
    }
  }));
}

export default passport;
