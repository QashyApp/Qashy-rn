/**
 * Tiny queue behind the in-app web dialogs. `confirmDestructive` and `showError` enqueue here and
 * `WebDialogHost` renders the head of the queue. With no host mounted (tests, non-web) `hasHost`
 * is false and callers fall back to the browser dialogs.
 */
export interface WebDialog {
  id: number;
  title: string;
  message?: string;
  /** `null` makes it an acknowledge-only dialog (errors). */
  confirmLabel: string | null;
  destructive: boolean;
  resolve: (confirmed: boolean) => void;
}

let nextId = 1;
let queue: WebDialog[] = [];
let hosts = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export const webDialogStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => queue[0] ?? null,
  hasHost: () => hosts > 0,
  mountHost() {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  },
  open(dialog: Omit<WebDialog, "id" | "resolve">) {
    return new Promise<boolean>((resolve) => {
      queue = [...queue, { ...dialog, id: nextId++, resolve }];
      emit();
    });
  },
  close(id: number, confirmed: boolean) {
    const dialog = queue.find((item) => item.id === id);
    if (!dialog) return;
    queue = queue.filter((item) => item.id !== id);
    emit();
    dialog.resolve(confirmed);
  },
};
