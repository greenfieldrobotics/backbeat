// User services — all SQL for the shared `users` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.

import { executeSqlStrict, executeSqlWrite } from '../../db/connection.js';
import { httpError } from '../http.js';

export const VALID_ROLES = ['admin', 'warehouse', 'procurement', 'viewer'];

// Columns safe to hand back to the API — never the Google id.
const PUBLIC_COLUMNS = 'id, email, name, role, picture, created_at, last_login_at';

/** All users on the allowlist, ordered for display. */
export async function listUsers(db) {
  return executeSqlStrict(
    db,
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name, email`
  );
}

/** Add a user to the allowlist. */
export async function createUser(db, { email, name, role }) {
  if (!email) {
    throw httpError('Email is required', 400);
  }
  if (role && !VALID_ROLES.includes(role)) {
    throw httpError(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400);
  }

  try {
    const rows = await executeSqlStrict(
      db,
      'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id, email, name, role, created_at, last_login_at',
      [email.trim().toLowerCase(), (name || '').trim(), role || 'viewer']
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError('A user with this email already exists', 409);
    throw err;
  }
}

/** Update a user's name and/or role. */
export async function updateUser(db, id, { name, role }) {
  if (role && !VALID_ROLES.includes(role)) {
    throw httpError(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400);
  }

  const updates = [];
  const params = [];
  let idx = 1;

  if (name !== undefined) {
    updates.push(`name = $${idx++}`);
    params.push(name.trim());
  }
  if (role !== undefined) {
    updates.push(`role = $${idx++}`);
    params.push(role);
  }

  if (updates.length === 0) {
    throw httpError('No fields to update', 400);
  }

  params.push(id);
  const rows = await executeSqlStrict(
    db,
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, created_at, last_login_at`,
    params
  );

  if (rows.length === 0) throw httpError('User not found', 404);
  return rows[0];
}

/** Remove a user from the allowlist. */
export async function deleteUser(db, id) {
  const rowCount = await executeSqlWrite(db, 'DELETE FROM users WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('User not found', 404);
}

/** Look up a session user by id (used to deserialize the Passport session). */
export async function findUserById(db, id) {
  const rows = await executeSqlStrict(
    db,
    'SELECT id, email, name, picture, role FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/** Look up a user by email — this is the OAuth allowlist check. */
export async function findUserByEmail(db, email) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

/** Record a successful Google sign-in, refreshing the cached profile fields. */
export async function recordGoogleLogin(db, { email, google_id, name, picture }) {
  const rows = await executeSqlStrict(
    db,
    `UPDATE users SET google_id = $1, name = $2, picture = $3, last_login_at = NOW()
     WHERE email = $4 RETURNING id, email, name, picture, role`,
    [google_id, name, picture, email]
  );
  return rows[0];
}
