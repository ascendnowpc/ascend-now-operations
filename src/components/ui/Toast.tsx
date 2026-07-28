import { useEffect } from "react";

interface ToastProps {
  message: string;
  variant?: "success" | "error";
  onDismiss: () => void;
  duration?: number;
}

// Lightweight, self-dismissing notification — used in place of native
// window.alert()-style popups for "this action finished" feedback.
export function Toast({ message, variant = "success", onDismiss, duration = 5000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm">
      <div
        className={`flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 shadow-xl ${
          variant === "success" ? "border-lime-200" : "border-red-200"
        }`}
        role="status"
      >
        <span className={`mt-0.5 text-base leading-none ${variant === "success" ? "text-lime-500" : "text-red-500"}`}>
          {variant === "success" ? "✓" : "⚠"}
        </span>
        <p className="flex-1 text-sm text-navy-700">{message}</p>
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-navy-300 hover:text-navy-500 leading-none">
          ✕
        </button>
      </div>
    </div>
  );
}
