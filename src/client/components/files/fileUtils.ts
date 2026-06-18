const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg",
  "pdf", "zip", "gz", "tar", "7z", "rar",
  "mp3", "mp4", "wav", "mov", "avi", "mkv",
  "woff", "woff2", "ttf", "eot", "otf",
  "exe", "dll", "so", "dylib", "bin", "class", "jar",
  "sqlite", "db", "pyc", "o", "a",
])

export function isBinaryFileName(fileName: string) {
  const lower = fileName.toLowerCase()
  if (lower === ".env" || lower.startsWith(".env.")) {
    return false
  }
  const ext = lower.split(".").pop() ?? ""
  return BINARY_EXTENSIONS.has(ext)
}

export function isImageFileName(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  return ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg"].includes(ext)
}

export function formatFileSize(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
