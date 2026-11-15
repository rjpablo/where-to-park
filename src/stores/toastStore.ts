import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
/** `map` sits on the Find Parking map. Everything else stays at the bottom. */
export type ToastPlace = 'bottom' | 'map';

interface ToastState {
  message: string | null;
  kind: ToastKind;
  place: ToastPlace;
  /** Bumped on every show so the same message twice still restarts the timer. */
  seq: number;
  show: (message: string, kind?: ToastKind, place?: ToastPlace) => void;
  hide: () => void;
}

/** One app-wide toast, rendered by <Toast /> in the root layout. */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  place: 'bottom',
  seq: 0,
  show: (message, kind = 'info', place = 'bottom') =>
    set((s) => ({ message, kind, place, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}));

export const showToast = (message: string, kind?: ToastKind, place?: ToastPlace) =>
  useToastStore.getState().show(message, kind, place);
