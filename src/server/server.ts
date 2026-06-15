import path from "node:path"
import { stat } from "node:fs/promises"
import { APP_NAME, getRuntimeProfile } from "../shared/branding"
import type { ChatAttachment } from "../shared/types"
import type { ShareMode } from "../shared/share"
import { createAuthManager, createDisabledAuthManager, type AuthManager } from "./auth"
import { createEventStoreRoot, LOCAL_USER_ID } from "./event-store-factory"
import { resolveKannaRuntimeConfig } from "./kanna-config"
import { getDb } from "./db/client"
import { createMySqlUserAuthManager } from "./user-auth"
import { StoreResolver } from "./store-resolver"
import { RealtimeHub } from "./realtime-hub"
import { ObjectStorageService } from "./object-storage"
import { AttachmentService, inferAttachmentResponseContentType } from "./attachment-service"
import { claudeSnapshotFromProviderConfig, readClaudeProviderSnapshotForUser, UserSettingsService } from "./user-settings-service"
import type { IUserScopedEventStore } from "./event-store-types"
import { AgentCoordinator } from "./agent"
import { KannaAnalyticsReporter } from "./analytics"
import { AppSettingsManager } from "./app-settings"
import { DiffStore } from "./diff-store"
import { discoverProjects, type DiscoveredProject } from "./discovery"
import { KeybindingsManager } from "./keybindings"
import { readLlmProviderSnapshot, validateLlmProviderCredentials, writeLlmProviderSnapshot } from "./llm-provider"
import { buildClaudeSessionEnvFromSnapshot, readClaudeProviderSnapshot, validateClaudeProviderCredentials, writeClaudeProviderSnapshot } from "./claude-provider"
import { getMachineDisplayName } from "./machine-name"
import { TerminalManager } from "./terminal-manager"
import { UpdateManager } from "./update-manager"
import type { UpdateInstallAttemptResult } from "./cli-runtime"
import { createWsRouter, type ClientState } from "./ws-router"
import { deleteProjectUpload, inferAttachmentContentType, inferProjectFileContentType, persistProjectUpload } from "./uploads"
import { getProjectUploadDir } from "./paths"

const MAX_UPLOAD_FILES = 50
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024
const STALE_EMPTY_CHAT_PRUNE_INTERVAL_MS = 60 * 1000

export async function persistUploadedFiles(args: {
  projectId: string
  localPath: string
  files: File[]
  persistUpload?: typeof persistProjectUpload
}): Promise<ChatAttachment[]> {
  const persistUpload = args.persistUpload ?? persistProjectUpload
  const attachments: ChatAttachment[] = []

  try {
    for (const file of args.files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const attachment = await persistUpload({
        projectId: args.projectId,
        localPath: args.localPath,
        fileName: file.name,
        bytes,
        fallbackMimeType: file.type || undefined,
      })
      attachments.push(attachment)
    }
  } catch (error) {
    await Promise.allSettled(
      attachments.map((attachment) => deleteProjectUpload({
        localPath: args.localPath,
        storedName: path.basename(attachment.absolutePath),
      }))
    )
    throw error
  }

  return attachments
}

export interface StartKannaServerOptions {
  port?: number
  host?: string
  openBrowser?: boolean
  share?: ShareMode
  dataDir?: string
  password?: string | null
  strictPort?: boolean
  /**
   * When true, the auth layer trusts X-Forwarded-Proto for CSRF origin
   * checks, redirect URLs, and the Secure cookie flag. The hostname still
   * comes from the request URL / Host header. Only enable when the server is
   * reachable solely through a trusted reverse proxy such as cloudflared.
   */
  trustProxy?: boolean
  onMigrationProgress?: (message: string) => void
  update?: {
    version: string
    fetchLatestVersion: (packageName: string) => Promise<string>
    installVersion: (packageName: string, version: string) => UpdateInstallAttemptResult
  }
}

