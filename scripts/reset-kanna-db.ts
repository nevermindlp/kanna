#!/usr/bin/env bun
import { resetKannaDatabase } from "../src/server/db/migrate"
import { resolveKannaRuntimeConfig } from "../src/server/kanna-config"

const config = resolveKannaRuntimeConfig()
const databaseUrl = process.env.DATABASE_URL ?? config.databaseUrl

if (!databaseUrl) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

console.log(`[kanna] resetting database: ${databaseUrl.replace(/:([^:@/]+)@/, ":***@")}`)
await resetKannaDatabase(databaseUrl)
console.log("[kanna] database reset complete")
