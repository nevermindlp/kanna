import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import {
  ChevronRight,
  ClipboardCopy,
  Download,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react"
import type { ProjectFileTreeNode } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { useProjectFilesState, useFilesStore } from "../../stores/filesStore"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu"
import { FileTreeHeader } from "./FileTreeHeader"
import { collectExpandedDirectoryPaths } from "./fileTreeUtils"
import { useFileTreeSearch } from "./hooks/useFileTreeSearch"
import { useFileTreeOperations } from "./hooks/useFileTreeOperations"
import { useFileTreeUpload } from "./hooks/useFileTreeUpload"
import { useFileTreeDownload } from "./hooks/useFileTreeDownload"

interface InlineNameRowProps {
  depth: number
  type: "file" | "directory"
  initialName: string
  isBusy: boolean
  error: string | null
  placeholder: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

function InlineNameRow({
  depth,
  type,
  initialName,
  isBusy,
  error,
  placeholder,
  onConfirm,
  onCancel,
}: InlineNameRowProps) {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      void onConfirm(name)
    } else if (event.key === "Escape") {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="px-2 py-1">
      <div className="flex items-center gap-1.5">
        {type === "directory" ? (
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!name.trim()) onCancel()
          }}
          disabled={isBusy}
          placeholder={placeholder}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {error ? <div className="mt-1 px-6 text-xs text-destructive">{error}</div> : null}
    </div>
  )
}

interface FileTreeNodeProps {
  projectId: string
  node: ProjectFileTreeNode
  depth: number
  onFileOpen: (path: string, name: string) => void
  creatingAtPath: string | null
  creatingType: "file" | "directory" | null
  isCreating: boolean
  createError: string | null
  onConfirmCreate: (name: string) => void
  onCancelCreate: () => void
  renamingPath: string | null
  isRenaming: boolean
  renameError: string | null
  onConfirmRename: (name: string) => void
  onCancelRename: () => void
  onStartRename: (node: ProjectFileTreeNode) => void
  onDelete: (node: ProjectFileTreeNode) => void
  onCopyPath: (path: string) => void
  onDownloadFile: (path: string, name: string) => void
  onDownloadFolder: (node: ProjectFileTreeNode) => void
  downloadingPath: string | null
  isDeleting: boolean
  onStartCreateInFolder: (parentPath: string, type: "file" | "directory") => void
  onUploadToFolder: (folderPath: string) => void
  dropTargetPath: string | null
  onFolderDragOver: (event: React.DragEvent, folderPath: string) => void
  onFolderDragLeave: (event: React.DragEvent) => void
  onFolderDrop: (event: React.DragEvent, folderPath: string) => void
}

