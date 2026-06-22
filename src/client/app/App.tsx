import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom"
import { Flower } from "lucide-react"
import { StandaloneShareDialog } from "../components/chat-ui/StandaloneShareDialog"
import { AppDialogProvider } from "../components/ui/app-dialog"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { TooltipProvider } from "../components/ui/tooltip"
import { APP_NAME, SDK_CLIENT_APP } from "../../shared/branding"
import { useChatSoundPreferencesStore } from "../stores/chatSoundPreferencesStore"
import type { ChatSoundPreference } from "../stores/chatSoundPreferencesStore"
import { playChatNotificationSound, shouldPlayChatSound } from "../lib/chatSounds"
import { getChatSoundBurstCount, getNotificationTitleCount } from "./chatNotifications"
import { KannaSidebar } from "./KannaSidebar"
import { ChatPage } from "./ChatPage"
import { LocalProjectsPage } from "./LocalProjectsPage"
import { SettingsPage } from "./SettingsPage"
import { useKannaState } from "./useKannaState"
import type { AppSettingsSnapshot } from "../../shared/types"

const VERSION_SEEN_STORAGE_KEY = "kanna:last-seen-version"
const AUTH_STATUS_RETRY_DELAY_MS = 500

interface AuthStatusResponse {
  enabled: boolean
  authenticated: boolean
  mode?: "single" | "multiuser"
  username?: string
  updatesEnabled?: boolean
}

type AppAuthState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "locked"; error: string | null }

export function getAppAuthStateFromStatus(payload: Partial<AuthStatusResponse>): AppAuthState {
  if (!payload.enabled || payload.authenticated) {
    return { status: "ready" }
  }

  return { status: "locked", error: null }
}

export function shouldRetryAuthStatusRequest(responseOk: boolean | null) {
  return responseOk !== true
}

