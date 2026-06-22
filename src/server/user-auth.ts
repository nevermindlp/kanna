import { randomBytes, randomUUID } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import type { KannaDatabase } from "./db/client"
import { sessions, users } from "./db/schema"
import { resolveUpdatesEnabled } from "../shared/branding"
import {
  buildCookie,
  effectiveOrigin,
  getSessionTokenFromRequest,
  hashPassword,
  hashSessionToken,
  sanitizeNextPath,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  verifyPassword,
} from "./auth-shared"

export interface AuthStatusPayload {
  enabled: boolean
  authenticated: boolean
  mode: "single" | "multiuser"
  username?: string
  userId?: string
  updatesEnabled: boolean
}

export interface AuthContext {
  userId: string
  username: string
  sessionId: string
}

export interface AuthManager {
  mode: "single" | "multiuser"
  isAuthenticated(req: Request): boolean
  resolveAuthContext(req: Request): AuthContext | null
  resolveAuthContextAsync(req: Request): Promise<AuthContext | null>
  validateOrigin(req: Request): boolean
  redirectToApp(req: Request): Response
  handleLogin(req: Request, nextPath: string): Promise<Response>
  handleRegister?(req: Request): Promise<Response>
  handleLogout(req: Request): Promise<Response>
  handleStatus(req: Request): Promise<Response>
  handleMe?(req: Request): Promise<Response>
}

export interface AuthManagerOptions {
  trustProxy?: boolean
}

interface SessionCacheEntry {
  userId: string
  username: string
  sessionId: string
  expiresAt: number
}

async function readAuthPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    const payload = await req.json() as {
      password?: unknown
      username?: unknown
      email?: unknown
      next?: unknown
    }
    return {
      username: typeof payload.username === "string" ? payload.username.trim() : "",
      email: typeof payload.email === "string" ? payload.email.trim() : "",
      password: typeof payload.password === "string" ? payload.password : "",
      nextPath: sanitizeNextPath(typeof payload.next === "string" ? payload.next : "/"),
    }
  }

  const formData = await req.formData()
  return {
    username: String(formData.get("username") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    nextPath: sanitizeNextPath(String(formData.get("next") ?? "/")),
  }
}

export function createMySqlUserAuthManager(
  db: KannaDatabase,
  options: AuthManagerOptions = {},
): AuthManager {
  const trustProxy = options.trustProxy ?? false
  const sessionCache = new Map<string, SessionCacheEntry>()

  function validateOrigin(req: Request) {
    const origin = req.headers.get("origin")
    if (!origin) return true
    if (origin === new URL(req.url).origin) return true
    if (!trustProxy) return false
    return origin === effectiveOrigin(req, trustProxy)
  }

  async function resolveSession(token: string | null): Promise<SessionCacheEntry | null> {
    if (!token) return null

    const cached = sessionCache.get(token)
    if (cached && cached.expiresAt > Date.now()) {
      return cached
    }

    const tokenHash = hashSessionToken(token)
    const rows = await db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        username: users.username,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
      ))
      .limit(1)

    const row = rows[0]
    if (!row) {
      sessionCache.delete(token)
      return null
    }

    const entry: SessionCacheEntry = {
      sessionId: row.sessionId,
      userId: row.userId,
      username: row.username,
      expiresAt: row.expiresAt.getTime(),
    }
    sessionCache.set(token, entry)
    return entry
  }

  function resolveAuthContext(_req: Request): AuthContext | null {
    return null
  }

  async function resolveAuthContextAsync(req: Request): Promise<AuthContext | null> {
    const token = getSessionTokenFromRequest(req)
    const session = await resolveSession(token)
    if (!session) return null
    return {
      userId: session.userId,
      username: session.username,
      sessionId: session.sessionId,
    }
  }

  function isAuthenticated(req: Request) {
    const token = getSessionTokenFromRequest(req)
    if (!token) return false
    const cached = sessionCache.get(token)
    return Boolean(cached && cached.expiresAt > Date.now())
  }

  async function createSession(req: Request, userId: string, username: string) {
    const token = randomBytes(32).toString("base64url")
    const sessionId = randomUUID()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

    await db.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      instanceId: process.env.KANNA_INSTANCE_ID?.trim() || null,
      userAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    })

    sessionCache.set(token, {
      sessionId,
      userId,
      username,
      expiresAt: expiresAt.getTime(),
    })

    return buildCookie(SESSION_COOKIE_NAME, token, req, trustProxy)
  }

  async function clearSession(req: Request) {
    const token = getSessionTokenFromRequest(req)
    if (token) {
      sessionCache.delete(token)
      await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)))
    }
    return buildCookie(SESSION_COOKIE_NAME, "", req, trustProxy, ["Max-Age=0"])
  }

  async function handleStatus(req: Request) {
    const context = await resolveAuthContextAsync(req)
    return Response.json({
      enabled: true,
      authenticated: Boolean(context),
      mode: "multiuser",
      username: context?.username,
      userId: context?.userId,
      updatesEnabled: resolveUpdatesEnabled(),
    } satisfies AuthStatusPayload)
  }

  async function handleMe(req: Request) {
    const context = await resolveAuthContextAsync(req)
    if (!context) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    return Response.json({
      userId: context.userId,
      username: context.username,
    })
  }

  function redirectToApp(req: Request) {
    const currentUrl = new URL(req.url)
    return Response.redirect(new URL(sanitizeNextPath(currentUrl.searchParams.get("next")), effectiveOrigin(req, trustProxy)), 302)
  }

  async function handleRegister(req: Request) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { username, email, password } = await readAuthPayload(req)
    if (!username || username.length < 3) {
      return Response.json({ error: "Username must be at least 3 characters." }, { status: 400 })
    }
    if (!password || password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 })
    }

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
    if (existing[0]) {
      return Response.json({ error: "Username already exists." }, { status: 409 })
    }

    const userId = randomUUID()
    await db.insert(users).values({
      id: userId,
      username,
      email: email || null,
      passwordHash: await hashPassword(password),
      status: "active",
    })

    const response = Response.json({ ok: true, username, userId })
    response.headers.set("Set-Cookie", await createSession(req, userId, username))
    return response
  }

  async function handleLogin(req: Request, fallbackNextPath: string) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { username, password, nextPath } = await readAuthPayload(req)
    if (!username || !password) {
      return Response.json({ error: "Username and password are required." }, { status: 400 })
    }

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)

    const user = rows[0]
    if (!user || user.status !== "active" || !(await verifyPassword(password, user.passwordHash))) {
      return Response.json({ error: "Invalid username or password." }, { status: 401 })
    }

    const response = Response.json({
      ok: true,
      nextPath: sanitizeNextPath(nextPath || fallbackNextPath),
      username: user.username,
      userId: user.id,
    })
    response.headers.set("Set-Cookie", await createSession(req, user.id, user.username))
    return response
  }

  async function handleLogout(req: Request) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const response = Response.json({ ok: true })
    response.headers.set("Set-Cookie", await clearSession(req))
    return response
  }

  return {
    mode: "multiuser",
    isAuthenticated,
    resolveAuthContext,
    resolveAuthContextAsync,
    validateOrigin,
    redirectToApp,
    handleLogin,
    handleRegister,
    handleLogout,
    handleStatus,
    handleMe,
  }
}
