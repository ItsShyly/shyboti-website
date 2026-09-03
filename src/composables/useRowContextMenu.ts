import { ref } from "vue";
import type {
  ContextMenuItem,
  ContextMenuCooldown,
  ContextMenuSwatch,
  ContextMenuAccess,
} from "../components/shared/RowContextMenu.vue";

// >>> shared plumbing for the desktop right-click row menu
export function useRowContextMenu() {
  const ctxOpen = ref(false);
  const ctxX = ref(0);
  const ctxY = ref(0);
  const ctxItems = ref<ContextMenuItem[]>([]);
  const ctxCooldowns = ref<ContextMenuCooldown[]>([]);
  const ctxSwatch = ref<ContextMenuSwatch | undefined>(undefined);
  const ctxAccess = ref<ContextMenuAccess | undefined>(undefined);
  const ctxTitle = ref<string | undefined>(undefined);

  function openContext(
    e: MouseEvent,
    cfg: {
      items?: ContextMenuItem[];
      cooldowns?: ContextMenuCooldown[];
      swatch?: ContextMenuSwatch;
      access?: ContextMenuAccess;
      title?: string;
    },
  ) {
    if (
      !(cfg.items?.length || cfg.cooldowns?.length || cfg.swatch || cfg.access)
    )
      return;
    ctxX.value = e.clientX;
    ctxY.value = e.clientY;
    ctxItems.value = cfg.items ?? [];
    ctxCooldowns.value = cfg.cooldowns ?? [];
    ctxSwatch.value = cfg.swatch;
    ctxAccess.value = cfg.access;
    ctxTitle.value = cfg.title;
    ctxOpen.value = true;
  }

  return {
    ctxOpen,
    ctxX,
    ctxY,
    ctxItems,
    ctxCooldowns,
    ctxSwatch,
    ctxAccess,
    ctxTitle,
    openContext,
  };
}