function LoginScreen({
  mode,
  error,
  onLogin,
  onRegister,
}: {
  mode: "single" | "multiuser"
  error: string | null
  onLogin: (username: string, password: string) => Promise<void>
  onRegister?: (username: string, password: string) => Promise<void>
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [isRegister, setIsRegister] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || submitting) return
    if (mode === "multiuser" && !username.trim()) return
    setSubmitting(true)
    try {
      if (isRegister && onRegister) {
        await onRegister(username.trim(), password)
      } else {
        await onLogin(mode === "multiuser" ? username.trim() : "", password)
      }
      setPassword("")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md rounded-3xl border border-border bg-card shadow-sm">
        <CardHeader className="flex flex-col p-2 space-y-3 px-6 pt-6 pb-5 pl-[28px]">
          <div className="flex items-center gap-3">
            <Flower className="h-5 w-5 text-logo" />
            <div>
              <CardTitle className="font-logo text-xl uppercase text-slate-600 dark:text-slate-100">{APP_NAME}</CardTitle>
            </div>
          </div>
          <CardDescription className="leading-6">
            {mode === "multiuser"
              ? (isRegister ? "Create an account to continue." : "Sign in to continue.")
              : "Enter your password to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {error ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-foreground">
                {error}
              </div>
            ) : null}
            {mode === "multiuser" ? (
              <Input
                id="kanna-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username"
                disabled={submitting}
                className="h-11 rounded-2xl bg-background"
              />
            ) : null}
            <Input
              id="kanna-password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              disabled={submitting}
              className="h-11 rounded-2xl bg-background"
            />
            <Button
              type="submit"
              disabled={submitting || password.length === 0 || (mode === "multiuser" && username.trim().length === 0)}
              className="h-11 w-full"
            >
              {submitting ? "Working..." : isRegister ? "Create account" : mode === "multiuser" ? "Sign in" : "Unlock"}
            </Button>
            {mode === "multiuser" && onRegister ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={submitting}
                onClick={() => setIsRegister((current) => !current)}
              >
                {isRegister ? "Already have an account? Sign in" : "Need an account? Register"}
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function PasswordScreen({
  error,
  onSubmit,
}: {
  error: string | null
  onSubmit: (password: string) => Promise<void>
}) {
  return (
    <LoginScreen
      mode="single"
      error={error}
      onLogin={async (_username, password) => onSubmit(password)}
    />
  )
}

function useAppAuthState() {
  const [state, setState] = useState<AppAuthState>({ status: "checking" })
  const [authMode, setAuthMode] = useState<"single" | "multiuser">("single")
  const [updatesEnabled, setUpdatesEnabled] = useState(true)
  const retryTimeoutRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    setState((current) => current.status === "ready" ? current : { status: "checking" })

    let response: Response
    try {
      response = await fetch("/auth/status", {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      })
    } catch {
      retryTimeoutRef.current = window.setTimeout(() => {
        void refresh()
      }, AUTH_STATUS_RETRY_DELAY_MS)
      return
    }

    if (shouldRetryAuthStatusRequest(response.ok)) {
      retryTimeoutRef.current = window.setTimeout(() => {
        void refresh()
      }, AUTH_STATUS_RETRY_DELAY_MS)
      return
    }

    const payload = await response.json() as Partial<AuthStatusResponse>
    setAuthMode(payload.mode === "multiuser" ? "multiuser" : "single")
    setUpdatesEnabled(payload.updatesEnabled !== false)
    setState(getAppAuthStateFromStatus(payload))
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [refresh])

  const submitLogin = useCallback(async (username: string, password: string) => {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        username: username || undefined,
        password,
        next: window.location.pathname + window.location.search,
      }),
    })

    if (!response.ok) {
      setState({ status: "locked", error: authMode === "multiuser" ? "Invalid username or password." : "Incorrect password. Try again." })
      return
    }

    await refresh()
  }, [authMode, refresh])

  const submitRegister = useCallback(async (username: string, password: string) => {
    const response = await fetch("/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      setState({ status: "locked", error: payload?.error ?? "Registration failed." })
      return
    }

    await refresh()
  }, [refresh])

  const submitPassword = useCallback(async (password: string) => {
    await submitLogin("", password)
  }, [submitLogin])

  return {
    state,
    authMode,
    updatesEnabled,
    submitPassword,
    submitLogin,
    submitRegister,
  }
}

export function shouldRedirectToChangelog(
  pathname: string,
  currentVersion: string,
  seenVersion: string | null,
  updatesEnabled = true,
) {
  if (!updatesEnabled) return false
  return pathname === "/" && Boolean(currentVersion) && seenVersion !== currentVersion
}

export function shouldPlayChatNotificationSound(
  appSettings: AppSettingsSnapshot | null,
  preference: ChatSoundPreference,
  doc: Pick<Document, "visibilityState" | "hasFocus"> = document
) {
  return Boolean(appSettings) && shouldPlayChatSound(preference, doc)
}

