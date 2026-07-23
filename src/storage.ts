import type { SceneSnapshot } from "./types";

const CLOUD_PROJECT_KEY = "atelier-3d-cloud-project-v1";
const CLOUD_AUTOSAVE_KEY = "atelier-3d-cloud-autosave-v1";
const DEFAULT_SUPABASE_TABLE = "shared_scenes";

export interface CloudPreferences {
  projectId: string;
  autosave: boolean;
}

export function sanitizeProjectId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function loadCloudPreferences(): CloudPreferences {
  if (typeof window === "undefined") {
    return {
      projectId: "",
      autosave: false
    };
  }

  return {
    projectId: sanitizeProjectId(window.localStorage.getItem(CLOUD_PROJECT_KEY) ?? ""),
    autosave: window.localStorage.getItem(CLOUD_AUTOSAVE_KEY) === "true"
  };
}

export function saveCloudPreferences(preferences: CloudPreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(CLOUD_PROJECT_KEY, sanitizeProjectId(preferences.projectId));
  window.localStorage.setItem(CLOUD_AUTOSAVE_KEY, String(preferences.autosave));
}

export function hasCloudStorageConfig(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getProjectIdFromUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const params = new URLSearchParams(window.location.search);
  return sanitizeProjectId(params.get("project") ?? "");
}

export function getEmbeddedSceneFromUrl(): SceneSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("scene");
  if (!encoded) {
    return null;
  }

  try {
    const json = decodeBase64Url(encoded);
    return JSON.parse(json) as SceneSnapshot;
  } catch {
    return null;
  }
}

export function buildEmbeddedSceneShareUrl(snapshot: SceneSnapshot): string {
  if (typeof window === "undefined") {
    return "";
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("project");
  url.searchParams.set("scene", encodeBase64Url(JSON.stringify(snapshot)));
  return url.toString();
}

export function buildProjectShareUrl(projectId: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("scene");
  url.searchParams.set("project", sanitizeProjectId(projectId));
  return url.toString();
}

export async function loadSceneFromCloud(projectId: string): Promise<SceneSnapshot | null> {
  const endpoint = createSupabaseTableUrl();
  const response = await fetch(`${endpoint}?id=eq.${encodeURIComponent(sanitizeProjectId(projectId))}&select=snapshot`, {
    method: "GET",
    headers: createSupabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`클라우드 장면을 가져오지 못했습니다. (${response.status})`);
  }

  const rows = (await response.json()) as Array<{ snapshot?: SceneSnapshot }>;
  return rows[0]?.snapshot ?? null;
}

export async function saveSceneToCloud(projectId: string, snapshot: SceneSnapshot): Promise<void> {
  const endpoint = createSupabaseTableUrl();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...createSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([
      {
        id: sanitizeProjectId(projectId),
        name: sanitizeProjectId(projectId),
        snapshot,
        updated_at: new Date().toISOString()
      }
    ])
  });

  if (!response.ok) {
    throw new Error(`클라우드 장면을 저장하지 못했습니다. (${response.status})`);
  }
}

function getSupabaseUrl(): string {
  return import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
}

function getSupabaseAnonKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
}

function getSupabaseTable(): string {
  return import.meta.env.VITE_SUPABASE_TABLE?.trim() || DEFAULT_SUPABASE_TABLE;
}

function createSupabaseHeaders(): HeadersInit {
  const anonKey = getSupabaseAnonKey();
  const headers: HeadersInit = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`
  };
  return headers;
}

function createSupabaseTableUrl(): string {
  const baseUrl = getSupabaseUrl();
  const table = getSupabaseTable();

  if (!baseUrl || !getSupabaseAnonKey()) {
    throw new Error("Supabase 연결 정보가 없습니다.");
  }

  return `${baseUrl.replace(/\/+$/, "")}/rest/v1/${table}`;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const paddedValue = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(paddedValue);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
