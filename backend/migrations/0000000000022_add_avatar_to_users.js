export const up = (pgm) => {
  // Avatar is stored as a data URL (data:image/<mime>;base64,...) — keeps the
  // container filesystem stateless. Raster formats only; the API validates.
  pgm.addColumn('users', {
    avatar: { type: 'text', notNull: false }
  })
}

export const down = (pgm) => {
  pgm.dropColumn('users', 'avatar')
}
