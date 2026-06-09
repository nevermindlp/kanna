import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

export const SESSION_COOKIE_NAME = "kanna_session"
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function parseCookies(header: string | null) {
  const cookies = new Map<string, string>()
  if (!header) return cookies

  for (const segment of header.split(";")) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    cookies.set(key, decodeURIComponent(value))
  }

  return cookies
}

export function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath || typeof nextPath !== "string") return "/"
  if (!nextPath.startsWith("/")) return "/"
  if (nextPath.startsWith("//")) return "/"
  if (nextPath.startsWith("/auth/login")) return "/"
  return nextPath
}

export function forwardedProto(req: Request): "http" | "https" | null {
  const xfp = req.headers.get("x-forwarded-proto")
  if (!xfp) return null
  const value = xfp.split(",")[0]?.trim().toLowerCase()
  return value === "http" || value === "https" ? value : null
}

export function effectiveOrigin(req: Request, trustProxy: boolean): string {
  const url = new URL(req.url)
  if (!trustProxy) return url.origin
  const proto = forwardedProto(req)
  const scheme = proto ?? url.protocol.replace(":", "")
  return `${scheme}://${url.host}`
}

function shouldUseSecureCookie(req: Request, trustProxy: boolean) {
  if (trustProxy) {
    const proto = forwardedProto(req)
    if (proto) return proto === "https"
  }
  return new URL(req.url).protocol === "https:"
}

export function buildCookie(name: string, value: string, req: Request, trustProxy: boolean, extras: string[] = []) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ]

  if (shouldUseSecureCookie(req, trustProxy)) {
    parts.push("Secure")
  }

  parts.push(...extras)
  return parts.join("; ")
}

export function getSessionTokenFromRequest(req: Request) {
  return parseCookies(req.headers.get("cookie")).get(SESSION_COOKIE_NAME) ?? null
}

export async function hashPassword(password: string) {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 12,
  })
}

export async function verifyPassword(password: string, passwordHash: string) {
  return Bun.password.verify(password, passwordHash)
}

export function deriveEncryptionKey(secretsKey: string | null) {
  if (!secretsKey) return null
  return createHash("sha256").update(secretsKey).digest()
}

export function encryptJson(value: unknown, secretsKey: string | null) {
  const key = deriveEncryptionKey(secretsKey)
  if (!key) {
    return JSON.stringify(value)
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: encrypted.toString("base64url"),
  })
}

export function decryptJson<T>(payload: string, secretsKey: string | null): T {
  if (!secretsKey) {
    return JSON.parse(payload) as T
  }

  const parsed = JSON.parse(payload) as {
    v?: number
    iv?: string
    tag?: string
    data?: string
  }

  if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) {
    return JSON.parse(payload) as T
  }

  const key = deriveEncryptionKey(secretsKey)
  if (!key) {
    return JSON.parse(payload) as T
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64url"))
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64url")),
    decipher.final(),
  ])
  return JSON.parse(decrypted.toString("utf8")) as T
}
