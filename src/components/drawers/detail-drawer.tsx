"use client"

import * as React from "react"

import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export type DetailDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  side?: "left" | "right" | "top" | "bottom"
  className?: string
  contentClassName?: string
  showCloseButton?: boolean
}

function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  className,
  contentClassName,
  showCloseButton = true,
}: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn("w-full sm:max-w-lg", contentClassName)}
      >
        <div className={cn("flex h-full min-h-0 flex-col", className)}>
          <SheetHeader className="gap-1 px-4 pt-5 pb-4">
            <SheetTitle className="text-lg">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>

          <Separator />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

          {footer ? (
            <>
              <Separator />
              <SheetFooter className="gap-2 px-4 py-4">{footer}</SheetFooter>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { DetailDrawer }
