// bcrypt only reads the first 72 bytes of a password: everything after that is
// silently ignored, so a longer password would be accepted with a different
// suffix. Passwords are refused above this limit instead of being truncated.
export const BCRYPT_MAX_BYTES = 72

export function passwordTooLong(password) {
  return Buffer.byteLength(String(password ?? ''), 'utf8') > BCRYPT_MAX_BYTES
}

// Every credential that outlives a password: browser sessions (refresh tokens),
// personal API tokens and calendar feed tokens. A password change or reset must
// end all of them, or whoever held the old password keeps access through them.
// `db` is a pool or a client inside the caller's transaction. The current
// browser session can be kept by passing its refresh-token hash.
export async function revokeUserCredentials(db, userId, { keepRefreshHash = null } = {}) {
  if (keepRefreshHash) {
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash != $2', [userId, keepRefreshHash])
  } else {
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])
  }
  await db.query('DELETE FROM api_tokens WHERE user_id = $1', [userId])
  await db.query(
    'UPDATE recurring_feed_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  )
}
