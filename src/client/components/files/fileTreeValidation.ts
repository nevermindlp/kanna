const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

export function validateFilename(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return "Name is required"
  }
  if (INVALID_FILENAME_CHARS.test(trimmed)) {
    return "Name contains invalid characters"
  }
  if (RESERVED_NAMES.test(trimmed)) {
    return "Name is reserved"
  }
  if (/^\.+$/.test(trimmed)) {
    return "Name cannot be only dots"
  }
  return null
}

export function resolveRenamedPath(oldPath: string, newName: string): string {
  const separatorIndex = Math.max(oldPath.lastIndexOf("/"), oldPath.lastIndexOf("\\"))
  if (separatorIndex === -1) {
    return newName
  }
  return `${oldPath.slice(0, separatorIndex)}/${newName}`
}