function FileTreeNodeRow({
  projectId,
  node,
  depth,
  onFileOpen,
  creatingAtPath,
  creatingType,
  isCreating,
  createError,
  onConfirmCreate,
  onCancelCreate,
  renamingPath,
  isRenaming,
  renameError,
  onConfirmRename,
  onCancelRename,
  onStartRename,
  onDelete,
  onCopyPath,
  onDownloadFile,
  onDownloadFolder,
  downloadingPath,
  isDeleting,
  onStartCreateInFolder,
  onUploadToFolder,
  dropTargetPath,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
}: FileTreeNodeProps) {
  const { expandedDirs, editingFile } = useProjectFilesState(projectId)
  const toggleExpandedDir = useFilesStore((state) => state.toggleExpandedDir)
  const expanded = expandedDirs[node.path] ?? depth < 1
  const isSelected = editingFile?.path === node.path
  const showCreateRow = creatingAtPath === node.path && node.type === "directory"
  const isRenamingThis = renamingPath === node.path
  const isDropTarget = dropTargetPath === node.path
  const isDownloading = downloadingPath === node.path

  if (node.type === "directory") {
    if (isRenamingThis) {
      return (
        <InlineNameRow
          depth={depth}
          type="directory"
          initialName={node.name}
          isBusy={isRenaming}
          error={renameError}
          placeholder="Folder name"
          onConfirm={(name) => void onConfirmRename(name)}
          onCancel={onCancelRename}
        />
      )
    }

    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={() => toggleExpandedDir(projectId, node.path)}
              onDragOver={(event) => onFolderDragOver(event, node.path)}
              onDragLeave={onFolderDragLeave}
              onDrop={(event) => onFolderDrop(event, node.path)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70",
                isSelected && "bg-muted",
                isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/40",
              )}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
              {expanded ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onStartCreateInFolder(node.path, "file")
              }}
            >
              <FilePlus className="h-3.5 w-3.5" />
              New file
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onStartCreateInFolder(node.path, "directory")
              }}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onUploadToFolder(node.path)
              }}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload here
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isRenaming || isDeleting}
              onSelect={(event) => {
                event.preventDefault()
                onStartRename(node)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isDeleting}
              className="text-destructive focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault()
                void onDelete(node)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void onCopyPath(node.path)
              }}
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copy path
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isDownloading}
              onSelect={(event) => {
                event.preventDefault()
                void onDownloadFolder(node)
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download as ZIP
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {expanded && showCreateRow && creatingType ? (
          <InlineNameRow
            depth={depth + 1}
            type={creatingType}
            initialName=""
            isBusy={isCreating}
            error={createError}
            placeholder={creatingType === "directory" ? "Folder name" : "File name"}
            onConfirm={(name) => void onConfirmCreate(name)}
            onCancel={onCancelCreate}
          />
        ) : null}
        {expanded && node.children?.map((child) => (
          <FileTreeNodeRow
            key={child.path}
            projectId={projectId}
            node={child}
            depth={depth + 1}
            onFileOpen={onFileOpen}
            creatingAtPath={creatingAtPath}
            creatingType={creatingType}
            isCreating={isCreating}
            createError={createError}
            onConfirmCreate={onConfirmCreate}
            onCancelCreate={onCancelCreate}
            renamingPath={renamingPath}
            isRenaming={isRenaming}
            renameError={renameError}
            onConfirmRename={onConfirmRename}
            onCancelRename={onCancelRename}
            onStartRename={onStartRename}
            onDelete={onDelete}
            onCopyPath={onCopyPath}
            onDownloadFile={onDownloadFile}
            onDownloadFolder={onDownloadFolder}
            downloadingPath={downloadingPath}
            isDeleting={isDeleting}
            onStartCreateInFolder={onStartCreateInFolder}
            onUploadToFolder={onUploadToFolder}
            dropTargetPath={dropTargetPath}
            onFolderDragOver={onFolderDragOver}
            onFolderDragLeave={onFolderDragLeave}
            onFolderDrop={onFolderDrop}
          />
        ))}
      </div>
    )
  }

  if (isRenamingThis) {
    return (
      <InlineNameRow
        depth={depth}
        type="file"
        initialName={node.name}
        isBusy={isRenaming}
        error={renameError}
        placeholder="File name"
        onConfirm={(name) => void onConfirmRename(name)}
        onCancel={onCancelRename}
      />
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onFileOpen(node.path, node.name)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70",
            isSelected && "bg-muted",
          )}
          style={{ paddingLeft: `${depth * 12 + 24}px` }}
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isRenaming || isDeleting}
          onSelect={(event) => {
            event.preventDefault()
            onStartRename(node)
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isDeleting}
          className="text-destructive focus:text-destructive"
          onSelect={(event) => {
            event.preventDefault()
            void onDelete(node)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            void onCopyPath(node.path)
          }}
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
          Copy path
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isDownloading}
          onSelect={(event) => {
            event.preventDefault()
            void onDownloadFile(node.path, node.name)
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface FileTreeProps {
  projectId: string
  projectRootPath: string
  files: ProjectFileTreeNode[]
  loading: boolean
  onRefresh: () => void
}

export function FileTree({ projectId, projectRootPath, files, loading, onRefresh }: FileTreeProps) {
  const setEditingFile = useFilesStore((state) => state.setEditingFile)
  const setExpandedDirs = useFilesStore((state) => state.setExpandedDirs)
  const { editingFile } = useProjectFilesState(projectId)
  const { searchQuery, setSearchQuery, filteredFiles, clearSearch, isSearching } = useFileTreeSearch(projectId, files)

  const handleRenamed = useCallback((args: {
    oldPath: string
    newPath: string
    newName: string
    type: "file" | "directory"
  }) => {
    if (editingFile?.path === args.oldPath && args.type === "file") {
      setEditingFile(projectId, { projectId, path: args.newPath, name: args.newName })
    }
  }, [editingFile?.path, projectId, setEditingFile])

  const handleDeleted = useCallback((path: string) => {
    if (editingFile?.path === path) {
      setEditingFile(projectId, null)
    }
  }, [editingFile?.path, projectId, setEditingFile])

  const {
    creatingNode,
    renamingNode,
    isCreating,
    isRenaming,
    isDeleting,
    createError,
    renameError,
    startCreate,
    cancelCreate,
    confirmCreate,
    startRename,
    cancelRename,
    confirmRename,
    deleteNode,
    copyPath,
  } = useFileTreeOperations(projectId, onRefresh, {
    onRenamed: handleRenamed,
    onDeleted: handleDeleted,
  })

  const {
    fileInputRef,
    folderInputRef,
    isUploading,
    uploadError,
    isDragOver,
    dropTargetPath,
    handleFileInputChange,
    handleFolderInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    openFilePicker,
    openFolderPicker,
  } = useFileTreeUpload(projectId, onRefresh)

  const {
    downloadingPath,
    downloadError,
    downloadFile,
    downloadFolder,
    clearDownloadError,
  } = useFileTreeDownload(projectId)

  const handleFileOpen = useCallback((path: string, name: string) => {
    setEditingFile(projectId, { projectId, path, name })
  }, [projectId, setEditingFile])

  const beginCreate = useCallback((parentPath: string, type: "file" | "directory") => {
    if (isSearching) {
      clearSearch()
    }
    setExpandedDirs(projectId, { [parentPath]: true })
    startCreate(parentPath, type)
  }, [clearSearch, isSearching, projectId, setExpandedDirs, startCreate])

  const handleNewFile = useCallback(() => {
    beginCreate(projectRootPath, "file")
  }, [beginCreate, projectRootPath])

  const handleNewFolder = useCallback(() => {
    beginCreate(projectRootPath, "directory")
  }, [beginCreate, projectRootPath])

  const handleStartCreateInFolder = useCallback((parentPath: string, type: "file" | "directory") => {
    beginCreate(parentPath, type)
  }, [beginCreate])

  const handleCollapseAll = useCallback(() => {
    const dirPaths = new Set(collectExpandedDirectoryPaths(files))
    for (const node of files) {
      if (node.type === "directory") {
        dirPaths.add(node.path)
      }
    }
    const collapsed = Object.fromEntries([...dirPaths].map((path) => [path, false]))
    setExpandedDirs(projectId, collapsed)
  }, [files, projectId, setExpandedDirs])

  const handleUploadToFolder = useCallback((folderPath: string) => {
    openFilePicker(folderPath)
  }, [openFilePicker])

  const creatingAtPath = creatingNode?.parentPath ?? null
  const creatingType = creatingNode?.type ?? null
  const renamingPath = renamingNode?.path ?? null
  const displayFiles = isSearching ? filteredFiles : files
  const showRootCreateRow = creatingAtPath === projectRootPath

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-border/60 bg-background",
        isDragOver && !dropTargetPath && "ring-2 ring-inset ring-primary/40",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={handleFolderInputChange}
      />

      <FileTreeHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClearSearch={clearSearch}
        onRefresh={onRefresh}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onUploadFiles={() => openFilePicker("")}
        onUploadFolder={() => openFolderPicker("")}
        onCollapseAll={handleCollapseAll}
        loading={loading}
        isUploading={isUploading}
      />

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {uploadError ? (
          <div className="mx-2 mb-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{uploadError}</div>
        ) : null}
        {downloadError ? (
          <div className="mx-2 mb-2 flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            <span>{downloadError}</span>
            <button type="button" onClick={clearDownloadError} className="shrink-0 hover:underline">
              Dismiss
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading files...
          </div>
        ) : displayFiles.length === 0 ? (
          <div className="px-3 py-8 text-sm text-muted-foreground">
            {isSearching ? "No matching files." : "No files found."}
          </div>
        ) : (
          <>
            {showRootCreateRow && creatingType ? (
              <InlineNameRow
                depth={0}
                type={creatingType}
                initialName=""
                isBusy={isCreating}
                error={createError}
                placeholder={creatingType === "directory" ? "Folder name" : "File name"}
                onConfirm={(name) => void confirmCreate(name)}
                onCancel={cancelCreate}
              />
            ) : null}
            {displayFiles.map((node) => (
              <FileTreeNodeRow
                key={node.path}
                projectId={projectId}
                node={node}
                depth={0}
                onFileOpen={handleFileOpen}
                creatingAtPath={creatingAtPath}
                creatingType={creatingType}
                isCreating={isCreating}
                createError={createError}
                onConfirmCreate={(name) => void confirmCreate(name)}
                onCancelCreate={cancelCreate}
                renamingPath={renamingPath}
                isRenaming={isRenaming}
                renameError={renameError}
                onConfirmRename={(name) => void confirmRename(name)}
                onCancelRename={cancelRename}
                onStartRename={startRename}
                onDelete={deleteNode}
                onCopyPath={copyPath}
                onDownloadFile={(path, name) => void downloadFile(path, name)}
                onDownloadFolder={(folder) => void downloadFolder(folder)}
                downloadingPath={downloadingPath}
                isDeleting={isDeleting}
                onStartCreateInFolder={handleStartCreateInFolder}
                onUploadToFolder={handleUploadToFolder}
                dropTargetPath={dropTargetPath}
                onFolderDragOver={handleFolderDragOver}
                onFolderDragLeave={handleFolderDragLeave}
                onFolderDrop={handleFolderDrop}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