export async function startKannaServer(options: StartKannaServerOptions = {}) {
  const port = options.port ?? 3210
  const hostname = options.host ?? "127.0.0.1"
  const strictPort = options.strictPort ?? false
  const runtimeProfile = getRuntimeProfile()
  const config = resolveKannaRuntimeConfig()

  let auth: AuthManager
  if (config.authMode === "multiuser") {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required when KANNA_AUTH_MODE=multiuser")
    }
    auth = createMySqlUserAuthManager(getDb(config.databaseUrl), { trustProxy: options.trustProxy ?? false })
  } else if (options.password) {
    auth = createAuthManager(options.password, { trustProxy: options.trustProxy ?? false })
  } else {
    auth = createDisabledAuthManager()
  }

  const eventStoreRoot = await createEventStoreRoot(config, options.dataDir)
  const storeResolver = new StoreResolver(eventStoreRoot)
  await storeResolver.migrateLegacyTranscripts(options.onMigrationProgress)
  const defaultScopedStore = await storeResolver.forUser(LOCAL_USER_ID)

  const diffStore = new DiffStore(storeResolver.dataDir)
  const machineDisplayName = getMachineDisplayName()
  await diffStore.initialize()
  let discoveredProjects: DiscoveredProject[] = []

  async function refreshDiscovery() {
    discoveredProjects = discoverProjects()
    return discoveredProjects
  }

  await refreshDiscovery()

  let server: ReturnType<typeof Bun.serve<ClientState>>
  let router: ReturnType<typeof createWsRouter>
  const terminals = new TerminalManager()
  const keybindings = new KeybindingsManager()
  const appSettings = new AppSettingsManager(path.join(storeResolver.dataDir, "settings.json"))
  await appSettings.initialize()
  await keybindings.initialize()
  await readClaudeProviderSnapshot()

  const userSettingsService = config.authMode === "multiuser" && config.databaseUrl
    ? new UserSettingsService(getDb(config.databaseUrl), config.secretsKey)
    : null
  const objectStorage = new ObjectStorageService(config)
  const attachmentService = new AttachmentService(objectStorage, config.databaseUrl)
  if (objectStorage.enabled) {
    try {
      await objectStorage.verifyConnection()
    } catch (error) {
      console.warn("[kanna] Object storage connectivity check failed:", error)
    }
  }
  const realtimeHub = new RealtimeHub(config.redisUrl)

  const analytics = new KannaAnalyticsReporter({
    settings: appSettings,
    currentVersion: options.update?.version ?? "unknown",
    environment: runtimeProfile === "dev" ? "dev" : "prod",
  })
  const updateManager = options.update
    ? new UpdateManager({
      currentVersion: options.update.version,
      fetchLatestVersion: options.update.fetchLatestVersion,
      installVersion: options.update.installVersion,
      devMode: runtimeProfile === "dev",
      trackEvent: analytics.track.bind(analytics),
    })
    : null
  const agent = new AgentCoordinator({
    storeResolver,
    attachmentService,
    resolveClaudeSessionEnv: userSettingsService
      ? async (userId) => {
        const config = await userSettingsService.readProvider<{
          apiKey?: string
          baseUrl?: string | null
          customModels?: string[]
          defaultModel?: string
        }>(userId, "claude")
        const snapshot = claudeSnapshotFromProviderConfig(config, "account settings")
        return buildClaudeSessionEnvFromSnapshot(snapshot, process.env)
      }
      : undefined,
    resolveClaudeProviderSnapshot: userSettingsService
      ? (userId) => readClaudeProviderSnapshotForUser(userSettingsService, userId)
      : undefined,
    analytics,
    onStateChange: (chatId?: string, options?: { immediate?: boolean }) => {
      if (chatId) {
        if (options?.immediate) {
          void router.broadcastChatStateImmediately(chatId)
          return
        }
        router.scheduleChatStateBroadcast(chatId)
        return
      }
      router.scheduleBroadcast()
    },
  })
  agent.bindUserStore(defaultScopedStore)

  router = createWsRouter({
    storeResolver,
    diffStore,
    agent,
    terminals,
    keybindings,
    appSettings,
    analytics,
    userSettingsService,
    objectStorage,
    attachmentService,
    realtimeHub,
    llmProvider: {
      read: readLlmProviderSnapshot,
      write: writeLlmProviderSnapshot,
      validate: validateLlmProviderCredentials,
    },
    claudeProvider: {
      read: readClaudeProviderSnapshot,
      write: writeClaudeProviderSnapshot,
      validate: validateClaudeProviderCredentials,
    },
    refreshDiscovery,
    getDiscoveredProjects: () => discoveredProjects,
    machineDisplayName,
    updateManager,
  })

  await realtimeHub.start((userId) => {
    void router.broadcastSnapshotsForUser(userId)
  })
  const staleEmptyChatPruneInterval = setInterval(() => {
    void router.pruneStaleEmptyChats()
      .then(() => {
        if (config.authMode !== "multiuser") {
          void router.broadcastSnapshots()
        }
      })
  }, STALE_EMPTY_CHAT_PRUNE_INTERVAL_MS)

  const distDir = path.join(import.meta.dir, "..", "..", "dist", "client")

  const MAX_PORT_ATTEMPTS = 20
  let actualPort = port

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      server = Bun.serve<ClientState>({
        port: actualPort,
        hostname,
        async fetch(req, serverInstance) {
          const url = new URL(req.url)

          if (url.pathname === "/auth/status") {
            return auth.handleStatus(req)
          }

          if (url.pathname === "/auth/me") {
            return auth.handleMe?.(req) ?? Response.json({ error: "Not found" }, { status: 404 })
          }

          if (url.pathname === "/auth/logout") {
            if (req.method !== "POST") {
              return new Response(null, { status: 405, headers: { Allow: "POST" } })
            }
            return auth.handleLogout(req)
          }

          if (url.pathname === "/auth/register" && auth.handleRegister) {
            if (req.method !== "POST") {
              return new Response(null, { status: 405, headers: { Allow: "POST" } })
            }
            return auth.handleRegister(req)
          }

          const authContext = await auth.resolveAuthContextAsync(req)
          const requiresAuth = auth.mode === "multiuser" || (auth.mode === "single" && options.password)

          if (requiresAuth) {
            if (url.pathname === "/auth/login") {
              if (req.method === "GET") {
                return auth.redirectToApp(req)
              }
              if (req.method === "POST") {
                return auth.handleLogin(req, "/")
              }
              return new Response(null, { status: 405, headers: { Allow: "GET, POST" } })
            }

            if (url.pathname === "/ws") {
              if (!auth.validateOrigin(req)) {
                return new Response("Forbidden", { status: 403 })
              }
              if (!authContext) {
                return new Response("Unauthorized", { status: 401 })
              }
            } else if (url.pathname.startsWith("/api/") && !authContext) {
              return Response.json({ error: "Unauthorized" }, { status: 401 })
            }
          }

          if (url.pathname === "/ws") {
            const upgraded = serverInstance.upgrade(req, {
              data: {
                userId: authContext?.userId ?? LOCAL_USER_ID,
                username: authContext?.username ?? "local",
                subscriptions: new Map(),
                snapshotSignatures: new Map(),
              },
            })
            return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
          }

          if (url.pathname === "/health") {
            return Response.json({ ok: true, port: actualPort })
          }

          const scopedStore = authContext
            ? await storeResolver.forUser(authContext.userId)
            : defaultScopedStore

          const uploadResponse = await handleProjectUpload(req, url, scopedStore, attachmentService, authContext?.userId ?? LOCAL_USER_ID)
          if (uploadResponse) {
            return uploadResponse
          }

          const deleteUploadResponse = await handleProjectUploadDelete(req, url, scopedStore)
          if (deleteUploadResponse) {
            return deleteUploadResponse
          }

          const attachmentByIdResponse = await handleAttachmentById(req, url, authContext?.userId ?? LOCAL_USER_ID, attachmentService, scopedStore)
          if (attachmentByIdResponse) {
            return attachmentByIdResponse
          }

          const legacyObjectAttachmentResponse = await handleLegacyObjectStorageAttachmentContent(
            req,
            url,
            authContext?.userId ?? LOCAL_USER_ID,
            objectStorage,
          )
          if (legacyObjectAttachmentResponse) {
            return legacyObjectAttachmentResponse
          }

          const attachmentContentResponse = await handleAttachmentContent(req, url, scopedStore)
          if (attachmentContentResponse) {
            return attachmentContentResponse
          }

          const projectFileContentResponse = await handleProjectFileContent(req, url, scopedStore)
          if (projectFileContentResponse) {
            return projectFileContentResponse
          }

          return serveStatic(distDir, url.pathname)
        },
        websocket: {
          open(ws) {
            router.handleOpen(ws)
          },
          message(ws, raw) {
            router.handleMessage(ws, raw)
          },
          close(ws) {
            router.handleClose(ws)
          },
        },
      })
      break
    } catch (err: unknown) {
      const isAddrInUse =
        err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EADDRINUSE"
      if (!isAddrInUse || strictPort || attempt === MAX_PORT_ATTEMPTS - 1) {
        throw err
      }
      console.log(`Port ${actualPort} is in use, trying ${actualPort + 1}...`)
      actualPort++
    }
  }

  analytics.trackLaunch({
    port: actualPort,
    host: hostname,
    openBrowser: options.openBrowser ?? true,
    share: options.share ?? false,
    password: options.password ?? null,
    strictPort,
  })

  const shutdown = async () => {
    clearInterval(staleEmptyChatPruneInterval)
    for (const chatId of [...agent.activeTurns.keys()]) {
      await agent.cancel(chatId)
    }
    router.dispose()
    appSettings.dispose()
    keybindings.dispose()
    terminals.closeAll()
    realtimeHub.dispose()
    await storeResolver.compact(LOCAL_USER_ID)
    server.stop(true)
  }

  return {
    port: actualPort,
    store: defaultScopedStore,
    storeResolver,
    diffStore,
    updateManager,
    stop: shutdown,
  }
}

