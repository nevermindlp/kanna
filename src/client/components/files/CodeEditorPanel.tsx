import { useCallback, useEffect, useMemo, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { EditorView } from "@codemirror/view"
import { Eye, FileCode2, Download, Loader2, Save, X } from "lucide-react"
import { downloadProjectFile, readProjectFileText, saveProjectFileText } from "../../lib/projectFilesApi"
import { useFilesStore, type EditingFileState } from "../../stores/filesStore"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"
import { getLanguageExtensions, isMarkdownFileName } from "./editorExtensions"
import { getEditorTheme } from "./editorThemes"
import { isBinaryFileName } from "./fileUtils"
import { MarkdownPreview } from "./MarkdownPreview"

type FileViewMode = "edit" | "preview"

interface CodeEditorPanelProps {
  projectId: string
  file: EditingFileState
  isDark: boolean
}

export function CodeEditorPanel({ projectId, file, isDark }: CodeEditorPanelProps) {
  const setEditingFile = useFilesStore((state) => state.setEditingFile)
  const [content, setContent] = useState("")
  const [initialContent, setInitialContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<FileViewMode>("edit")
  const [isDownloading, setIsDownloading] = useState(false)
  const isBinary = isBinaryFileName(file.name)
  const isMarkdown = isMarkdownFileName(file.name)
  const isDirty = content !== initialContent

  useEffect(() => {
    setViewMode("edit")
  }, [file.path])

  useEffect(() => {
    if (isBinary) {
      setLoading(false)
      return
    }

    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const text = await readProjectFileText(projectId, file.path, controller.signal)
        if (!active) return
        setContent(text)
        setInitialContent(text)
      } catch (loadError) {
        if ((loadError as { name?: string }).name === "AbortError") return
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : "Failed to load file")
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [file.path, file.name, isBinary, projectId])

  const extensions = useMemo(() => [
    ...getLanguageExtensions(file.name),
    EditorView.lineWrapping,
  ], [file.name])

  const editorTheme = useMemo(() => getEditorTheme(isDark), [isDark])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveMessage(null)
    setError(null)
    try {
      await saveProjectFileText(projectId, file.path, content)
      setInitialContent(content)
      setSaveMessage("Saved")
      window.setTimeout(() => setSaveMessage(null), 1500)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }, [content, file.path, projectId])

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    setError(null)
    try {
      await downloadProjectFile(projectId, file.path, file.name)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Download failed")
    } finally {
      setIsDownloading(false)
    }
  }, [file.name, file.path, projectId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!isBinary && !loading && !saving && viewMode === "edit") {
          void handleSave()
        }
      }
      if (event.key === "Escape") {
        setEditingFile(projectId, null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleSave, isBinary, loading, projectId, saving, setEditingFile, viewMode])

  return (
    <div className="kanna-file-editor flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</div>
        {isMarkdown ? (
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
            <Button
              type="button"
              variant={viewMode === "edit" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("edit")}
            >
              <FileCode2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === "preview" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("preview")}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </Button>
          </div>
        ) : null}
        {isDirty ? <span className="text-xs text-amber-500">Unsaved</span> : null}
        {saveMessage ? <span className="text-xs text-emerald-500">{saveMessage}</span> : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={loading || isDownloading}
          onClick={() => void handleDownload()}
          title="Download file"
          className="h-8 px-2"
        >
          {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
        {!isBinary && viewMode === "edit" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || saving || !isDirty}
            onClick={() => void handleSave()}
            className="h-8 px-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditingFile(projectId, null)}
          className="h-8 px-2"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : isBinary ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <p>Binary file preview is not available in the editor.</p>
            <Button
              variant="secondary"
              size="sm"
              disabled={isDownloading}
              onClick={() => void handleDownload()}
            >
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download file
            </Button>
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : viewMode === "preview" && isMarkdown ? (
          <MarkdownPreview content={content} />
        ) : (
          <CodeMirror
            value={content}
            height="100%"
            theme={editorTheme}
            extensions={extensions}
            onChange={(value) => setContent(value)}
            className={cn(
              "h-full text-sm",
              "[&_.cm-editor]:h-full",
              "[&_.cm-scroller]:min-h-full",
              "[&_.cm-content]:font-mono",
            )}
          />
        )}
      </div>
    </div>
  )
}
