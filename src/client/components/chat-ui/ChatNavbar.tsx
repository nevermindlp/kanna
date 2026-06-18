import { Flower, GitBranch, Menu, MessageSquare, PanelLeft, PanelRight, SquarePen, Terminal, Folder } from "lucide-react"
import type { EditorOpenSettings, EditorPreset, OpenExternalAction } from "../../../shared/protocol"
import { Button } from "../ui/button"
import { CardHeader } from "../ui/card"
import { HotkeyTooltip, HotkeyTooltipContent, HotkeyTooltipTrigger } from "../ui/tooltip"
import { Pill, PillBar } from "../ui/pill-bar"
import { cn } from "../../lib/utils"
import { OpenExternalSelect } from "../open-external-menu"
import type { MainContentView } from "../../stores/filesStore"

interface Props {
  sidebarCollapsed: boolean
  onOpenSidebar: () => void
  onExpandSidebar: () => void
  onNewChat: () => void
  localPath?: string
  embeddedTerminalVisible?: boolean
  onToggleEmbeddedTerminal?: () => void
  rightPanel?: "hidden" | "git" | "browser"
  onToggleGitPanel?: () => void
  onOpenExternal?: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
  editorPreset?: EditorPreset
  editorCommandTemplate?: string
  platform?: NodeJS.Platform
  finderShortcut?: string[]
  editorShortcut?: string[]
  terminalShortcut?: string[]
  rightSidebarShortcut?: string[]
  branchName?: string
  hasGitRepo?: boolean
  gitStatus?: "unknown" | "ready" | "no_repo"
  mainView?: MainContentView
  onSetMainView?: (view: MainContentView) => void
  filesTabEnabled?: boolean
  hideExternalOpen?: boolean
}

export function ChatNavbar({
  sidebarCollapsed,
  onOpenSidebar,
  onExpandSidebar,
  onNewChat,
  localPath,
  embeddedTerminalVisible = false,
  onToggleEmbeddedTerminal,
  rightPanel = "hidden",
  onToggleGitPanel,
  onOpenExternal,
  editorPreset = "cursor",
  editorCommandTemplate,
  platform = "darwin",
  finderShortcut,
  editorShortcut,
  terminalShortcut,
  rightSidebarShortcut,
  branchName,
  hasGitRepo = true,
  gitStatus = "unknown",
  mainView = "chat",
  onSetMainView,
  filesTabEnabled = false,
  hideExternalOpen = false,
}: Props) {
  const branchLabel = !hasGitRepo
    ? "Setup Git"
    : gitStatus === "unknown"
      ? null
      : (branchName ?? "Detached HEAD")
  const isMac = platform === "darwin"
  const rightPanelVisible = rightPanel === "git"
  const showWorkspaceToolbar = Boolean(localPath && (onSetMainView || onToggleEmbeddedTerminal || onToggleGitPanel))
  const showExternalOpen = Boolean(onOpenExternal && !hideExternalOpen)

  const handleChatClick = () => {
    onSetMainView?.("chat")
  }

  const handleFilesClick = () => {
    onSetMainView?.("files")
  }

  const handleTerminalClick = () => {
    if (mainView === "files") {
      onSetMainView?.("chat")
    }
    onToggleEmbeddedTerminal?.()
  }

  const handleGitClick = () => {
    onToggleGitPanel?.()
  }

  return (
    <CardHeader
      className={cn(
        "absolute top-0 left-0 right-0 z-10 md:pt-[9px] pl-1 pr-2 border-border/0 flex items-center justify-center",
        "bg-gradient-to-b from-background lg:from-background/0",
      )}
    >
      <div className="absolute top-0 left-0 right-0 z-0 h-[100px] bg-gradient-to-b from-background via-background/50 pointer-events-none block" />
      <div className="relative flex items-center gap-2 w-full">
        <div className={cn(
          "h-[30px] flex items-center gap-0 flex-shrink-0 border border-border/0 rounded-[9px] px-[2px]",
          sidebarCollapsed && "px-1.5 border-border",
        )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden !h-[auto] hover:!border-border/0 hover:!bg-transparent"
            onClick={onOpenSidebar}
          >
            <Menu className="size-4" />
          </Button>
          {sidebarCollapsed ? (
            <>
              <div className="hidden md:flex items-center justify-center w-[36px] h-[36px]">
                <Flower className="h-4 w-4 sm:h-5 sm:w-5 text-logo ml-1 hidden md:block" />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex hover:!border-border/0 hover:!bg-transparent"
                onClick={onExpandSidebar}
                title="Expand sidebar"
              >
                <PanelLeft className="size-4" />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="hover:!border-border/0 hover:!bg-transparent"
            onClick={onNewChat}
            title="Compose"
          >
            <SquarePen className="size-4" />
          </Button>
        </div>

        <div className="flex-1 min-w-0" />

        {showWorkspaceToolbar ? (
          <PillBar className="backdrop-blur-lg">
            {onSetMainView ? (
              <Pill isActive={mainView === "chat" && !embeddedTerminalVisible} onClick={handleChatClick} title="Chat">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Chat</span>
              </Pill>
            ) : null}
            {onSetMainView && filesTabEnabled ? (
              <Pill isActive={mainView === "files"} onClick={handleFilesClick} title="Files">
                <Folder className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Files</span>
              </Pill>
            ) : null}
            {onToggleEmbeddedTerminal ? (
              <HotkeyTooltip>
                <HotkeyTooltipTrigger asChild>
                  <div>
                    <Pill
                      isActive={embeddedTerminalVisible}
                      onClick={handleTerminalClick}
                      title="Terminal"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Terminal</span>
                    </Pill>
                  </div>
                </HotkeyTooltipTrigger>
                <HotkeyTooltipContent side="bottom" shortcut={terminalShortcut} />
              </HotkeyTooltip>
            ) : null}
            {onToggleGitPanel ? (
              <HotkeyTooltip>
                <HotkeyTooltipTrigger asChild>
                  <div>
                    <Pill
                      isActive={rightPanel === "git"}
                      onClick={handleGitClick}
                      title={branchLabel ?? "Git"}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline max-w-[100px] truncate">
                        {branchLabel ?? "Git"}
                      </span>
                    </Pill>
                  </div>
                </HotkeyTooltipTrigger>
                <HotkeyTooltipContent side="bottom" shortcut={rightSidebarShortcut} />
              </HotkeyTooltip>
            ) : null}
          </PillBar>
        ) : null}

        <div className="flex-1 min-w-0" />

        {localPath && (showExternalOpen || rightPanelVisible) ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            {showExternalOpen ? (
              <div className="hidden md:block border border-border/70 rounded-[9px] backdrop-blur-lg">
                <OpenExternalSelect
                  isMac={isMac}
                  editorPreset={editorPreset}
                  editorCommandTemplate={editorCommandTemplate}
                  finderShortcut={finderShortcut}
                  editorShortcut={editorShortcut}
                  onOpenExternal={onOpenExternal!}
                />
              </div>
            ) : null}
            {rightPanelVisible && onToggleGitPanel ? (
              <Button
                variant="ghost"
                size="none"
                onClick={onToggleGitPanel}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="border border-border/0 hover:!border-border/0 px-1.5 h-9 hover:!bg-transparent text-foreground"
              >
                <PanelRight strokeWidth={2.25} className="h-4" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </CardHeader>
  )
}
