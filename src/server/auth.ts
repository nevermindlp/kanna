import { randomBytes, timingSafeEqual } from "node:crypto"
import {
  buildCookie,
  effectiveOrigin,
  getSessionTokenFromRequest,
  sanitizeNextPath,
  SESSION_COOKIE_NAME,
} from "./auth-shared"
import type { AuthContext, AuthManager, AuthManagerOptions, AuthStatusPayload } from "./user-auth"

export type { AuthContext, AuthManager, AuthManagerOptions, AuthStatusPayload }

async function readLoginForm(req: Request) {
  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    const payload = await req.json() as { password?: unknown; next?: unknown }
    return {
      password: typeof payload.password === "string" ? payload.password : "",
      nextPath: sanitizeNextPath(typeof payload.next === "string" ? payload.next : "/"),
    }
  }

  const formData = await req.formData()
  return {
    password: String(formData.get("password") ?? ""),
    nextPath: sanitizeNextPath(String(formData.get("next") ?? "/")),
  }
}

export function createAuthManager(password: string, options: AuthManagerOptions = {}): AuthManager {
  const sessions = new Map<string, { createdAt: number }>()
  const expectedPassword = Buffer.from(password)
  const trustProxy = options.trustProxy ?? false

  function validateOrigin(req: Request) {
    const origin = req.headers.get("origin")
    if (!origin) return true
    if (origin === new URL(req.url).origin) return true
    if (!trustProxy) return false
    return origin === effectiveOrigin(req, trustProxy)
  }

  function createSessionCookie(req: Request) {
    const sessionToken = randomBytes(32).toString("base64url")
    sessions.set(sessionToken, { createdAt: Date.now() })
    return buildCookie(SESSION_COOKIE_NAME, sessionToken, req, trustProxy)
  }

  function clearSessionCookie(req: Request) {
    const sessionToken = getSessionTokenFromRequest(req)
    if (sessionToken) {
      sessions.delete(sessionToken)
    }
    return buildCookie(SESSION_COOKIE_NAME, "", req, trustProxy, ["Max-Age=0"])
  }

  function verifyPassword(candidate: string) {
    const actual = Buffer.from(candidate)
    if (actual.length !== expectedPassword.length) {
      return false
    }
    return timingSafeEqual(actual, expectedPassword)
  }

  function resolveAuthContext(req: Request): AuthContext | null {
    const sessionToken = getSessionTokenFromRequest(req)
    if (!sessionToken || !sessions.has(sessionToken)) {
      return null
    }
    return {
      userId: "__shared__",
      username: "shared",
      sessionId: sessionToken,
    }
  }

  function isAuthenticated(req: Request) {
    return Boolean(resolveAuthContext(req))
  }

  async function resolveAuthContextAsync(req: Request) {
    return resolveAuthContext(req)
  }

  async function handleStatus(req: Request) {
    const context = resolveAuthContext(req)
    return Response.json({
      enabled: true,
      authenticated: Boolean(context),
      mode: "single",
    } satisfies AuthStatusPayload)
  }

  function redirectToApp(req: Request) {
    const currentUrl = new URL(req.url)
    return Response.redirect(new URL(sanitizeNextPath(currentUrl.searchParams.get("next")), effectiveOrigin(req, trustProxy)), 302)
  }

  async function handleLogin(req: Request, fallbackNextPath: string) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { password: candidate, nextPath } = await readLoginForm(req)
    if (!verifyPassword(candidate)) {
      return Response.json({ error: "Invalid password" }, { status: 401 })
    }

    const response = Response.json({ ok: true, nextPath: sanitizeNextPath(nextPath || fallbackNextPath) })
    response.headers.set("Set-Cookie", createSessionCookie(req))
    return response
  }

  async function handleLogout(req: Request) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const response = Response.json({ ok: true })
    response.headers.set("Set-Cookie", clearSessionCookie(req))
    return response
  }

  return {
    mode: "single",
    isAuthenticated,
    resolveAuthContext,
    validateOrigin,
    redirectToApp,
    handleLogin,
    handleLogout,
    handleStatus,
    resolveAuthContextAsync,
  }
}

export function createDisabledAuthManager(): AuthManager {
  return {
    mode: "single",
    isAuthenticated: () => true,
    resolveAuthContext: () => ({
      userId: "__local__",
      username: "local",
      sessionId: "local",
    }),
    validateOrigin: () => true,
    redirectToApp: (req) => Response.redirect(new URL("/", req.url), 302),
    handleLogin: async () => Response.json({ ok: true }),
    handleLogout: async () => Response.json({ ok: true }),
    handleStatus: async () => Response.json({
      enabled: false,
      authenticated: true,
      mode: "single",
    } satisfies AuthStatusPayload),
    resolveAuthContextAsync: async () => ({
      userId: "__local__",
      username: "local",
      sessionId: "local",
    }),
  }
}

export type PasswordAuthManager = AuthManager & {
  resolveAuthContextAsync: (req: Request) => Promise<AuthContext | null>
}
