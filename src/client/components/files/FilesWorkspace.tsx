import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { useFileTreeData } from "./hooks/useFileTreeData"
import { FileTree } from "./FileTree"
import { CodeEditorPanel } from "./CodeEditorPanel"
import { useProjectFilesState, useFilesStore } from "../../stores/filesStore"

interface FilesWorkspaceProps {
  projectId: string
  projectRootPath: string
  isDark: boolean
}

export function FilesWorkspace({ projectId, projectRootPath, isDark }: FilesWorkspaceProps) {
  const { files, loading, refreshFiles } = useFileTreeData(projectId)
  const { editingFile, editorWidth } = useProjectFilesState(projectId)
  const setEditorWidth = useFilesStore((state) => state.setEditorWidth)
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const nextWidth = rect.right - event.clientX
      const maxWidth = rect.width * 0.85
      if (nextWidth >= 320 && nextWidth <= maxWidth) {
        setEditorWidth(projectId, nextWidth)
      }
    }

    const handleMouseUp = () => setIsResizing(false)

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isResizing, projectId, setEditorWidth])

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 pt-[52px]">
      <div className="w-64 shrink-0 min-h-0">
        <FileTree
          projectId={projectId}
          projectRootPath={projectRootPath}
          files={files}
          loading={loading}
          onRefresh={refreshFiles}
        />
      </div>

      {editingFile ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleResizeStart}
            className="w-1 shrink-0 cursor-col-resize bg-border/40 hover:bg-border"
          />
          <div className="min-h-0 min-w-0" style={{ width: editorWidth, flex: "1 1 auto" }}>
            <CodeEditorPanel projectId={projectId} file={editingFile} isDark={isDark} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a file to preview or edit.
        </div>
      )}
    </div>
  )
}