async function handleProjectUpload(
  req: Request,
  url: URL,
  store: IUserScopedEventStore,
  attachmentService: AttachmentService,
  userId: string,
) {
  if (req.method !== "POST") {
    return null
  }

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads$/)
  if (!match) {
    return null
  }

  const project = store.getProject(match[1])
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 })
  }

  const formData = await req.formData()
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File)

  if (files.length === 0) {
    return Response.json({ error: "No files uploaded" }, { status: 400 })
  }

  if (files.length > MAX_UPLOAD_FILES) {
    return Response.json({ error: `You can upload up to ${MAX_UPLOAD_FILES} files at a time.` }, { status: 400 })
  }

  for (const file of files) {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return Response.json(
        { error: `File "${file.name}" exceeds the ${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB limit.` },
        { status: 413 }
      )
    }
  }

  try {
    const attachments: ChatAttachment[] = []
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      attachments.push(await attachmentService.upload({
        userId,
        projectId: project.id,
        localPath: project.localPath,
        fileName: file.name,
        bytes,
        mimeType: file.type || undefined,
      }))
    }
    return Response.json({ attachments })
  } catch (error) {
    console.error("[uploads] Upload failed:", error)
    return Response.json({ error: "Upload failed" }, { status: 500 })
  }
}

async function handleAttachmentById(
  req: Request,
  url: URL,
  userId: string,
  attachmentService: AttachmentService,
  store: IUserScopedEventStore,
) {
  const match = url.pathname.match(/^\/api\/attachments\/([^/]+)(?:\/content)?$/)
  if (!match) {
    return null
  }

  const attachmentId = decodeURIComponent(match[1])
  if (!attachmentId) {
    return Response.json({ error: "Invalid attachment id" }, { status: 400 })
  }

  if (req.method === "DELETE") {
    const projectId = url.searchParams.get("projectId")
    const project = projectId ? store.getProject(projectId) : null
    const deleted = await attachmentService.deleteAttachment({
      attachmentId,
      userId,
      localPath: project?.localPath,
    })
    return Response.json({ ok: deleted })
  }

  if (req.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET, DELETE",
      },
    })
  }

  if (!url.pathname.endsWith("/content")) {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }

  try {
    const stored = await attachmentService.readContent({ attachmentId, userId })
    return new Response(stored.bytes, {
      headers: {
        "Content-Type": inferAttachmentResponseContentType(stored.fileName, stored.mimeType),
      },
    })
  } catch {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }
}

