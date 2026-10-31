import { create } from 'zustand';
import { newId } from '../lib/id';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, tone = 'info') => {
    const id = newId('toast');
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }].slice(-4) }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => get().dismiss(id), 4600);
    }
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
