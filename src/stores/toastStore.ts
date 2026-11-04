import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastState {
  message: string | null;
  kind: ToastKind;
  /** Bumped on every show so the same message twice still restarts the timer. */
  seq: number;
  show: (message: string, kind?: ToastKind) => void;
  hide: () => void;
}

/** One app-wide toast, rendered by <Toast /> in the root layout. */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  seq: 0,
  show: (message, kind = 'info') => set((s) => ({ message, kind, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}));

export const showToast = (message: string, kind?: ToastKind) =>
  useToastStore.getState().show(message, kind);
