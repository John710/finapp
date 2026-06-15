import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const result = spawnSync(
  'node',
  ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', 'up'],
  {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'pipe'
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