async function handleLegacyObjectStorageAttachmentContent(
  req: Request,
  url: URL,
  userId: string,
  objectStorage: ObjectStorageService,
) {
  const prefix = "/api/attachments/"
  if (!url.pathname.startsWith(prefix) || url.pathname.endsWith("/content")) {
    return null
  }

  if (req.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET",
      },
    })
  }

  if (!objectStorage.enabled) {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }

  const objectKey = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!objectKey || !objectStorage.isOwnedObjectKey(objectKey, userId)) {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }

  try {
    const stored = await objectStorage.getAttachment(objectKey)
    const fileName = stored.fileName.replace(/^[\da-f-]{36}-/i, "")
    return new Response(stored.bytes, {
      headers: {
        "Content-Type": inferAttachmentContentType(fileName, stored.mimeType ?? undefined),
      },
    })
  } catch {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }
}

async function handleAttachmentContent(req: Request, url: URL, store: IUserScopedEventStore) {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)\/content$/)
  if (!match) {
    return null
  }

  if (req.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET",
      },
    })
  }

  const project = store.getProject(match[1])
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 })
  }

  const storedName = decodeURIComponent(match[2])
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName === "." || storedName === "..") {
    return Response.json({ error: "Invalid attachment path" }, { status: 400 })
  }

  const filePath = path.join(getProjectUploadDir(project.localPath), storedName)
  const file = Bun.file(filePath)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return Response.json({ error: "Attachment not found" }, { status: 404 })
    }
  } catch {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }

  return new Response(file, {
    headers: {
      "Content-Type": inferAttachmentContentType(storedName, file.type),
    },
  })
}

