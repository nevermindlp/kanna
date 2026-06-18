import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { java } from "@codemirror/lang-java"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { xml } from "@codemirror/lang-xml"
import { yaml } from "@codemirror/lang-yaml"
import { StreamLanguage, type StreamParser } from "@codemirror/language"
import { clike } from "@codemirror/legacy-modes/mode/clike"
import { go } from "@codemirror/legacy-modes/mode/go"
import { rust } from "@codemirror/legacy-modes/mode/rust"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { sql } from "@codemirror/legacy-modes/mode/sql"
import { stex } from "@codemirror/legacy-modes/mode/stex"

const envLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/^#.*/)) return "comment"
    if (stream.sol() && stream.match(/^[A-Za-z_][A-Za-z0-9_.]*(?==)/)) return "variableName.definition"
    if (stream.match(/^=/)) return "operator"
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string"
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string"
    stream.next()
    return null
  },
})

function legacyLanguage(mode: StreamParser<unknown>) {
  return [StreamLanguage.define(mode)]
}

export function getLanguageExtensions(fileName: string) {
  const lowerName = fileName.toLowerCase()
  if (lowerName === ".env" || lowerName.startsWith(".env.")) {
    return [envLanguage]
  }

  const ext = fileName.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return [javascript({ jsx: true, typescript: false })]
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })]
    case "java":
      return [java()]
    case "py":
    case "pyw":
      return [python()]
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return [html()]
    case "css":
    case "scss":
    case "less":
      return [css()]
    case "json":
    case "jsonc":
      return [json()]
    case "md":
    case "markdown":
    case "mdx":
      return [markdown()]
    case "xml":
    case "svg":
    case "xsl":
    case "plist":
      return [xml()]
    case "yaml":
    case "yml":
      return [yaml()]
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return legacyLanguage(shell)
    case "go":
      return legacyLanguage(go)
    case "rs":
      return legacyLanguage(rust)
    case "sql":
      return legacyLanguage(sql)
    case "c":
      return legacyLanguage(clike)
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
      return legacyLanguage(clike)
    case "tex":
    case "latex":
      return legacyLanguage(stex)
    case "dockerfile":
      return legacyLanguage(shell)
    case "gradle":
    case "properties":
      return legacyLanguage(clike)
    default:
      if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
        return legacyLanguage(shell)
      }
      if (lowerName === "makefile" || lowerName === "gmakefile") {
        return legacyLanguage(shell)
      }
      return []
  }
}

export function isMarkdownFileName(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase()
  return ext === "md" || ext === "markdown" || ext === "mdx"
}
