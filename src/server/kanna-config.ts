export type KannaAuthMode = "single" | "multiuser"
export type KannaStorageMode = "file" | "mysql"

export interface KannaRuntimeConfig {
  authMode: KannaAuthMode
  storageMode: KannaStorageMode
  databaseUrl: string | null
  redisUrl: string | null
  secretsKey: string | null
  s3: {
    endpoint: string | null
    region: string
    bucket: string | null
    accessKeyId: string | null
    secretAccessKey: string | null
  }
}

export const LOCAL_USER_ID = "__local__"

export function resolveKannaAuthMode(env: NodeJS.ProcessEnv = process.env): KannaAuthMode {
  const raw = env.KANNA_AUTH_MODE?.trim().toLowerCase()
  if (raw === "multiuser") return "multiuser"
  return "single"
}

export function resolveKannaStorageMode(env: NodeJS.ProcessEnv = process.env): KannaStorageMode {
  const raw = env.KANNA_STORAGE?.trim().toLowerCase()
  if (raw === "mysql") return "mysql"
  return "file"
}

export function resolveKannaRuntimeConfig(env: NodeJS.ProcessEnv = process.env): KannaRuntimeConfig {
  const authMode = resolveKannaAuthMode(env)
  const storageMode = resolveKannaStorageMode(env)
  const databaseUrl = env.DATABASE_URL?.trim() || null

  if (authMode === "multiuser" && !databaseUrl) {
    throw new Error("KANNA_AUTH_MODE=multiuser requires DATABASE_URL")
  }
  if (storageMode === "mysql" && !databaseUrl) {
    throw new Error("KANNA_STORAGE=mysql requires DATABASE_URL")
  }

  return {
    authMode,
    storageMode,
    databaseUrl,
    redisUrl: env.REDIS_URL?.trim() || null,
    secretsKey: env.KANNA_SECRETS_KEY?.trim() || null,
    s3: {
      endpoint: env.KANNA_S3_ENDPOINT?.trim() || null,
      region: env.KANNA_S3_REGION?.trim() || "us-east-1",
      bucket: env.KANNA_S3_BUCKET?.trim() || null,
      accessKeyId: env.KANNA_S3_ACCESS_KEY_ID?.trim() || null,
      secretAccessKey: env.KANNA_S3_SECRET_ACCESS_KEY?.trim() || null,
    },
  }
}

export function isMultiUserEnabled(config: KannaRuntimeConfig) {
  return config.authMode === "multiuser"
}

export function isMysqlStorageEnabled(config: KannaRuntimeConfig) {
  return config.storageMode === "mysql"
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.KANNA_TRUST_PROXY?.trim().toLowerCase()
  if (!raw) return false
  return raw === "1" || raw === "true" || raw === "yes"
}
