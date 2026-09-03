import { ref } from "vue";

export interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// >>> promise-based confirm dialog - replaces window.confirm() for destructive
// bulk actions. pair with <ConfirmDialog v-bind="..."> in the view template.
export function useConfirm() {
  const open = ref(false);
  const data = ref<ConfirmOpts>({ message: "" });
  let resolver: ((v: boolean) => void) | null = null;

  function ask(opts: ConfirmOpts): Promise<boolean> {
    data.value = opts;
    open.value = true;
    return new Promise((r) => {
      resolver = r;
    });
  }
  function settle(v: boolean) {
    open.value = false;
    resolver?.(v);
    resolver = null;
  }

  return {
    confirmOpen: open,
    confirmData: data,
    ask,
    onConfirm: () => settle(true),
    onCancel: () => settle(false),
  };
}
