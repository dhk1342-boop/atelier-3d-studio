export type ViewMode = "3d" | "top" | "front" | "side";
export type ToolMode = "translate" | "rotate" | "scale";

export interface RoomSettings {
  width: number;
  depth: number;
  height: number;
  floorColor: string;
  wallColor: string;
  daylight: number;
}

export interface FurniturePreset {
  id: string;
  label: string;
  category: string;
  tagline: string;
  model: "sofa" | "table" | "bed" | "cabinet" | "plant" | "chair" | "island" | "rug" | "lamp" | "appliance" | "shelf";
  size: [number, number, number];
  color: string;
  accent: string;
}

export interface SerializedObject {
  id?: string;
  presetId: string;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  color: string;
  label: string;
}

export interface SerializedWall {
  id?: string;
  start: [number, number];
  end: [number, number];
  thickness: number;
  height: number;
  color: string;
  label: string;
}

export interface DraftWallSettings {
  thickness: number;
  height: number;
  color: string;
}

export interface SceneSnapshot {
  room: RoomSettings;
  objects: SerializedObject[];
  walls: SerializedWall[];
  draftWall?: DraftWallSettings;
}

export interface TemplateConfig {
  id: string;
  label: string;
  description: string;
  room: RoomSettings;
  objects: SerializedObject[];
  walls?: SerializedWall[];
}
