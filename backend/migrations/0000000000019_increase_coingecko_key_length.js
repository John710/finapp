export const up = (pgm) => {
  pgm.alterColumn('users', 'coingecko_api_key', { type: 'varchar(255)' })
}

export const down = (pgm) => {
  pgm.alterColumn('users', 'coingecko_api_key', { type: 'varchar(100)' })
}
