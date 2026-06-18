import { githubDark, githubLight } from "@uiw/codemirror-theme-github"

export function getEditorTheme(isDark: boolean) {
  return isDark ? githubDark : githubLight
}
