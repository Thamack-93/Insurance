"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export type ConfirmDialogProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  triggerLabel?: string
  triggerClassName?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  destructive?: boolean
}

function ConfirmDialog({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  children,
  triggerLabel,
  triggerClassName,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  destructive = false,
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen))
  const [pending, setPending] = React.useState(false)
  const isControlled = open !== undefined
  const currentOpen = isControlled ? open : internalOpen

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen)
    }

    onOpenChange?.(nextOpen)
  }

  async function handleConfirm() {
    try {
      setPending(true)
      await onConfirm()
      handleOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={currentOpen} onOpenChange={handleOpenChange}>
      {triggerLabel ? (
        <AlertDialogTrigger
          render={
            <Button type="button" variant="outline" className={triggerClassName}>
              {triggerLabel}
            </Button>
          }
        />
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}

        <AlertDialogFooter>
          <AlertDialogCancel>
            {cancelLabel}
          </AlertDialogCancel>
          <Button type="button" variant={destructive ? "destructive" : "default"} onClick={handleConfirm} disabled={pending}>
            {pending ? "Procesando..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ConfirmDialog }
