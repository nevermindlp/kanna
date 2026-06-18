import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

type PillBarProps = {
  children: ReactNode
  className?: string
}

export function PillBar({ children, className }: PillBarProps) {
  return (
    <div className={cn("inline-flex items-center gap-[2px] rounded-lg bg-muted/60 p-[3px]", className)}>
      {children}
    </div>
  )
}

type PillProps = {
  isActive: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  title?: string
  disabled?: boolean
}

export function Pill({ isActive, onClick, children, className, title, disabled }: PillProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex touch-manipulation items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-150 sm:px-3 sm:py-2 sm:text-sm",
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground active:bg-background/50",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {children}
    </button>
  )
}
