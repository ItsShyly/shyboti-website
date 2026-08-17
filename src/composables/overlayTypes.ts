export type OverlayElementType = "text" | "variable-text" | "image";

export interface OverlayElementStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  textAlign?: string;
  fontWeight?: string;
  stroke?: boolean;
  strokeColor?: string;
  shadow?: boolean;
  shadowColor?: string;
  padding?: number;
  background?: string;
}

export interface OverlayElement {
  id: string;
  type: OverlayElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z_index: number;
  locked: boolean;
  visible: boolean;
  group_id: string | null;
  content: string;
  style: OverlayElementStyle;
  data: Record<string, any>;
}

export interface Overlay {
  channel: string;
  id: string;
  active: boolean;
  target_scene: string;
  target_source: string;
  obs_scene_item_id: number | null;
  obs_input_name: string;
  mouse_tracking: boolean;
  refresh_ms: number;
}

// >>> client-generated but permanent - stays as the row's id once saved, no swap needed
export function newElementId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultElement(
  type: OverlayElementType,
  centerX: number,
  centerY: number,
): OverlayElement {
  const base = {
    id: newElementId(),
    type,
    rotation: 0,
    z_index: 0,
    locked: false,
    visible: true,
    group_id: null,
    style: {} as OverlayElementStyle,
    data: {},
  };
  if (type === "image") {
    return {
      ...base,
      x: centerX - 100,
      y: centerY - 100,
      w: 200,
      h: 200,
      content: "",
    };
  }
  return {
    ...base,
    x: centerX - 100,
    y: centerY - 30,
    w: 200,
    h: 60,
    content: type === "variable-text" ? "" : "New text",
    style: { fontSize: 32, color: "#ffffff" },
  };
}
