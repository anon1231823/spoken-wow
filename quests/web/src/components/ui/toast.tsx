"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Transient messages that must not move the page.
 *
 * Written here rather than pulled in as a dependency because what this needs is small and
 * specific: something to say what a request just cost, without the layout shifting under a
 * list someone is working down. A message that pushed the rows below it would be a message
 * that moved the button next to the one being aimed at.
 *
 * Deliberately not a queue with pause-on-hover and swipe-to-dismiss. Three at a time, oldest
 * dropped, gone after a few seconds - the information is worth glancing at and never worth
 * acting on.
 */
export type ToastTone = "info" | "error";

type Toast = { id: number; tone: ToastTone; title: string; detail?: string };

const MAX_VISIBLE = 3;
const DISMISS_MS = 6000;

const ToastContext = createContext<((toast: Omit<Toast, "id">) => void) | null>(null);

export function useToast(): (toast: Omit<Toast, "id">) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <Toaster> above it");
  return show;
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((toast: Omit<Toast, "id">) => {
    // Date.now() would collide for two toasts raised in the same millisecond, which is
    // exactly what a cached preview followed by an error does.
    const id = nextId++;
    setToasts((current) => [...current, { ...toast, id }].slice(-MAX_VISIBLE));
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), DISMISS_MS);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live rather than role="alert" per toast: this is a running commentary on what
          the page just did, and interrupting a screen reader for each one would be worse
          than letting them queue. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "bg-popover text-popover-foreground pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg",
              toast.tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <p className="font-medium">{toast.title}</p>
            {toast.detail && (
              <p className={cn("mt-0.5 text-xs", toast.tone === "error" || "text-muted-foreground")}>
                {toast.detail}
              </p>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

let nextId = 0;
