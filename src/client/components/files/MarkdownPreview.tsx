import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { createMarkdownComponents } from "../messages/shared"
import { cn } from "../../lib/utils"

interface MarkdownPreviewProps {
  content: string
  className?: string
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div className={cn("h-full overflow-auto px-4 py-3", className)}>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <Markdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents()}>
          {content}
        </Markdown>
      </div>
    </div>
  )
}