function KannaLayout({ updatesEnabled }: { updatesEnabled: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const state = useKannaState(params.chatId ?? null, updatesEnabled)
  const chatSoundPreference = useChatSoundPreferencesStore((store) => store.chatSoundPreference)
  const chatSoundId = useChatSoundPreferencesStore((store) => store.chatSoundId)
  const showMobileOpenButton = location.pathname === "/"
  const currentVersion = SDK_CLIENT_APP.split("/")[1] ?? "unknown"
  const previousSidebarDataRef = useRef<ReturnType<typeof useKannaState>["sidebarData"] | null>(null)
  const handleSidebarCreateChat = useCallback((projectId: string) => {
    void state.handleCreateChat(projectId)
  }, [state.handleCreateChat])
  const handleSidebarForkChat = useCallback((chat: Parameters<typeof state.handleForkChat>[0]) => {
    void state.handleForkChat(chat)
  }, [state.handleForkChat])
  const handleSidebarRenameChat = useCallback((chat: Parameters<typeof state.handleRenameChat>[0]) => {
    void state.handleRenameChat(chat)
  }, [state.handleRenameChat])
  const handleSidebarRenameProject = useCallback((projectId: string, sidebarTitle: string | undefined, realTitle: string) => {
    void state.handleRenameProject(projectId, sidebarTitle, realTitle)
  }, [state.handleRenameProject])
  const handleSidebarShareChat = useCallback((chatId: string) => {
    void state.handleShareChat(chatId)
  }, [state.handleShareChat])
  const handleSidebarArchiveChat = useCallback((chat: Parameters<typeof state.handleArchiveChat>[0]) => {
    void state.handleArchiveChat(chat)
  }, [state.handleArchiveChat])
  const handleOpenArchivedChat = useCallback((chatId: string) => {
    void state.handleOpenArchivedChat(chatId)
  }, [state.handleOpenArchivedChat])
  const handleOpenAddProjectModal = useCallback(() => {
    state.openAddProjectModal()
  }, [state])
  const handleSidebarDeleteChat = useCallback((chat: Parameters<typeof state.handleDeleteChat>[0]) => {
    void state.handleDeleteChat(chat)
  }, [state.handleDeleteChat])
  const handleSidebarCopyPath = useCallback((localPath: string) => {
    void state.handleCopyPath(localPath)
  }, [state.handleCopyPath])
  const handleSidebarOpenExternalPath = useCallback((action: "open_finder" | "open_editor", localPath: string) => {
    void state.handleOpenExternalPath(action, localPath)
  }, [state.handleOpenExternalPath])
  const handleSidebarHideProject = useCallback((projectId: string) => {
    void state.handleHideProject(projectId)
  }, [state.handleHideProject])
  const handleSidebarReorderProjectGroups = useCallback((projectIds: string[]) => {
    void state.handleReorderProjectGroups(projectIds)
  }, [state.handleReorderProjectGroups])
  const handleOpenChangelog = useCallback(() => {
    navigate("/settings/changelog")
  }, [navigate])
  const sidebarElement = useMemo(() => (
    <KannaSidebar
      data={state.sidebarData}
      activeChatId={state.activeChatId}
      connectionStatus={state.connectionStatus}
      ready={state.sidebarReady}
      open={state.sidebarOpen}
      collapsed={state.sidebarCollapsed}
      showMobileOpenButton={showMobileOpenButton}
      onOpen={state.openSidebar}
      onClose={state.closeSidebar}
      onCollapse={state.collapseSidebar}
      onExpand={state.expandSidebar}
      onCreateChat={handleSidebarCreateChat}
      onForkChat={handleSidebarForkChat}
      currentProjectId={state.activeProjectId}
      keybindings={state.keybindings}
      onRenameChat={handleSidebarRenameChat}
      onShareChat={handleSidebarShareChat}
      onArchiveChat={handleSidebarArchiveChat}
      onOpenArchivedChat={handleOpenArchivedChat}
      onDeleteChat={handleSidebarDeleteChat}
      onOpenAddProjectModal={handleOpenAddProjectModal}
      onCopyPath={handleSidebarCopyPath}
      onOpenExternalPath={handleSidebarOpenExternalPath}
      onRenameProject={handleSidebarRenameProject}
      onHideProject={handleSidebarHideProject}
      onReorderProjectGroups={handleSidebarReorderProjectGroups}
      editorLabel={state.editorLabel}
      updatesEnabled={updatesEnabled}
      updateSnapshot={state.updateSnapshot}
      onOpenChangelog={handleOpenChangelog}
    />
  ), [
    handleOpenChangelog,
    handleOpenAddProjectModal,
    handleSidebarCopyPath,
    handleSidebarCreateChat,
    handleSidebarArchiveChat,
    handleSidebarDeleteChat,
    handleOpenArchivedChat,
    handleSidebarForkChat,
    handleSidebarOpenExternalPath,
    handleSidebarRenameProject,
    handleSidebarRenameChat,
    handleSidebarShareChat,
    handleSidebarReorderProjectGroups,
    handleSidebarHideProject,
    showMobileOpenButton,
    state.activeChatId,
    state.activeProjectId,
    state.keybindings,
    state.closeSidebar,
    state.collapseSidebar,
    state.connectionStatus,
    state.editorLabel,
    state.expandSidebar,
    state.openSidebar,
    state.sidebarCollapsed,
    state.sidebarData,
    state.sidebarOpen,
    state.sidebarReady,
    state.updateSnapshot,
    updatesEnabled,
  ])

  useEffect(() => {
    const seenVersion = window.localStorage.getItem(VERSION_SEEN_STORAGE_KEY)
    const shouldRedirect = shouldRedirectToChangelog(location.pathname, currentVersion, seenVersion, updatesEnabled)
    window.localStorage.setItem(VERSION_SEEN_STORAGE_KEY, currentVersion)
    if (!shouldRedirect) return
    navigate("/settings/changelog", { replace: true })
  }, [currentVersion, location.pathname, navigate, updatesEnabled])

  useLayoutEffect(() => {
    document.title = APP_NAME
  }, [location.key])

  useEffect(() => {
    function handlePageShow() {
      document.title = APP_NAME
    }

    function handlePageHide() {
      document.title = APP_NAME
    }

    window.addEventListener("pageshow", handlePageShow)
    window.addEventListener("pagehide", handlePageHide)
    return () => {
      window.removeEventListener("pageshow", handlePageShow)
      window.removeEventListener("pagehide", handlePageHide)
    }
  }, [])

  useEffect(() => {
    const notificationCount = getNotificationTitleCount(state.sidebarData)
    document.title = notificationCount > 0 ? `[${notificationCount}] ${APP_NAME}` : APP_NAME
  }, [state.sidebarData])

  useEffect(() => {
    const burstCount = getChatSoundBurstCount(previousSidebarDataRef.current, state.sidebarData)
    previousSidebarDataRef.current = state.sidebarData

    if (burstCount <= 0) return
    if (!shouldPlayChatNotificationSound(state.appSettings, chatSoundPreference)) return

    void playChatNotificationSound(chatSoundId, burstCount).catch(() => undefined)
  }, [chatSoundId, chatSoundPreference, state.appSettings, state.sidebarData])

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden">
      {sidebarElement}
      <Outlet context={state} />
      <StandaloneShareDialog
        open={Boolean(state.standaloneShareUrl)}
        shareUrl={state.standaloneShareUrl ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            state.handleCloseStandaloneShareDialog()
          }
        }}
        onOpenLink={state.handleOpenStandaloneShareLink}
        onCopyLink={state.handleCopyStandaloneShareLink}
      />
    </div>
  )
}

export function App() {
  const auth = useAppAuthState()

  if (auth.state.status === "checking") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
        Checking session…
      </div>
    )
  }

  if (auth.state.status === "locked") {
    if (auth.authMode === "multiuser") {
      return (
        <LoginScreen
          mode="multiuser"
          error={auth.state.error}
          onLogin={auth.submitLogin}
          onRegister={auth.submitRegister}
        />
      )
    }
    return <PasswordScreen error={auth.state.error} onSubmit={auth.submitPassword} />
  }

  return (
    <TooltipProvider>
      <AppDialogProvider>
        <Routes>
          <Route element={<KannaLayout updatesEnabled={auth.updatesEnabled} />}>
            <Route path="/" element={<LocalProjectsPage />} />
            <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
            <Route path="/settings/:sectionId" element={<SettingsPage />} />
            <Route path="/chat/:chatId" element={<ChatPage />} />
          </Route>
        </Routes>
      </AppDialogProvider>
    </TooltipProvider>
  )
}
