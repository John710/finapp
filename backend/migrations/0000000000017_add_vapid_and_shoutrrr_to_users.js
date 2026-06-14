export const up = (pgm) => {
  pgm.addColumns('users', {
    vapid_public_key: { type: 'text' },
    vapid_private_key: { type: 'text' },
    vapid_subject: { type: 'varchar(255)' },
    shoutrrr_url: { type: 'text' }
  })
}

export const down = (pgm) => {
  pgm.dropColumns('users', [
    'vapid_public_key',
    'vapid_private_key',
    'vapid_subject',
    'shoutrrr_url'
  ])
}
