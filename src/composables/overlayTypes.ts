export type OverlayElementType =
  | "text"
  | "variable-text"
  | "image"
  | "video"
  | "audio"
  | "shape"
  | "countdown";

export type ShapeVariant = "border" | "background-box" | "frame";

export interface OverlayElementStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  fontWeight?: string;
  letterSpacing?: number;
  stroke?: boolean;
  strokeColor?: string;
  shadow?: boolean;
  shadowColor?: string;
  padding?: number;
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  opacity?: number; // <<< 0-100, whole-element - set from the canvas right-click menu
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

export interface OverlaySceneAttachment {
  scene: string;
  active: boolean;
  obs_input_name: string;
}

export interface Overlay {
  channel: string;
  id: string;
  name: string;
  mouse_tracking: boolean;
  refresh_ms: number;
  scenes: OverlaySceneAttachment[];
}

// >>> client-generated but permanent - stays as the row's id once saved, no swap needed
export function newElementId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseElement(type: OverlayElementType) {
  return {
    id: newElementId(),
    type,
    rotation: 0,
    z_index: 0,
    locked: false,
    visible: true,
    group_id: null as string | null,
    style: {} as OverlayElementStyle,
    data: {} as Record<string, any>,
  };
}

export function defaultElement(
  type: OverlayElementType,
  centerX: number,
  centerY: number,
): OverlayElement {
  const base = baseElement(type);

  if (type === "image" || type === "video") {
    return {
      ...base,
      x: centerX - 160,
      y: centerY - 90,
      w: 320,
      h: 180,
      content: "",
      data: type === "video" ? { muted: true, volume: 100 } : {},
    };
  }
  if (type === "audio") {
    return {
      ...base,
      x: centerX - 20,
      y: centerY - 20,
      w: 40,
      h: 40,
      content: "",
    };
  }
  if (type === "countdown") {
    return {
      ...base,
      x: centerX - 110,
      y: centerY - 30,
      w: 220,
      h: 60,
      content: "{hh}:{mm}:{ss}",
      data: { mode: "duration", durationSec: 300, repeat: true, targetIso: "" },
      style: { fontSize: 32, color: "#ffffff", textAlign: "center", verticalAlign: "middle" },
    };
  }
  if (type === "shape") {
    return {
      ...base,
      x: centerX - 100,
      y: centerY - 60,
      w: 200,
      h: 120,
      content: "",
      data: { variant: "border" as ShapeVariant },
      style: {
        borderColor: "#6f2bff",
        borderWidth: 3,
        borderRadius: 0,
        borderStyle: "solid",
      },
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

export function shapeDefaultStyle(variant: ShapeVariant): OverlayElementStyle {
  if (variant === "background-box")
    return { background: "rgba(0,0,0,0.6)", borderWidth: 0, borderRadius: 0 };
  if (variant === "frame")
    return {
      borderColor: "#ffffff",
      borderWidth: 8,
      borderRadius: 0,
      borderStyle: "solid",
    };
  return {
    borderColor: "#6f2bff",
    borderWidth: 3,
    borderRadius: 0,
    borderStyle: "solid",
  };
}
