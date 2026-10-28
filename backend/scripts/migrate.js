import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The server (plugins/db.js) reads DATABASE_SSL / DATABASE_SSL_REJECT_UNAUTHORIZED,
// but node-pg-migrate only understands libpq-style settings. Translate them to
// PGSSLMODE so migrations reach a TLS-only database the same way the app does,
// unless the URL or the environment already chose an SSL mode explicitly.
const env = { ...process.env }
const urlSetsSslMode = /[?&]sslmode=/i.test(process.env.DATABASE_URL || '')
if (process.env.DATABASE_SSL === 'true' && !urlSetsSslMode && !env.PGSSLMODE) {
  env.PGSSLMODE = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? 'no-verify' : 'require'
}

const result = spawnSync(
  'node',
  ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', 'up'],
  {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'pipe',
    env
  }
)

const output = (result.stdout || '') + (result.stderr || '')

if (result.status !== 0) {
  console.error('Migration failed:')
  console.error(output)
  process.exit(1)
}

// Only print migration output when something actually ran.
if (!output.includes('No migrations to run')) {
  process.stdout.write(output)
}