async function handleProjectFileContent(req: Request, url: URL, store: IUserScopedEventStore) {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/([^/]+)\/content$/)
  if (!match) {
    return null
  }

  if (req.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET",
      },
    })
  }

  const project = store.getProject(match[1])
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 })
  }

  const relativePath = path.posix.normalize(decodeURIComponent(match[2]).replaceAll("\\", "/"))
  if (!relativePath || relativePath === "." || relativePath.startsWith("../") || relativePath.includes("/../") || path.posix.isAbsolute(relativePath)) {
    return Response.json({ error: "Invalid project file path" }, { status: 400 })
  }

  const filePath = path.resolve(project.localPath, relativePath)
  const projectRoot = path.resolve(project.localPath)
  if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${path.sep}`)) {
    return Response.json({ error: "Invalid project file path" }, { status: 400 })
  }

  const file = Bun.file(filePath)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return Response.json({ error: "File not found" }, { status: 404 })
    }
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 })
  }

  return new Response(file, {
    headers: {
      "Content-Type": inferProjectFileContentType(relativePath, file.type),
    },
  })
}

async function handleProjectUploadDelete(req: Request, url: URL, store: IUserScopedEventStore) {
  if (req.method !== "DELETE") {
    return null
  }

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)$/)
  if (!match) {
    return null
  }

  const project = store.getProject(match[1])
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 })
  }

  const storedName = decodeURIComponent(match[2])
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName === "." || storedName === "..") {
    return Response.json({ error: "Invalid attachment path" }, { status: 400 })
  }

  const deleted = await deleteProjectUpload({
    localPath: project.localPath,
    storedName,
  })

  return Response.json({ ok: deleted })
}

async function serveStatic(distDir: string, pathname: string) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname
  const filePath = path.join(distDir, requestedPath)
  const indexPath = path.join(distDir, "index.html")

  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file, {
      headers: getStaticHeaders(requestedPath),
    })
  }

  const indexFile = Bun.file(indexPath)
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  }

  return new Response(
    `${APP_NAME} client bundle not found. Run \`bun run build\` inside workbench/ first.`,
    { status: 503 }
  )
}

function getStaticHeaders(requestedPath: string) {
  if (requestedPath.endsWith(".html")) {
    return {
      "Cache-Control": "no-store",
    }
  }

  return undefined
}
