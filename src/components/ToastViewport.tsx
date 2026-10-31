import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

const toneIcon = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const Icon = toneIcon[toast.tone];
        return (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <Icon size={17} aria-hidden="true" />
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
