import { drizzle, type MySql2Database } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import * as schema from "./schema"

export type KannaDatabase = MySql2Database<typeof schema>

let pool: mysql.Pool | null = null
let db: KannaDatabase | null = null

export function getDbPool(databaseUrl: string) {
  if (!pool) {
    pool = mysql.createPool(databaseUrl)
  }
  return pool
}

export function getDb(databaseUrl: string): KannaDatabase {
  if (!db) {
    db = drizzle(getDbPool(databaseUrl), { schema, mode: "default" })
  }
  return db
}

export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

export async function pingDb(databaseUrl: string) {
  const connection = await mysql.createConnection(databaseUrl)
  try {
    await connection.ping()
  } finally {
    await connection.end()
  }
}
