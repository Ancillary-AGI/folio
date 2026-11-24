#!/usr/bin/env node
/**
 * Delete the embedded PGlite data directory — a truly clean room.
 *
 *   npm run backend:reset
 *
 * Environment:
 *   FOLIO_DATA_DIR  overrides the default `.backend/pglite-data`.
 */
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './config'

const target = process.env.FOLIO_DATA_DIR?.trim() || join(repoRoot, '.backend', 'pglite-data')

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true })
  console.log(`removed ${target}`)
} else {
  console.log(`nothing to remove at ${target}`)
}