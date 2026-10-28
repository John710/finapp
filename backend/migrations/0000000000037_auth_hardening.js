export const up = (pgm) => {
  // Refresh-token rotation keeps a consumed token usable for a short grace
  // window (two tabs refreshing at once). The window is measured from the FIRST
  // consumption; before this column every reuse pushed expires_at forward again,
  // so a consumed token could be replayed indefinitely in 30-second hops.
  pgm.addColumn('refresh_tokens', {
    consumed_at: { type: 'timestamp' }
  })

  // TOTP hardening: a per-user failure counter with a temporary lockout, and the
  // last accepted RFC 6238 time step so a code cannot be replayed.
  pgm.addColumn('users', {
    totp_failed_attempts: { type: 'integer', notNull: true, default: 0 },
    totp_locked_until: { type: 'timestamp' },
    totp_last_step: { type: 'bigint' }
  })
}

export const down = (pgm) => {
  pgm.dropColumn('users', ['totp_last_step', 'totp_locked_until', 'totp_failed_attempts'])
  pgm.dropColumn('refresh_tokens', 'consumed_at')
}
