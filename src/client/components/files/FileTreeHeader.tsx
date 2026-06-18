import { ChevronsDownUp, FilePlus, FolderPlus, FolderUp, Loader2, RefreshCw, Search, Upload, X } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { cn } from "../../lib/utils"

interface FileTreeHeaderProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onRefresh: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onUploadFiles: () => void
  onUploadFolder: () => void
  onCollapseAll: () => void
  loading?: boolean
  isUploading?: boolean
}

export function FileTreeHeader({
  searchQuery,
  onSearchChange,
  onClearSearch,
  onRefresh,
  onNewFile,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
  onCollapseAll,
  loading = false,
  isUploading = false,
}: FileTreeHeaderProps) {
  const busy = loading || isUploading

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-2 py-2">
      <div className="flex items-center justify-between gap-1">
        <div className="text-sm font-medium">Files</div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Upload files"
            disabled={busy}
            onClick={onUploadFiles}
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Upload folder"
            disabled={busy}
            onClick={onUploadFolder}
          >
            <FolderUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="New file at project root"
            disabled={busy}
            onClick={onNewFile}
          >
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="New folder at project root"
            disabled={busy}
            onClick={onNewFolder}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Collapse all folders"
            disabled={busy}
            onClick={onCollapseAll}
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Refresh"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search files..."
          className="h-8 pl-8 pr-8 text-xs"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={onClearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
