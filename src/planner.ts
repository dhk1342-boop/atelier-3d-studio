import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import { DEFAULT_ROOM, DESIGN_TEMPLATES, FURNITURE_PRESETS } from "./catalog";
import { applyFurnitureColor, createFurnitureAsset } from "./furnitureFactory";
import {
  buildEmbeddedSceneShareUrl,
  buildProjectShareUrl,
  getEmbeddedSceneFromUrl,
  getProjectIdFromUrl,
  hasCloudStorageConfig,
  loadCloudPreferences as loadStoredCloudPreferences,
  loadSceneFromCloud,
  sanitizeProjectId,
  saveCloudPreferences,
  saveSceneToCloud
} from "./storage";
import type {
  DraftFloorZoneSettings,
  DraftWallSettings,
  FurniturePreset,
  RoomSettings,
  SceneSnapshot,
  SerializedFloorZone,
  SerializedObject,
  SerializedWall,
  ToolMode,
  ViewMode
} from "./types";

const STORAGE_KEY = "atelier-3d-scene-v2";
const LEGACY_STORAGE_KEY = "atelier-3d-scene-v1";
const SNAP_STEP = 0.25;
const KEYBOARD_NUDGE_STEP = 0.01;
const ROTATION_STEP = 15;
const MIN_WALL_LENGTH = 0.45;
const MIN_FLOOR_ZONE_SIZE = 0.3;
const MIN_FLOOR_ZONE_LEVEL = 0.05;
const MAX_FLOOR_ZONE_LEVEL = 1.5;
const LEGACY_LABEL_MAP: Record<string, string> = {
  "Cloud Sofa": "클라우드 소파",
  "Coffee Table": "커피 테이블",
  "Queen Bed": "퀸 침대",
  "Storage Wall": "수납장",
  "Reading Chair": "독서 의자",
  "Dining Table": "식탁",
  "Kitchen Island": "주방 아일랜드",
  "Indoor Tree": "실내 식물",
  "Area Rug": "러그",
  "Floor Lamp": "플로어 램프",
  "Bedroom Rug": "침실 러그",
  "Accent Chair": "포인트 체어",
  "Entry Storage": "현관 수납장",
  "Living Divider": "거실 칸막이벽",
  "Hall Wall": "복도 벽",
  "Bedroom Divider": "침실 칸막이벽",
  "Bath Edge": "욕실 경계벽",
  "Pocket Wall": "보조 칸막이벽",
  "Living Rug": "거실 러그",
  "Conversation Sofa": "라운지 소파",
  "Stone Coffee": "스톤 테이블",
  "Platform Bed": "플랫폼 침대",
  "Wardrobe": "옷장",
  "Side Table": "사이드 테이블",
  "Green Accent": "그린 포인트",
  "Reading Lamp": "독서등"
};

type DraftMode = "select" | "wall" | "floor";
type LegacySceneSnapshot = {
  room?: Partial<RoomSettings>;
  objects?: SerializedObject[];
};

interface FurnitureInstance {
  id: string;
  preset: FurniturePreset;
  group: THREE.Group;
  label: string;
  color: string;
}

interface WallInstance {
  id: string;
  group: THREE.Group;
  label: string;
  color: string;
  baseLength: number;
  baseHeight: number;
  baseThickness: number;
}

interface FloorZoneInstance {
  id: string;
  group: THREE.Group;
  label: string;
  color: string;
  width: number;
  depth: number;
  level: number;
}

type SelectionState =
  | { kind: "furniture"; id: string }
  | { kind: "wall"; id: string }
  | { kind: "floorZone"; id: string }
  | null;

interface StudioDom {
  canvasHost: HTMLDivElement;
  sceneImportInput: HTMLInputElement;
  toastStack: HTMLDivElement;
  selectionBanner: HTMLDivElement;
  draftNote: HTMLDivElement;
  floorZoneNote: HTMLDivElement;
  selectedEmpty: HTMLDivElement;
  selectedFields: HTMLDivElement;
  selectedKind: HTMLElement;
  metricArea: HTMLElement;
  metricFurniture: HTMLElement;
  metricWalls: HTMLElement;
  metricView: HTMLElement;
  roomInputs: {
    width: HTMLInputElement;
    depth: HTMLInputElement;
    height: HTMLInputElement;
    daylight: HTMLInputElement;
    floorColor: HTMLInputElement;
    wallColor: HTMLInputElement;
  };
  draftInputs: {
    thickness: HTMLInputElement;
    height: HTMLInputElement;
    color: HTMLInputElement;
  };
  floorZoneInputs: {
    level: HTMLInputElement;
    color: HTMLInputElement;
  };
  cloud: {
    project: HTMLInputElement;
    statusBadge: HTMLElement;
    statusText: HTMLDivElement;
    autosaveButton: HTMLButtonElement;
  };
  selectionInputs: {
    label: HTMLInputElement;
    width: HTMLInputElement;
    depth: HTMLInputElement;
    height: HTMLInputElement;
    x: HTMLInputElement;
    z: HTMLInputElement;
    rotation: HTMLInputElement;
    color: HTMLInputElement;
  };
  selectionLabels: {
    width: HTMLElement;
    depth: HTMLElement;
    height: HTMLElement;
    x: HTMLElement;
    z: HTMLElement;
    rotation: HTMLElement;
    color: HTMLElement;
  };
}

function clamp(value: number, min: number, max: number): number {
  return THREE.MathUtils.clamp(value, min, max);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function degreesToRadians(value: number): number {
  return THREE.MathUtils.degToRad(value);
}

function radiansToDegrees(value: number): number {
  return THREE.MathUtils.radToDeg(value);
}

function formatViewLabel(view: ViewMode): string {
  switch (view) {
    case "3d":
      return "3D";
    case "top":
      return "평면";
    case "front":
      return "정면";
    case "side":
      return "측면";
    default:
      return view;
  }
}

function localizeLegacyLabel(label: string | undefined, fallback: string): string {
  if (!label) {
    return fallback;
  }

  const directMatch = LEGACY_LABEL_MAP[label];
  if (directMatch) {
    return directMatch;
  }

  const wallMatch = label.match(/^Wall (\d+)$/);
  if (wallMatch) {
    return `벽 ${wallMatch[1]}`;
  }

  const copyMatch = label.match(/^(.*) Copy$/);
  if (copyMatch) {
    const baseLabel = localizeLegacyLabel(copyMatch[1], copyMatch[1]);
    return `${baseLabel} 복사본`;
  }

  return label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function groupByCategory(presets: FurniturePreset[]): Map<string, FurniturePreset[]> {
  const map = new Map<string, FurniturePreset[]>();

  presets.forEach((preset) => {
    const entries = map.get(preset.category) ?? [];
    entries.push(preset);
    map.set(preset.category, entries);
  });

  return map;
}

const CATALOG_GROUPS = [...groupByCategory(FURNITURE_PRESETS).entries()];
const DEFAULT_CATALOG_CATEGORY = CATALOG_GROUPS[0]?.[0] ?? "";

function createFloorTexture(baseColor: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("바닥 텍스처를 만들 수 없습니다.");
  }

  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.12;

  for (let index = 0; index < 18; index += 1) {
    context.fillStyle = index % 2 === 0 ? "#ffffff" : "#7e644d";
    context.fillRect(index * 58, 0, 4, canvas.height);
  }

  context.globalAlpha = 0.08;
  for (let row = 0; row < 12; row += 1) {
    context.fillStyle = row % 2 === 0 ? "#ffffff" : "#846f5c";
    context.fillRect(0, row * 84, canvas.width, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.anisotropy = 8;
  return texture;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line)) {
      return;
    }

    node.geometry.dispose();

    const material = node.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
      return;
    }

    material.dispose();
  });
}

function createWallGroup(length: number, height: number, thickness: number, color: string): THREE.Group {
  const group = new THREE.Group();

  const geometry = new THREE.BoxGeometry(length, height, thickness);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.94,
    metalness: 0.02
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height * 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: "#3f3026",
      transparent: true,
      opacity: 0.32
    })
  );
  outline.position.copy(mesh.position);

  group.add(mesh);
  group.add(outline);
  group.userData.wallMesh = mesh;
  return group;
}

function setWallColor(group: THREE.Group, color: string): void {
  const mesh = group.userData.wallMesh as THREE.Mesh | undefined;
  if (!mesh) {
    return;
  }

  const material = mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.set(color);
  }
}

function createFloorZoneGroup(width: number, depth: number, level: number, color: string): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, Math.abs(level), depth),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.02
    })
  );
  mesh.position.y = level * 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color: "#3f3026",
      transparent: true,
      opacity: 0.28
    })
  );
  outline.position.copy(mesh.position);

  group.add(mesh);
  group.add(outline);
  group.userData.floorZoneMesh = mesh;
  group.userData.floorZoneOutline = outline;
  return group;
}

function updateFloorZoneGeometry(group: THREE.Group, width: number, depth: number, level: number): void {
  const mesh = group.userData.floorZoneMesh as THREE.Mesh | undefined;
  const outline = group.userData.floorZoneOutline as THREE.LineSegments | undefined;
  if (!mesh || !outline) {
    return;
  }

  const geometry = new THREE.BoxGeometry(width, Math.abs(level), depth);
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.position.y = level * 0.5;

  outline.geometry.dispose();
  outline.geometry = new THREE.EdgesGeometry(geometry);
  outline.position.copy(mesh.position);
}

function setFloorZoneColor(group: THREE.Group, color: string): void {
  const mesh = group.userData.floorZoneMesh as THREE.Mesh | undefined;
  if (!mesh) {
    return;
  }

  const material = mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.set(color);
  }
}

export class InteriorStudio {
  private readonly root: HTMLElement;
  private readonly dom: StudioDom;
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly perspectiveCamera: THREE.PerspectiveCamera;
  private readonly orthoCamera: THREE.OrthographicCamera;
  private readonly perspectiveControls: OrbitControls;
  private readonly orthoControls: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly roomGroup = new THREE.Group();
  private readonly floorZoneGroup = new THREE.Group();
  private readonly wallGroup = new THREE.Group();
  private readonly furnitureGroup = new THREE.Group();
  private readonly selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xdb5c3f);
  private readonly floorHitArea: THREE.Mesh;
  private readonly ambientLight = new THREE.HemisphereLight("#fff8ef", "#9d7650", 1.1);
  private readonly sunLight = new THREE.DirectionalLight("#fff6ea", 2.2);
  private readonly draftLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: 0xdb5c3f,
      dashSize: 0.18,
      gapSize: 0.12
    })
  );
  private readonly draftMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 18, 18),
    new THREE.MeshStandardMaterial({
      color: "#db5c3f",
      emissive: "#b33d23",
      emissiveIntensity: 0.6,
      roughness: 0.5,
      metalness: 0.02
    })
  );
  private readonly draftAreaLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: 0x4e7a6f,
      dashSize: 0.16,
      gapSize: 0.12
    })
  );
  private readonly furniture = new Map<string, FurnitureInstance>();
  private readonly walls = new Map<string, WallInstance>();
  private readonly floorZones = new Map<string, FloorZoneInstance>();
  private activeCamera: THREE.Camera;
  private room = { ...DEFAULT_ROOM };
  private selected: SelectionState = null;
  private viewMode: ViewMode = "3d";
  private toolMode: ToolMode = "translate";
  private catalogOpenCategory = DEFAULT_CATALOG_CATEGORY;
  private draftMode: DraftMode = "select";
  private draftAnchor: THREE.Vector3 | null = null;
  private draftWall: DraftWallSettings = {
    thickness: 0.14,
    height: 2.8,
    color: DEFAULT_ROOM.wallColor
  };
  private draftFloorZone: DraftFloorZoneSettings = {
    level: 0.15,
    color: "#c5ad90"
  };
  private cloudProjectId = "";
  private cloudAutosaveEnabled = false;
  private cloudSaveTimer: number | null = null;
  private frameHandle = 0;
  private floorTexture: THREE.CanvasTexture | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    const storedCloudPreferences = loadStoredCloudPreferences();
    this.cloudProjectId = getProjectIdFromUrl() || storedCloudPreferences.projectId;
    this.cloudAutosaveEnabled = storedCloudPreferences.autosave;
    this.root.innerHTML = this.renderShell();
    this.dom = this.captureDom();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.dom.canvasHost.append(this.renderer.domElement);

    this.perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    this.perspectiveCamera.position.set(8, 5.8, 8.8);

    this.orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
    this.activeCamera = this.perspectiveCamera;

    this.perspectiveControls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
    this.perspectiveControls.enableDamping = true;
    this.perspectiveControls.dampingFactor = 0.08;
    this.perspectiveControls.target.set(0, 1.2, 0);
    this.perspectiveControls.minDistance = 3.2;
    this.perspectiveControls.maxDistance = 28;
    this.perspectiveControls.maxPolarAngle = Math.PI / 2.03;

    this.orthoControls = new OrbitControls(this.orthoCamera, this.renderer.domElement);
    this.orthoControls.enableDamping = true;
    this.orthoControls.enableRotate = false;
    this.orthoControls.screenSpacePanning = true;
    this.orthoControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.orthoControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.orthoControls.enablePan = true;
    this.orthoControls.enableZoom = true;
    this.syncModifierNavigation(false);

    this.transformControls = new TransformControls(this.activeCamera, this.renderer.domElement);
    this.transformControls.setTranslationSnap(SNAP_STEP);
    this.transformControls.setRotationSnap(degreesToRadians(ROTATION_STEP));
    this.transformControls.size = 0.9;
    this.transformControls.addEventListener("dragging-changed", (event) => {
      const isDragging = (event as { value: boolean }).value;
      this.getActiveControls().enabled = !isDragging;
    });
    this.transformControls.addEventListener("objectChange", () => {
      this.handleTransformChange();
    });

    this.floorHitArea = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0
      })
    );
    this.floorHitArea.rotation.x = -Math.PI / 2;
    this.floorHitArea.position.y = 0.001;
    this.floorHitArea.name = "floor-hit-area";

    this.draftLine.visible = false;
    this.draftMarker.visible = false;
    this.draftAreaLine.visible = false;
    this.draftLine.position.y = 0.02;
    this.draftMarker.position.y = 0.06;

    this.scene.add(this.roomGroup);
    this.scene.add(this.floorZoneGroup);
    this.scene.add(this.wallGroup);
    this.scene.add(this.furnitureGroup);
    this.scene.add(this.floorHitArea);
    this.scene.add(this.selectionBox);
    this.scene.add(this.transformControls.getHelper());
    this.scene.add(this.ambientLight);
    this.scene.add(this.sunLight);
    this.scene.add(this.draftLine);
    this.scene.add(this.draftAreaLine);
    this.scene.add(this.draftMarker);

    this.sunLight.position.set(5, 11, 4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 40;
    this.sunLight.shadow.camera.left = -14;
    this.sunLight.shadow.camera.right = 14;
    this.sunLight.shadow.camera.top = 14;
    this.sunLight.shadow.camera.bottom = -14;

    this.selectionBox.visible = false;
    this.scene.fog = new THREE.Fog("#cfc3b7", 18, 35);

    this.bindUi();
    this.rebuildRoom();
    void this.loadInitialScene();
    this.switchView("3d");
    this.setToolMode("translate");
    this.syncDraftUi();
    this.syncCloudUi();
    this.updateSelectionState();
    this.resize();
    this.animate();
  }

  private renderShell(): string {
    const catalogMarkup = `
      <div class="catalog-accordion">
        ${CATALOG_GROUPS.map(([category, presets]) => {
          const isOpen = category === this.catalogOpenCategory;
          return `
            <section class="catalog-group${isOpen ? " is-open" : ""}">
              <button
                type="button"
                class="catalog-group-toggle"
                data-category-toggle="${category}"
                aria-expanded="${isOpen}"
              >
                <span class="catalog-group-copy">
                  <strong>${category}</strong>
                  <span>${presets.length}개</span>
                </span>
                <span class="catalog-group-arrow">${isOpen ? "-" : "+"}</span>
              </button>

              <div class="catalog-group-panel"${isOpen ? "" : " hidden"}>
                <div class="catalog-grid catalog-grid-compact">
                  ${presets
                    .map(
                      (preset) => `
                        <button
                          type="button"
                          class="catalog-card"
                          data-preset="${preset.id}"
                          data-category="${preset.category}"
                        >
                          <span class="catalog-label">${preset.label}</span>
                          <span class="catalog-size">${preset.size[0].toFixed(1)} x ${preset.size[2].toFixed(1)} m</span>
                        </button>
                      `
                    )
                    .join("")}
                </div>
              </div>
            </section>
          `;
        }).join("")}
      </div>
    `;

    const templateMarkup = DESIGN_TEMPLATES.map(
      (template) => `
        <button type="button" class="template-card" data-template="${template.id}">
          <span class="template-title">${template.label}</span>
          <span class="template-copy">${template.description}</span>
        </button>
      `
    ).join("");

    return `
      <div class="studio-shell">
        <aside class="sidebar sidebar-left">
          <section class="brand-card">
            <p class="eyebrow">인테리어 CAD 프로토타입</p>
            <h1>아틀리에 3D</h1>
            <p class="brand-copy">가구 배치는 유지한 채 평면 보기에서 벽을 한 구간씩 직접 그릴 수 있습니다.</p>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>빠른 추가</h2>
              <span>${FURNITURE_PRESETS.length}개</span>
            </div>
            ${catalogMarkup}
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>기본 레이아웃</h2>
              <span>${DESIGN_TEMPLATES.length}개</span>
            </div>
            <div class="template-stack">
              ${templateMarkup}
            </div>
          </section>
        </aside>

        <main class="workspace">
          <header class="topbar">
            <div class="toolbar-cluster">
              <button type="button" class="toolbar-pill" data-view="3d">3D</button>
              <button type="button" class="toolbar-pill" data-view="top">평면</button>
              <button type="button" class="toolbar-pill" data-view="front">정면</button>
              <button type="button" class="toolbar-pill" data-view="side">측면</button>
            </div>

            <div class="toolbar-cluster">
              <button type="button" class="toolbar-pill" data-tool="translate">이동</button>
              <button type="button" class="toolbar-pill" data-tool="rotate">회전</button>
              <button type="button" class="toolbar-pill" data-tool="scale">크기</button>
            </div>

            <div class="toolbar-cluster">
              <button type="button" class="toolbar-pill" data-draft="select">선택</button>
              <button type="button" class="toolbar-pill" data-draft="wall">벽 그리기</button>
              <button type="button" class="toolbar-pill" data-draft="floor">단차 구역</button>
              <button type="button" class="toolbar-pill" data-action="finish-draft">그리기 종료</button>
            </div>

            <div class="toolbar-cluster">
              <button type="button" class="toolbar-pill toolbar-pill-strong" data-action="save">로컬 저장</button>
              <button type="button" class="toolbar-pill" data-action="cloud-save">클라우드 저장</button>
              <button type="button" class="toolbar-pill" data-action="share-link">공유 링크 복사</button>
              <button type="button" class="toolbar-pill" data-action="import">장면 불러오기</button>
              <button type="button" class="toolbar-pill" data-action="export">JSON 내보내기</button>
              <button type="button" class="toolbar-pill" data-action="reset">초기화</button>
            </div>
          </header>

          <input type="file" accept=".json,application/json" data-scene-import hidden />

          <section class="viewport-panel">
            <div class="hud-strip">
              <div class="hud-chip">
                <span>방 면적</span>
                <strong data-metric="area">0.00 m²</strong>
              </div>
              <div class="hud-chip">
                <span>가구</span>
                <strong data-metric="furniture">0</strong>
              </div>
              <div class="hud-chip">
                <span>벽</span>
                <strong data-metric="walls">0</strong>
              </div>
              <div class="hud-chip">
                <span>시점</span>
                <strong data-metric="view">3D</strong>
              </div>
            </div>

            <div class="selection-banner" data-selection-banner>선택된 항목이 없습니다. 가구를 추가한 뒤 선택 모드에서 크기 핸들을 쓰거나 아래 작업 패널에서 정확한 치수를 입력하세요.</div>
            <div class="canvas-host"></div>

            <div class="viewport-note">
              <span>단축키</span>
              <span>Delete 삭제, 방향키 1cm 이동, Ctrl+Q/W/E/R 시점, G/R/S 도구, W 벽 그리기, Esc 종료</span>
            </div>
          </section>

          <section class="workspace-bottom">
            <section class="panel panel-dock panel-wall">
              <div class="panel-head">
                <h2>벽 그리기</h2>
                <span class="panel-pill">직교 체인</span>
              </div>

              <div class="draft-actions">
                <button type="button" class="toolbar-pill" data-draft="select">선택</button>
                <button type="button" class="toolbar-pill" data-draft="wall">벽 그리기</button>
                <button type="button" class="toolbar-pill" data-action="clear-walls">벽 모두 삭제</button>
              </div>

              <div class="form-grid compact-grid">
                <label class="field">
                  <span>두께</span>
                  <input type="number" min="0.08" max="0.6" step="0.01" value="0.14" data-draft-input="thickness" />
                </label>
                <label class="field">
                  <span>높이</span>
                  <input type="number" min="2" max="4" step="0.05" value="2.8" data-draft-input="height" />
                </label>
                <label class="field field-full">
                  <span>벽 색상</span>
                  <input type="color" value="${DEFAULT_ROOM.wallColor}" data-draft-input="color" />
                </label>
              </div>

              <div class="draft-note" data-draft-note>평면 보기에서 벽 그리기를 켠 뒤 시작점과 끝점을 차례로 클릭하세요. 다음 클릭마다 벽이 이어집니다.</div>
            </section>

            <section class="panel panel-dock panel-floor">
              <div class="panel-head">
                <h2>바닥 단차</h2>
                <span class="panel-pill">사각 구역</span>
              </div>

              <div class="draft-actions">
                <button type="button" class="toolbar-pill" data-draft="select">선택</button>
                <button type="button" class="toolbar-pill" data-draft="floor">단차 구역</button>
                <button type="button" class="toolbar-pill" data-action="clear-floor-zones">단차 모두 삭제</button>
              </div>

              <div class="form-grid compact-grid">
                <label class="field">
                  <span>높낮이 (m)</span>
                  <input type="number" min="-1.5" max="1.5" step="0.05" value="0.15" data-floor-zone-input="level" />
                </label>
                <label class="field field-full">
                  <span>단차 색상</span>
                  <input type="color" value="#c5ad90" data-floor-zone-input="color" />
                </label>
              </div>

              <div class="draft-note" data-floor-zone-note>평면 보기에서 단차 구역을 켠 뒤 첫 점과 반대쪽 점을 차례로 클릭하세요. 양수는 올림, 음수는 내림입니다.</div>
            </section>

            <section class="panel panel-dock panel-selection">
              <div class="panel-head">
                <div class="panel-heading">
                  <h2>선택 항목</h2>
                  <span class="panel-pill" data-selected-kind>선택 없음</span>
                </div>
                <button type="button" class="text-button" data-action="duplicate">복제</button>
              </div>

              <div class="empty-state" data-selected-empty>가구나 그린 벽을 선택하면 형태, 위치, 마감을 수정할 수 있습니다.</div>
              <div class="selection-helper">
                <strong>가구 크기 조절</strong>
                <span>가구를 선택한 뒤 <code>크기</code> 또는 <code>S</code>를 눌러 핸들을 드래그하거나 아래 작업 패널에서 정확한 치수를 입력하세요.</span>
              </div>

              <div class="selected-fields" data-selected-fields hidden>
                <div class="form-grid">
                  <label class="field field-full">
                    <span>이름</span>
                    <input type="text" data-selection-input="label" placeholder="항목 이름" />
                  </label>
                  <label class="field">
                    <span data-selection-label="width">가로</span>
                    <input type="number" min="0.3" max="20" step="0.05" data-selection-input="width" />
                  </label>
                  <label class="field">
                    <span data-selection-label="depth">세로</span>
                    <input type="number" min="0.08" max="20" step="0.05" data-selection-input="depth" />
                  </label>
                  <label class="field">
                    <span data-selection-label="height">높이</span>
                    <input type="number" min="-1.5" max="6" step="0.05" data-selection-input="height" />
                  </label>
                  <label class="field">
                    <span data-selection-label="x">위치 X</span>
                    <input type="number" min="-20" max="20" step="0.05" data-selection-input="x" />
                  </label>
                  <label class="field">
                    <span data-selection-label="z">위치 Z</span>
                    <input type="number" min="-20" max="20" step="0.05" data-selection-input="z" />
                  </label>
                  <label class="field">
                    <span data-selection-label="rotation">회전</span>
                    <input type="number" min="-180" max="180" step="15" data-selection-input="rotation" />
                  </label>
                  <label class="field">
                    <span data-selection-label="color">마감</span>
                    <input type="color" data-selection-input="color" />
                  </label>
                </div>

                <div class="selection-actions">
                  <button type="button" class="toolbar-pill toolbar-pill-strong" data-action="focus">초점 맞추기</button>
                  <button type="button" class="toolbar-pill" data-action="delete">삭제</button>
                </div>
              </div>
            </section>
          </section>
        </main>

        <aside class="sidebar sidebar-right sidebar-utility">
          <section class="panel">
            <div class="panel-head">
              <h2>공간 설정</h2>
              <span>수치 입력</span>
            </div>

            <div class="form-grid">
              <label class="field">
                <span>가로 (m)</span>
                <input type="number" min="4" max="18" step="0.1" value="${DEFAULT_ROOM.width}" data-room-input="width" />
              </label>
              <label class="field">
                <span>세로 (m)</span>
                <input type="number" min="4" max="18" step="0.1" value="${DEFAULT_ROOM.depth}" data-room-input="depth" />
              </label>
              <label class="field">
                <span>높이 (m)</span>
                <input type="number" min="2.4" max="4.2" step="0.05" value="${DEFAULT_ROOM.height}" data-room-input="height" />
              </label>
              <label class="field">
                <span>채광 (%)</span>
                <input type="number" min="30" max="100" step="1" value="${DEFAULT_ROOM.daylight}" data-room-input="daylight" />
              </label>
            </div>

            <div class="form-grid compact-grid">
              <label class="field">
                <span>바닥 색상</span>
                <input type="color" value="${DEFAULT_ROOM.floorColor}" data-room-input="floorColor" />
              </label>
              <label class="field">
                <span>벽체 색상</span>
                <input type="color" value="${DEFAULT_ROOM.wallColor}" data-room-input="wallColor" />
              </label>
            </div>
          </section>

          <section class="panel panel-compact panel-cloud">
            <div class="panel-head">
              <h2>클라우드</h2>
              <span class="panel-pill" data-cloud-status-badge>로컬 전용</span>
            </div>

            <label class="field field-full">
              <span>프로젝트 코드</span>
              <input
                type="text"
                value="${this.cloudProjectId}"
                data-cloud-input="project"
                placeholder="예: atelier-home-01"
              />
            </label>

            <div class="draft-actions cloud-actions">
              <button type="button" class="toolbar-pill" data-action="cloud-load">클라우드 불러오기</button>
              <button type="button" class="toolbar-pill" data-action="toggle-cloud-autosave">${this.cloudAutosaveEnabled ? "자동저장 끄기" : "자동저장 켜기"}</button>
            </div>

            <div class="cloud-note cloud-note-compact" data-cloud-status-text>
              Supabase 연결 전에는 현재 장면을 담은 웹 링크를 복사합니다. 연결 후에는 프로젝트 코드 기준으로 여러 기기에서 같은 장면을 이어서 편집할 수 있습니다.
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>조작 안내</h2>
              <span>빠른 편집</span>
            </div>
            <ul class="shortcut-list">
              <li><strong>드래그</strong>로 카메라를 회전하거나 이동합니다.</li>
              <li><strong>Ctrl + 좌클릭 드래그</strong>로 3D, 평면, 정면, 측면에서 시점을 이동합니다.</li>
              <li><strong>방향키</strong>로 선택한 항목을 1cm 단위로 미세 이동할 수 있습니다.</li>
              <li><strong>Ctrl + Q / W / E / R</strong>로 3D, 평면, 정면, 측면 시점을 전환합니다.</li>
              <li><strong>크기 / S</strong>로 가구 크기 핸들을 직접 드래그할 수 있습니다.</li>
              <li><strong>W</strong>로 평면 보기에서 벽 그리기 모드를 켜고 끕니다.</li>
              <li><strong>두 번 클릭</strong>하면 각 벽의 시작점과 끝점을 정합니다.</li>
              <li><strong>Esc</strong>로 현재 벽 체인을 종료합니다.</li>
              <li><strong>Delete</strong>로 선택한 가구나 벽을 삭제합니다.</li>
            </ul>
            <div class="save-note">
              <strong>저장</strong>
              <span><code>로컬 저장</code>은 현재 장면을 이 브라우저에 저장합니다. <code>장면 불러오기</code>는 백업 JSON을 다시 열고, <code>JSON 내보내기</code>는 백업 파일을 내려받습니다.</span>
            </div>
          </section>
        </aside>
      </div>

      <div class="toast-stack" aria-live="polite"></div>
    `;
  }

  private captureDom(): StudioDom {
    const query = <T extends Element>(selector: string): T => {
      const element = this.root.querySelector(selector);
      if (!element) {
        throw new Error(`Missing element: ${selector}`);
      }
      return element as T;
    };

    return {
      canvasHost: query<HTMLDivElement>(".canvas-host"),
      sceneImportInput: query<HTMLInputElement>("[data-scene-import]"),
      toastStack: query<HTMLDivElement>(".toast-stack"),
      selectionBanner: query<HTMLDivElement>("[data-selection-banner]"),
      draftNote: query<HTMLDivElement>("[data-draft-note]"),
      floorZoneNote: query<HTMLDivElement>("[data-floor-zone-note]"),
      selectedEmpty: query<HTMLDivElement>("[data-selected-empty]"),
      selectedFields: query<HTMLDivElement>("[data-selected-fields]"),
      selectedKind: query<HTMLElement>("[data-selected-kind]"),
      metricArea: query<HTMLElement>("[data-metric='area']"),
      metricFurniture: query<HTMLElement>("[data-metric='furniture']"),
      metricWalls: query<HTMLElement>("[data-metric='walls']"),
      metricView: query<HTMLElement>("[data-metric='view']"),
      roomInputs: {
        width: query<HTMLInputElement>("[data-room-input='width']"),
        depth: query<HTMLInputElement>("[data-room-input='depth']"),
        height: query<HTMLInputElement>("[data-room-input='height']"),
        daylight: query<HTMLInputElement>("[data-room-input='daylight']"),
        floorColor: query<HTMLInputElement>("[data-room-input='floorColor']"),
        wallColor: query<HTMLInputElement>("[data-room-input='wallColor']")
      },
      draftInputs: {
        thickness: query<HTMLInputElement>("[data-draft-input='thickness']"),
        height: query<HTMLInputElement>("[data-draft-input='height']"),
        color: query<HTMLInputElement>("[data-draft-input='color']")
      },
      floorZoneInputs: {
        level: query<HTMLInputElement>("[data-floor-zone-input='level']"),
        color: query<HTMLInputElement>("[data-floor-zone-input='color']")
      },
      cloud: {
        project: query<HTMLInputElement>("[data-cloud-input='project']"),
        statusBadge: query<HTMLElement>("[data-cloud-status-badge]"),
        statusText: query<HTMLDivElement>("[data-cloud-status-text]"),
        autosaveButton: query<HTMLButtonElement>("[data-action='toggle-cloud-autosave']")
      },
      selectionInputs: {
        label: query<HTMLInputElement>("[data-selection-input='label']"),
        width: query<HTMLInputElement>("[data-selection-input='width']"),
        depth: query<HTMLInputElement>("[data-selection-input='depth']"),
        height: query<HTMLInputElement>("[data-selection-input='height']"),
        x: query<HTMLInputElement>("[data-selection-input='x']"),
        z: query<HTMLInputElement>("[data-selection-input='z']"),
        rotation: query<HTMLInputElement>("[data-selection-input='rotation']"),
        color: query<HTMLInputElement>("[data-selection-input='color']")
      },
      selectionLabels: {
        width: query<HTMLElement>("[data-selection-label='width']"),
        depth: query<HTMLElement>("[data-selection-label='depth']"),
        height: query<HTMLElement>("[data-selection-label='height']"),
        x: query<HTMLElement>("[data-selection-label='x']"),
        z: query<HTMLElement>("[data-selection-label='z']"),
        rotation: query<HTMLElement>("[data-selection-label='rotation']"),
        color: query<HTMLElement>("[data-selection-label='color']")
      }
    };
  }

  private bindUi(): void {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const presetButton = target.closest<HTMLElement>("[data-preset]");
      if (presetButton) {
        this.addFurniture(presetButton.dataset.preset ?? "");
        return;
      }

      const categoryToggle = target.closest<HTMLElement>("[data-category-toggle]");
      if (categoryToggle) {
        this.toggleCatalogCategory(categoryToggle.dataset.categoryToggle ?? "");
        return;
      }

      const templateButton = target.closest<HTMLElement>("[data-template]");
      if (templateButton) {
        this.applyTemplate(templateButton.dataset.template ?? "");
        return;
      }

      const viewButton = target.closest<HTMLElement>("[data-view]");
      if (viewButton) {
        this.switchView((viewButton.dataset.view as ViewMode | undefined) ?? "3d");
        return;
      }

      const draftButton = target.closest<HTMLElement>("[data-draft]");
      if (draftButton) {
        this.setDraftMode((draftButton.dataset.draft as DraftMode | undefined) ?? "select");
        return;
      }

      const toolButton = target.closest<HTMLElement>("[data-tool]");
      if (toolButton) {
        this.setToolMode((toolButton.dataset.tool as ToolMode | undefined) ?? "translate");
        return;
      }

      const actionButton = target.closest<HTMLElement>("[data-action]");
      if (actionButton) {
        this.handleAction(actionButton.dataset.action ?? "");
      }
    });

    (Object.entries(this.dom.roomInputs) as [keyof StudioDom["roomInputs"], HTMLInputElement][]).forEach(([key, input]) => {
      const eventName = key === "floorColor" || key === "wallColor" ? "input" : "change";
      input.addEventListener(eventName, () => {
        this.handleRoomInput(key, input.value);
      });
    });

    (Object.entries(this.dom.draftInputs) as [keyof DraftWallSettings, HTMLInputElement][]).forEach(([key, input]) => {
      input.addEventListener("input", () => {
        this.handleDraftInput(key, input.value);
      });
    });

    (Object.entries(this.dom.floorZoneInputs) as [keyof DraftFloorZoneSettings, HTMLInputElement][]).forEach(([key, input]) => {
      input.addEventListener("input", () => {
        this.handleFloorZoneInput(key, input.value);
      });
    });

    this.dom.cloud.project.addEventListener("change", () => {
      this.handleCloudProjectInput(this.dom.cloud.project.value);
    });

    this.dom.sceneImportInput.addEventListener("change", () => {
      const [file] = [...(this.dom.sceneImportInput.files ?? [])];
      void this.importSceneFromFile(file ?? null);
    });

    this.dom.selectionInputs.label.addEventListener("input", () => {
      const selected = this.getSelectedEntity();
      if (!selected) {
        return;
      }

      let fallbackLabel = "항목";
      if (selected.kind === "wall") {
        fallbackLabel = "벽 구간";
      } else if (selected.kind === "floorZone") {
        fallbackLabel = "바닥 단차";
      } else {
        fallbackLabel = selected.item.preset.label;
      }

      selected.item.label = this.dom.selectionInputs.label.value.trim() || fallbackLabel;
      this.updateSelectionState();
      this.persistScene();
    });

    (["width", "depth", "height", "x", "z", "rotation"] as const).forEach((key) => {
      this.dom.selectionInputs[key].addEventListener("change", () => {
        this.handleSelectionNumberInput(key, this.dom.selectionInputs[key].value);
      });
    });

    this.dom.selectionInputs.color.addEventListener("input", () => {
      const selected = this.getSelectedEntity();
      if (!selected) {
        return;
      }

      selected.item.color = this.dom.selectionInputs.color.value;
      if (selected.kind === "furniture") {
        applyFurnitureColor(selected.item.group, selected.item.color, selected.item.preset.accent);
      } else if (selected.kind === "wall") {
        setWallColor(selected.item.group, selected.item.color);
      } else {
        setFloorZoneColor(selected.item.group, selected.item.color);
      }
      this.persistScene();
    });

    window.addEventListener("resize", () => {
      this.resize();
    });

    window.addEventListener("keydown", (event) => {
      this.syncModifierNavigation(event.ctrlKey);

      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      if (event.ctrlKey) {
        const lowerKey = event.key.toLowerCase();
        if (lowerKey === "q") {
          event.preventDefault();
          this.switchView("3d");
          return;
        }

        if (lowerKey === "w") {
          event.preventDefault();
          this.switchView("top");
          return;
        }

        if (lowerKey === "e") {
          event.preventDefault();
          this.switchView("front");
          return;
        }

        if (lowerKey === "r") {
          event.preventDefault();
          this.switchView("side");
          return;
        }
      }

      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        this.nudgeSelectedWithKeyboard(event.key);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.deleteSelected();
        return;
      }

      if (event.key.toLowerCase() === "w") {
        this.setDraftMode(this.draftMode === "wall" ? "select" : "wall");
        return;
      }

      if (event.key === "Escape") {
        if (this.draftMode === "wall") {
          if (this.draftAnchor) {
            this.finishWallDraft();
          } else {
            this.setDraftMode("select");
          }
          return;
        }

        this.clearSelection();
        return;
      }

      if (event.key.toLowerCase() === "g") {
        this.setToolMode("translate");
        return;
      }

      if (event.key.toLowerCase() === "r") {
        this.setToolMode("rotate");
        return;
      }

      if (event.key.toLowerCase() === "s") {
        this.setToolMode("scale");
        return;
      }

    });

    window.addEventListener("keyup", (event) => {
      this.syncModifierNavigation(event.ctrlKey);
    });

    window.addEventListener("blur", () => {
      this.syncModifierNavigation(false);
    });

    this.renderer.domElement.addEventListener(
      "pointerdown",
      (event) => {
        this.syncModifierNavigation(event.ctrlKey);
      },
      { capture: true }
    );

    this.renderer.domElement.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      this.handleViewportPointerDown(event);
    });

    this.renderer.domElement.addEventListener("pointermove", (event) => {
      this.handleViewportPointerMove(event);
    });
  }

  private toggleCatalogCategory(category: string): void {
    this.catalogOpenCategory = this.catalogOpenCategory === category ? "" : category;

    const sections = this.root.querySelectorAll<HTMLElement>(".catalog-group");
    sections.forEach((section) => {
      const button = section.querySelector<HTMLElement>("[data-category-toggle]");
      const panel = section.querySelector<HTMLElement>(".catalog-group-panel");
      const arrow = section.querySelector<HTMLElement>(".catalog-group-arrow");
      const isOpen = button?.dataset.categoryToggle === this.catalogOpenCategory;

      section.classList.toggle("is-open", Boolean(isOpen));
      button?.setAttribute("aria-expanded", String(Boolean(isOpen)));

      if (panel) {
        panel.hidden = !isOpen;
      }

      if (arrow) {
        arrow.textContent = isOpen ? "-" : "+";
      }
    });
  }

  private handleViewportPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.ctrlKey) {
      return;
    }

    const transformAxis = (this.transformControls as unknown as { axis?: string | null }).axis;
    if (transformAxis) {
      return;
    }

    const floorHit = this.getFloorIntersection(event);
    if (this.draftMode === "wall") {
      if (!floorHit) {
        return;
      }

      this.handleWallDraftClick(floorHit.point);
      return;
    }

    if (this.draftMode === "floor") {
      if (!floorHit) {
        return;
      }

      this.handleFloorZoneDraftClick(floorHit.point);
      return;
    }

    this.refreshRayFromEvent(event);
    const hit = this.raycaster.intersectObjects(
      [...this.floorZoneGroup.children, ...this.wallGroup.children, ...this.furnitureGroup.children],
      true
    )[0];
    if (hit) {
      const floorZone = this.findFloorZoneFromObject(hit.object);
      if (floorZone) {
        this.selectFloorZone(floorZone.id);
        return;
      }

      const wall = this.findWallFromObject(hit.object);
      if (wall) {
        this.selectWall(wall.id);
        return;
      }

      const furniture = this.findFurnitureFromObject(hit.object);
      if (furniture) {
        this.selectFurniture(furniture.id);
        return;
      }
    }

    if (floorHit) {
      this.clearSelection();
    }
  }

  private handleViewportPointerMove(event: PointerEvent): void {
    if ((this.draftMode !== "wall" && this.draftMode !== "floor") || !this.draftAnchor) {
      return;
    }

    const floorHit = this.getFloorIntersection(event);
    if (!floorHit) {
      return;
    }

    if (this.draftMode === "wall") {
      const point = this.normalizeWallDraftPoint(floorHit.point);
      this.updateWallDraftPreview(point);
      return;
    }

    const point = this.normalizeFloorZoneDraftPoint(floorHit.point);
    this.updateFloorZoneDraftPreview(point);
  }

  private refreshRayFromEvent(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
  }

  private getFloorIntersection(event: PointerEvent): THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>> | null {
    this.refreshRayFromEvent(event);
    return this.raycaster.intersectObject(this.floorHitArea)[0] ?? null;
  }

  private handleAction(action: string): void {
    switch (action) {
      case "save":
        this.persistScene(true);
        break;
      case "cloud-save":
        void this.saveSceneToCloud(true);
        break;
      case "share-link":
        void this.copyShareLink();
        break;
      case "import":
        this.importScene();
        break;
      case "cloud-load":
        void this.loadSceneFromCloudProject();
        break;
      case "toggle-cloud-autosave":
        void this.toggleCloudAutosave();
        break;
      case "export":
        this.exportScene();
        break;
      case "reset":
        this.applyEmptyScene();
        break;
      case "delete":
        this.deleteSelected();
        break;
      case "duplicate":
        this.duplicateSelected();
        break;
      case "focus":
        this.focusSelection();
        break;
      case "finish-draft":
        this.finishWallDraft();
        break;
      case "clear-walls":
        this.clearWalls(true);
        break;
      case "clear-floor-zones":
        this.clearFloorZones(true);
        break;
      default:
        break;
    }
  }

  private handleCloudProjectInput(value: string): void {
    const nextProjectId = sanitizeProjectId(value);
    this.cloudProjectId = nextProjectId;
    this.dom.cloud.project.value = nextProjectId;
    saveCloudPreferences({
      projectId: this.cloudProjectId,
      autosave: this.cloudAutosaveEnabled
    });
    this.syncCloudUi();
  }

  private async loadInitialScene(): Promise<void> {
    const embeddedScene = getEmbeddedSceneFromUrl();
    if (embeddedScene) {
      this.applySnapshot(embeddedScene);
      this.persistScene();
      this.toast("공유 링크 장면을 불러왔습니다.");
      return;
    }

    const sharedProjectId = getProjectIdFromUrl();
    if (sharedProjectId && hasCloudStorageConfig()) {
      this.cloudProjectId = sharedProjectId;
      this.dom.cloud.project.value = sharedProjectId;
      this.syncCloudUi();
      try {
        const snapshot = await loadSceneFromCloud(sharedProjectId);
        if (snapshot) {
          this.applySnapshot(snapshot);
          this.persistScene();
          this.toast("공유된 클라우드 장면을 불러왔습니다.");
          return;
        }
      } catch {
        this.toast("클라우드 장면을 불러오지 못해 로컬 저장본을 엽니다.");
      }
    }

    this.loadScene();
  }

  private syncCloudUi(): void {
    this.dom.cloud.project.value = this.cloudProjectId;
    this.dom.cloud.autosaveButton.textContent = this.cloudAutosaveEnabled ? "자동저장 끄기" : "자동저장 켜기";

    if (!hasCloudStorageConfig()) {
      this.dom.cloud.statusBadge.textContent = "로컬 전용";
      this.dom.cloud.statusText.textContent =
        "현재는 로컬 저장과 장면 링크 공유만 사용 중입니다. Supabase를 연결하면 여러 기기 자동저장이 가능합니다.";
      return;
    }

    if (!this.cloudProjectId) {
      this.dom.cloud.statusBadge.textContent = "준비됨";
      this.dom.cloud.statusText.textContent =
        "프로젝트 코드를 입력하면 같은 장면을 다른 기기에서도 이어서 편집할 수 있습니다.";
      return;
    }

    this.dom.cloud.statusBadge.textContent = this.cloudAutosaveEnabled ? "자동저장 켜짐" : "클라우드 준비";
    this.dom.cloud.statusText.textContent = this.cloudAutosaveEnabled
      ? `프로젝트 코드 ${this.cloudProjectId}로 자동저장 중입니다.`
      : `프로젝트 코드 ${this.cloudProjectId}가 준비되었습니다.`;
  }

  private buildSnapshot(): SceneSnapshot {
    return {
      room: { ...this.room },
      objects: [...this.furniture.values()].map((item) => ({
        id: item.id,
        presetId: item.preset.id,
        position: [item.group.position.x, item.group.position.y, item.group.position.z],
        rotationY: item.group.rotation.y,
        scale: [item.group.scale.x, item.group.scale.y, item.group.scale.z],
        color: item.color,
        label: item.label
      })),
      walls: [...this.walls.values()].map((item) => this.serializeWall(item)),
      floorZones: [...this.floorZones.values()].map((item) => this.serializeFloorZone(item)),
      draftWall: { ...this.draftWall },
      draftFloorZone: { ...this.draftFloorZone }
    };
  }

  private isSceneSnapshot(payload: unknown): payload is SceneSnapshot {
    return (
      isRecord(payload) &&
      isRecord(payload.room) &&
      Array.isArray(payload.objects) &&
      Array.isArray(payload.walls)
    );
  }

  private isLegacySceneSnapshot(payload: unknown): payload is LegacySceneSnapshot {
    return isRecord(payload) && isRecord(payload.room) && Array.isArray(payload.objects) && !Array.isArray(payload.walls);
  }

  private isSceneSnapshotEmpty(snapshot: SceneSnapshot): boolean {
    return snapshot.objects.length === 0 && snapshot.walls.length === 0 && (snapshot.floorZones?.length ?? 0) === 0;
  }

  private hasLegacySceneContent(snapshot: LegacySceneSnapshot): boolean {
    return (snapshot.objects?.length ?? 0) > 0;
  }

  private applyLegacySnapshot(snapshot: LegacySceneSnapshot): void {
    this.room = { ...DEFAULT_ROOM, ...snapshot.room };
    this.draftWall = {
      thickness: 0.14,
      height: 2.8,
      color: snapshot.room?.wallColor ?? DEFAULT_ROOM.wallColor
    };
    this.draftFloorZone = {
      level: 0.15,
      color: "#c5ad90"
    };

    this.rebuildRoom();
    this.clearFurniture(false);
    this.clearWalls(false, false);
    this.clearFloorZones(false, false);

    (snapshot.objects ?? []).forEach((serialized) => {
      const preset = FURNITURE_PRESETS.find((entry) => entry.id === serialized.presetId);
      this.instantiateFurniture(
        {
          ...serialized,
          color: serialized.color || preset?.color || "#c8b39d",
          label: localizeLegacyLabel(serialized.label, preset?.label ?? "항목")
        },
        false
      );
    });

    this.updateMetrics();
    this.clearSelection();
    this.syncDraftUi();
  }

  private applySnapshot(snapshot: SceneSnapshot): void {
    this.room = { ...DEFAULT_ROOM, ...snapshot.room };
    this.draftWall = {
      thickness: snapshot.draftWall?.thickness ?? 0.14,
      height: snapshot.draftWall?.height ?? 2.8,
      color: snapshot.draftWall?.color ?? snapshot.room?.wallColor ?? DEFAULT_ROOM.wallColor
    };
    this.draftFloorZone = {
      level: snapshot.draftFloorZone?.level ?? 0.15,
      color: snapshot.draftFloorZone?.color ?? "#c5ad90"
    };

    this.rebuildRoom();
    this.clearFurniture(false);
    this.clearWalls(false, false);
    this.clearFloorZones(false, false);

    (snapshot.objects ?? []).forEach((serialized) => this.instantiateFurniture(serialized, false));
    (snapshot.walls ?? []).forEach((serialized) => this.instantiateWall(serialized, false));
    (snapshot.floorZones ?? []).forEach((serialized) => this.instantiateFloorZone(serialized, false));

    this.updateMetrics();
    this.clearSelection();
    this.syncDraftUi();
  }

  private shouldAutosaveToCloud(): boolean {
    return hasCloudStorageConfig() && this.cloudAutosaveEnabled && Boolean(this.cloudProjectId);
  }

  private queueCloudSave(snapshot: SceneSnapshot): void {
    if (!this.shouldAutosaveToCloud()) {
      return;
    }

    if (this.cloudSaveTimer !== null) {
      window.clearTimeout(this.cloudSaveTimer);
    }

    const projectId = this.cloudProjectId;
    this.cloudSaveTimer = window.setTimeout(() => {
      this.cloudSaveTimer = null;
      void this.persistCloudSnapshot(projectId, snapshot, false);
    }, 900);
  }

  private async persistCloudSnapshot(projectId: string, snapshot: SceneSnapshot, showToast: boolean): Promise<boolean> {
    try {
      await saveSceneToCloud(projectId, snapshot);
      if (showToast) {
        this.toast("클라우드에 저장했습니다.");
      }
      this.syncCloudUi();
      return true;
    } catch {
      this.toast("클라우드 저장에 실패했습니다. Supabase 연결 정보를 확인해 주세요.");
      return false;
    }
  }

  private async saveSceneToCloud(showToast: boolean): Promise<void> {
    if (!hasCloudStorageConfig()) {
      this.toast("Supabase 연결 정보를 넣어야 클라우드 저장을 사용할 수 있습니다.");
      return;
    }

    if (!this.cloudProjectId) {
      this.toast("먼저 프로젝트 코드를 입력해 주세요.");
      this.dom.cloud.project.focus();
      return;
    }

    const snapshot = this.buildSnapshot();
    await this.persistCloudSnapshot(this.cloudProjectId, snapshot, showToast);
  }

  private async loadSceneFromCloudProject(): Promise<void> {
    if (!hasCloudStorageConfig()) {
      this.toast("Supabase 연결 정보가 아직 없습니다.");
      return;
    }

    if (!this.cloudProjectId) {
      this.toast("불러올 프로젝트 코드를 먼저 입력해 주세요.");
      this.dom.cloud.project.focus();
      return;
    }

    try {
      const snapshot = await loadSceneFromCloud(this.cloudProjectId);
      if (!snapshot) {
        this.toast("해당 프로젝트 코드로 저장된 장면이 없습니다.");
        return;
      }

      this.applySnapshot(snapshot);
      this.persistScene();
      this.toast("클라우드 장면을 불러왔습니다.");
    } catch {
      this.toast("클라우드 장면을 불러오지 못했습니다.");
    }
  }

  private async toggleCloudAutosave(): Promise<void> {
    if (!hasCloudStorageConfig()) {
      this.toast("Supabase 연결 정보를 넣으면 클라우드 자동저장을 켤 수 있습니다.");
      return;
    }

    if (!this.cloudProjectId) {
      this.toast("자동저장을 켜려면 프로젝트 코드가 필요합니다.");
      this.dom.cloud.project.focus();
      return;
    }

    this.cloudAutosaveEnabled = !this.cloudAutosaveEnabled;
    saveCloudPreferences({
      projectId: this.cloudProjectId,
      autosave: this.cloudAutosaveEnabled
    });
    this.syncCloudUi();

    if (this.cloudAutosaveEnabled) {
      await this.saveSceneToCloud(false);
      this.toast("클라우드 자동저장을 켰습니다.");
    } else {
      this.toast("클라우드 자동저장을 껐습니다.");
    }
  }

  private async copyShareLink(): Promise<void> {
    const snapshot = this.buildSnapshot();
    const shareUrl =
      hasCloudStorageConfig() && this.cloudProjectId
        ? (await this.persistCloudSnapshot(this.cloudProjectId, snapshot, false))
          ? buildProjectShareUrl(this.cloudProjectId)
          : ""
        : buildEmbeddedSceneShareUrl(snapshot);

    if (!shareUrl) {
      return;
    }

    const copied = await this.copyText(shareUrl);
    if (!copied) {
      this.toast("링크 복사에 실패했습니다.");
      return;
    }

    this.toast(hasCloudStorageConfig() && this.cloudProjectId ? "공유 링크를 복사했습니다." : "현재 장면 링크를 복사했습니다.");
  }

  private async copyText(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  }

  private handleRoomInput(key: keyof StudioDom["roomInputs"], value: string): void {
    if (key === "floorColor" || key === "wallColor") {
      const previousWallColor = this.room.wallColor;
      this.room[key] = value;

      if (key === "wallColor" && this.draftWall.color === previousWallColor) {
        this.draftWall.color = value;
      }

      this.rebuildRoom();
      this.syncDraftUi();
      this.persistScene();
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    const nextValue =
      key === "width" || key === "depth"
        ? clamp(numericValue, 4, 18)
        : key === "height"
          ? clamp(numericValue, 2.4, 4.2)
          : clamp(numericValue, 30, 100);

    this.room[key] = nextValue;
    this.rebuildRoom();
    this.furniture.forEach((item) => this.clampFurniture(item));
    this.walls.forEach((wall) => this.clampObjectToRoom(wall.group));
    this.syncRoomUi();
    this.updateMetrics();
    this.persistScene();
  }

  private handleDraftInput(key: keyof DraftWallSettings, value: string): void {
    if (key === "color") {
      this.draftWall.color = value;
      this.syncDraftUi();
      this.persistScene();
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    this.draftWall[key] = key === "thickness" ? clamp(numericValue, 0.08, 0.6) : clamp(numericValue, 2, 4);
    this.syncDraftUi();
    this.persistScene();
  }

  private handleFloorZoneInput(key: keyof DraftFloorZoneSettings, value: string): void {
    if (key === "color") {
      this.draftFloorZone.color = value;
      this.syncDraftUi();
      this.persistScene();
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    const clampedLevel = clamp(numericValue, -MAX_FLOOR_ZONE_LEVEL, MAX_FLOOR_ZONE_LEVEL);
    if (Math.abs(clampedLevel) < MIN_FLOOR_ZONE_LEVEL) {
      return;
    }

    this.draftFloorZone.level = clampedLevel;
    this.syncDraftUi();
    this.persistScene();
  }

  private handleSelectionNumberInput(
    key: "width" | "depth" | "height" | "x" | "z" | "rotation",
    value: string
  ): void {
    const selected = this.getSelectedEntity();
    if (!selected) {
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    if (selected.kind === "furniture") {
      const baseSize = selected.item.preset.size;
      switch (key) {
        case "width":
          selected.item.group.scale.x = clamp(numericValue / baseSize[0], 0.35, 2.8);
          break;
        case "depth":
          selected.item.group.scale.z = clamp(numericValue / baseSize[2], 0.35, 2.8);
          break;
        case "height":
          selected.item.group.scale.y = clamp(numericValue / baseSize[1], 0.35, 2.8);
          break;
        case "x":
          selected.item.group.position.x = numericValue;
          break;
        case "z":
          selected.item.group.position.z = numericValue;
          break;
        case "rotation":
          selected.item.group.rotation.y = degreesToRadians(numericValue);
          break;
      }

      this.clampFurniture(selected.item);
    } else if (selected.kind === "wall") {
      switch (key) {
        case "width":
          selected.item.group.scale.x = clamp(numericValue / selected.item.baseLength, 0.25, 18);
          break;
        case "depth":
          selected.item.group.scale.z = clamp(numericValue / selected.item.baseThickness, 0.4, 6);
          break;
        case "height":
          selected.item.group.scale.y = clamp(numericValue / selected.item.baseHeight, 0.4, 4);
          break;
        case "x":
          selected.item.group.position.x = numericValue;
          break;
        case "z":
          selected.item.group.position.z = numericValue;
          break;
        case "rotation":
          selected.item.group.rotation.y = degreesToRadians(numericValue);
          break;
      }

      selected.item.group.position.y = 0;
      this.clampObjectToRoom(selected.item.group);
    } else {
      const nextWidth = key === "width" ? clamp(numericValue, MIN_FLOOR_ZONE_SIZE, 18) : selected.item.width;
      const nextDepth = key === "depth" ? clamp(numericValue, MIN_FLOOR_ZONE_SIZE, 18) : selected.item.depth;
      const nextLevel =
        key === "height"
          ? Math.abs(numericValue) < MIN_FLOOR_ZONE_LEVEL
            ? selected.item.level
            : clamp(numericValue, -MAX_FLOOR_ZONE_LEVEL, MAX_FLOOR_ZONE_LEVEL)
          : selected.item.level;

      if (key === "x") {
        selected.item.group.position.x = numericValue;
      }
      if (key === "z") {
        selected.item.group.position.z = numericValue;
      }
      if (key === "rotation") {
        selected.item.group.rotation.y = degreesToRadians(numericValue);
      }

      this.resizeFloorZone(selected.item, nextWidth, nextDepth, nextLevel);
      selected.item.group.position.y = 0;
      this.clampObjectToRoom(selected.item.group);
    }

    this.updateSelectionState();
    this.persistScene();
  }

  private rebuildRoom(): void {
    while (this.roomGroup.children.length) {
      const child = this.roomGroup.children[0];
      this.roomGroup.remove(child);
      disposeObject(child);
    }

    const floorTexture = createFloorTexture(this.room.floorColor);
    this.floorTexture?.dispose();
    this.floorTexture = floorTexture;

    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.82,
      metalness: 0.02
    });

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(this.room.width, 0.08, this.room.depth),
      floorMaterial
    );
    floor.receiveShadow = true;
    floor.position.y = -0.04;
    this.roomGroup.add(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: this.room.wallColor,
      roughness: 0.92,
      metalness: 0.01
    });

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(this.room.width, this.room.height, 0.08), wallMaterial);
    backWall.position.set(0, this.room.height * 0.5, -this.room.depth * 0.5);
    backWall.receiveShadow = true;
    backWall.castShadow = true;
    this.roomGroup.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, this.room.height, this.room.depth), wallMaterial.clone());
    leftWall.position.set(-this.room.width * 0.5, this.room.height * 0.5, 0);
    leftWall.receiveShadow = true;
    leftWall.castShadow = true;
    this.roomGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, this.room.height, this.room.depth), wallMaterial.clone());
    rightWall.position.set(this.room.width * 0.5, this.room.height * 0.5, 0);
    rightWall.receiveShadow = true;
    rightWall.castShadow = true;
    this.roomGroup.add(rightWall);

    const ceilingLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(this.room.width, this.room.height, this.room.depth)),
      new THREE.LineBasicMaterial({
        color: "#8f7a67",
        transparent: true,
        opacity: 0.2
      })
    );
    ceilingLines.position.y = this.room.height * 0.5;
    this.roomGroup.add(ceilingLines);

    const grid = new THREE.GridHelper(
      Math.max(this.room.width, this.room.depth),
      Math.max(20, Math.round(Math.max(this.room.width, this.room.depth) / SNAP_STEP)),
      0x8f715c,
      0xbfa78f
    );
    grid.position.y = 0.005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.roomGroup.add(grid);

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.room.width + 4, this.room.depth + 4),
      new THREE.ShadowMaterial({
        color: "#000000",
        opacity: 0.12
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.001;
    shadowPlane.receiveShadow = true;
    this.roomGroup.add(shadowPlane);

    this.floorHitArea.geometry.dispose();
    this.floorHitArea.geometry = new THREE.PlaneGeometry(this.room.width, this.room.depth);
    this.updateLighting();
    this.syncRoomUi();
    this.updateOrthoCamera();
  }

  private updateLighting(): void {
    const daylightStrength = THREE.MathUtils.mapLinear(this.room.daylight, 30, 100, 0.85, 2.8);
    this.sunLight.intensity = daylightStrength;
    this.ambientLight.intensity = THREE.MathUtils.mapLinear(this.room.daylight, 30, 100, 0.68, 1.35);
    this.sunLight.position.set(4 + this.room.daylight * 0.03, 10 + this.room.daylight * 0.02, 5);
  }

  private loadScene(): void {
    const snapshot = this.parseStoredScene(window.localStorage.getItem(STORAGE_KEY));
    const legacySnapshot = this.parseStoredScene(window.localStorage.getItem(LEGACY_STORAGE_KEY));

    if (snapshot && this.isSceneSnapshot(snapshot)) {
      if (
        this.isSceneSnapshotEmpty(snapshot) &&
        legacySnapshot &&
        this.isLegacySceneSnapshot(legacySnapshot) &&
        this.hasLegacySceneContent(legacySnapshot)
      ) {
        this.applyLegacySnapshot(legacySnapshot);
        this.storeSceneLocally();
        this.toast("이전 버전 저장본을 복구했습니다.");
        return;
      }

      this.applySnapshot(snapshot);
      return;
    }

    if (legacySnapshot && this.isLegacySceneSnapshot(legacySnapshot) && this.hasLegacySceneContent(legacySnapshot)) {
      this.applyLegacySnapshot(legacySnapshot);
      this.storeSceneLocally();
      this.toast("이전 버전 저장본을 복구했습니다.");
      return;
    }

    try {
      this.applyEmptyScene(false);
    } catch {
      this.applyEmptyScene(false);
    }
  }

  private parseStoredScene(raw: string | null): unknown | null {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private storeSceneLocally(): SceneSnapshot {
    const snapshot = this.buildSnapshot();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
  }

  private persistScene(showToast = false): void {
    const snapshot = this.storeSceneLocally();
    this.queueCloudSave(snapshot);
    if (showToast) {
      this.toast("장면을 로컬에 저장했습니다.");
    }
  }

  private importScene(): void {
    this.dom.sceneImportInput.value = "";
    this.dom.sceneImportInput.click();
  }

  private async importSceneFromFile(file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const restored =
        (this.isSceneSnapshot(payload) && (this.applySnapshot(payload), true)) ||
        (this.isLegacySceneSnapshot(payload) && (this.applyLegacySnapshot(payload), true));

      if (!restored) {
        this.toast("지원하지 않는 장면 파일입니다.");
        return;
      }

      this.persistScene();
      this.toast("장면 파일을 불러왔습니다.");
    } catch {
      this.toast("장면 파일을 읽지 못했습니다.");
    } finally {
      this.dom.sceneImportInput.value = "";
    }
  }

  private exportScene(): void {
    const snapshot = this.buildSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "atelier-3d-장면.json";
    anchor.click();
    URL.revokeObjectURL(url);
    this.toast("JSON 백업 파일을 다운로드했습니다.");
  }

  private addFurniture(presetId: string): void {
    const preset = FURNITURE_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    const offset = [...this.furniture.values()].length;
    const serialized: SerializedObject = {
      presetId: preset.id,
      position: [((offset % 3) - 1) * 1.4, 0, (Math.floor(offset / 3) % 3) * 1.1 - 0.8],
      rotationY: 0,
      scale: [1, 1, 1],
      color: preset.color,
      label: preset.label
    };

    const instance = this.instantiateFurniture(serialized, true);
    this.selectFurniture(instance.id);
    this.toast(`${preset.label}을(를) 추가했습니다.`);
  }

  private instantiateFurniture(serialized: SerializedObject, persist = true): FurnitureInstance {
    const preset = FURNITURE_PRESETS.find((entry) => entry.id === serialized.presetId);
    if (!preset) {
      throw new Error(`Unknown preset: ${serialized.presetId}`);
    }

    const id = serialized.id ?? crypto.randomUUID();
    const group = createFurnitureAsset(preset, serialized.color);
    group.position.set(serialized.position[0], 0, serialized.position[2]);
    group.rotation.y = serialized.rotationY;
    group.scale.set(serialized.scale[0], serialized.scale[1], serialized.scale[2]);
    group.userData.furnitureId = id;

    this.furnitureGroup.add(group);

    const instance: FurnitureInstance = {
      id,
      preset,
      group,
      label: localizeLegacyLabel(serialized.label, preset.label),
      color: serialized.color
    };

    this.furniture.set(id, instance);
    this.clampFurniture(instance);
    this.updateMetrics();

    if (persist) {
      this.persistScene();
    }

    return instance;
  }

  private instantiateWall(serialized: SerializedWall, persist = true): WallInstance {
    const id = serialized.id ?? crypto.randomUUID();
    const dx = serialized.end[0] - serialized.start[0];
    const dz = serialized.end[1] - serialized.start[1];
    const length = Math.hypot(dx, dz);

    if (length < MIN_WALL_LENGTH) {
      throw new Error("벽 길이가 너무 짧습니다.");
    }

    const group = createWallGroup(length, serialized.height, serialized.thickness, serialized.color);
    group.position.set((serialized.start[0] + serialized.end[0]) * 0.5, 0, (serialized.start[1] + serialized.end[1]) * 0.5);
    group.rotation.y = -Math.atan2(dz, dx);
    group.userData.wallId = id;

    this.wallGroup.add(group);

    const instance: WallInstance = {
      id,
      group,
      label: localizeLegacyLabel(serialized.label, `벽 ${this.walls.size + 1}`),
      color: serialized.color,
      baseLength: length,
      baseHeight: serialized.height,
      baseThickness: serialized.thickness
    };

    this.walls.set(id, instance);
    this.clampObjectToRoom(instance.group);
    this.updateMetrics();

    if (persist) {
      this.persistScene();
    }

    return instance;
  }

  private instantiateFloorZone(serialized: SerializedFloorZone, persist = true): FloorZoneInstance {
    const id = serialized.id ?? crypto.randomUUID();
    const width = clamp(serialized.size[0], MIN_FLOOR_ZONE_SIZE, 18);
    const depth = clamp(serialized.size[1], MIN_FLOOR_ZONE_SIZE, 18);
    const rawLevel = clamp(serialized.level, -MAX_FLOOR_ZONE_LEVEL, MAX_FLOOR_ZONE_LEVEL);
    const level = Math.abs(rawLevel) < MIN_FLOOR_ZONE_LEVEL ? 0.15 : rawLevel;
    const group = createFloorZoneGroup(width, depth, level, serialized.color);
    group.position.set(serialized.center[0], 0, serialized.center[1]);
    group.rotation.y = serialized.rotationY ?? 0;
    group.userData.floorZoneId = id;

    this.floorZoneGroup.add(group);

    const instance: FloorZoneInstance = {
      id,
      group,
      label: localizeLegacyLabel(serialized.label, `단차 ${this.floorZones.size + 1}`),
      color: serialized.color,
      width,
      depth,
      level
    };

    this.floorZones.set(id, instance);
    this.clampObjectToRoom(instance.group);
    this.updateMetrics();

    if (persist) {
      this.persistScene();
    }

    return instance;
  }

  private serializeWall(item: WallInstance): SerializedWall {
    const size = this.getWallDimensions(item);
    const directionX = Math.cos(item.group.rotation.y);
    const directionZ = -Math.sin(item.group.rotation.y);
    const halfX = directionX * size.x * 0.5;
    const halfZ = directionZ * size.x * 0.5;

    return {
      id: item.id,
      start: [roundTo(item.group.position.x - halfX, SNAP_STEP), roundTo(item.group.position.z - halfZ, SNAP_STEP)],
      end: [roundTo(item.group.position.x + halfX, SNAP_STEP), roundTo(item.group.position.z + halfZ, SNAP_STEP)],
      thickness: Number(size.z.toFixed(3)),
      height: Number(size.y.toFixed(3)),
      color: item.color,
      label: item.label
    };
  }

  private serializeFloorZone(item: FloorZoneInstance): SerializedFloorZone {
    return {
      id: item.id,
      center: [roundTo(item.group.position.x, SNAP_STEP), roundTo(item.group.position.z, SNAP_STEP)],
      size: [Number(item.width.toFixed(3)), Number(item.depth.toFixed(3))],
      level: Number(item.level.toFixed(3)),
      color: item.color,
      label: item.label,
      rotationY: item.group.rotation.y
    };
  }

  private applyTemplate(templateId: string, announce = true): void {
    const template = DESIGN_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    this.room = { ...template.room };
    this.draftWall = {
      thickness: 0.14,
      height: Math.max(2.6, template.room.height - 0.25),
      color: template.room.wallColor
    };

    this.rebuildRoom();
    this.clearFurniture(false);
    this.clearWalls(false, false);
    this.clearFloorZones(false, false);
    template.objects.forEach((objectConfig) => {
      this.instantiateFurniture(objectConfig, false);
    });
    (template.walls ?? []).forEach((wallConfig) => {
      this.instantiateWall(wallConfig, false);
    });

    this.finishWallDraft(false);
    this.clearSelection();
    this.updateMetrics();
    this.syncDraftUi();
    this.persistScene();

    if (announce) {
      this.toast(`${template.label} 레이아웃을 불러왔습니다.`);
    }
  }

  private applyEmptyScene(announce = true): void {
    this.room = { ...DEFAULT_ROOM };
    this.draftWall = {
      thickness: 0.14,
      height: 2.8,
      color: DEFAULT_ROOM.wallColor
    };

    this.rebuildRoom();
    this.clearFurniture(false);
    this.clearWalls(false, false);
    this.clearFloorZones(false, false);
    this.finishWallDraft(false);
    this.clearSelection();
    this.updateMetrics();
    this.syncDraftUi();
    this.persistScene();

    if (announce) {
      this.toast("빈 장면으로 초기화했습니다.");
    }
  }

  private clearFurniture(persist = true): void {
    this.furniture.forEach((item) => {
      this.furnitureGroup.remove(item.group);
      disposeObject(item.group);
    });
    this.furniture.clear();

    if (persist) {
      this.persistScene();
    }
  }

  private clearWalls(announce = false, persist = true): void {
    this.walls.forEach((item) => {
      this.wallGroup.remove(item.group);
      disposeObject(item.group);
    });
    this.walls.clear();
    this.finishWallDraft(false);
    this.clearSelection();
    this.updateMetrics();
    if (persist) {
      this.persistScene();
    }

    if (announce) {
      this.toast("그려 둔 벽을 모두 지웠습니다.");
    }
  }

  private clearFloorZones(announce = false, persist = true): void {
    this.floorZones.forEach((item) => {
      this.floorZoneGroup.remove(item.group);
      disposeObject(item.group);
    });
    this.floorZones.clear();
    this.finishWallDraft(false);
    this.clearSelection();
    this.updateMetrics();
    if (persist) {
      this.persistScene();
    }

    if (announce) {
      this.toast("단차 구역을 모두 지웠습니다.");
    }
  }

  private selectFurniture(id: string): void {
    const item = this.furniture.get(id);
    if (!item) {
      return;
    }

    this.selected = { kind: "furniture", id };
    this.transformControls.attach(item.group);
    this.updateSelectionState();
  }

  private selectWall(id: string): void {
    const item = this.walls.get(id);
    if (!item) {
      return;
    }

    this.selected = { kind: "wall", id };
    this.transformControls.attach(item.group);
    this.updateSelectionState();
  }

  private selectFloorZone(id: string): void {
    const item = this.floorZones.get(id);
    if (!item) {
      return;
    }

    this.selected = { kind: "floorZone", id };
    this.transformControls.attach(item.group);
    this.updateSelectionState();
  }

  private clearSelection(): void {
    this.selected = null;
    this.transformControls.detach();
    this.updateSelectionState();
  }

  private getSelectedFurniture(): FurnitureInstance | null {
    if (!this.selected || this.selected.kind !== "furniture") {
      return null;
    }

    return this.furniture.get(this.selected.id) ?? null;
  }

  private getSelectedWall(): WallInstance | null {
    if (!this.selected || this.selected.kind !== "wall") {
      return null;
    }

    return this.walls.get(this.selected.id) ?? null;
  }

  private getSelectedFloorZone(): FloorZoneInstance | null {
    if (!this.selected || this.selected.kind !== "floorZone") {
      return null;
    }

    return this.floorZones.get(this.selected.id) ?? null;
  }

  private getSelectedEntity():
    | { kind: "furniture"; item: FurnitureInstance }
    | { kind: "wall"; item: WallInstance }
    | { kind: "floorZone"; item: FloorZoneInstance }
    | null {
    const furniture = this.getSelectedFurniture();
    if (furniture) {
      return { kind: "furniture", item: furniture };
    }

    const wall = this.getSelectedWall();
    if (wall) {
      return { kind: "wall", item: wall };
    }

    const floorZone = this.getSelectedFloorZone();
    if (floorZone) {
      return { kind: "floorZone", item: floorZone };
    }

    return null;
  }

  private findFurnitureFromObject(object: THREE.Object3D): FurnitureInstance | null {
    let current: THREE.Object3D | null = object;

    while (current) {
      const furnitureId = current.userData.furnitureId as string | undefined;
      if (furnitureId) {
        return this.furniture.get(furnitureId) ?? null;
      }
      current = current.parent;
    }

    return null;
  }

  private findWallFromObject(object: THREE.Object3D): WallInstance | null {
    let current: THREE.Object3D | null = object;

    while (current) {
      const wallId = current.userData.wallId as string | undefined;
      if (wallId) {
        return this.walls.get(wallId) ?? null;
      }
      current = current.parent;
    }

    return null;
  }

  private findFloorZoneFromObject(object: THREE.Object3D): FloorZoneInstance | null {
    let current: THREE.Object3D | null = object;

    while (current) {
      const floorZoneId = current.userData.floorZoneId as string | undefined;
      if (floorZoneId) {
        return this.floorZones.get(floorZoneId) ?? null;
      }
      current = current.parent;
    }

    return null;
  }

  private clampFurniture(item: FurnitureInstance): void {
    const size = this.getFurnitureSize(item);
    const theta = item.group.rotation.y;
    const extentX = Math.abs(Math.cos(theta)) * size.x + Math.abs(Math.sin(theta)) * size.z;
    const extentZ = Math.abs(Math.sin(theta)) * size.x + Math.abs(Math.cos(theta)) * size.z;

    item.group.position.x = clamp(item.group.position.x, -this.room.width * 0.5 + extentX * 0.5, this.room.width * 0.5 - extentX * 0.5);
    item.group.position.z = clamp(item.group.position.z, -this.room.depth * 0.5 + extentZ * 0.5, this.room.depth * 0.5 - extentZ * 0.5);
    item.group.position.y = 0;
  }

  private clampObjectToRoom(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    const minX = -this.room.width * 0.5;
    const maxX = this.room.width * 0.5;
    const minZ = -this.room.depth * 0.5;
    const maxZ = this.room.depth * 0.5;

    if (box.min.x < minX) {
      object.position.x += minX - box.min.x;
    }
    if (box.max.x > maxX) {
      object.position.x -= box.max.x - maxX;
    }
    if (box.min.z < minZ) {
      object.position.z += minZ - box.min.z;
    }
    if (box.max.z > maxZ) {
      object.position.z -= box.max.z - maxZ;
    }
  }

  private getFurnitureSize(item: FurnitureInstance): THREE.Vector3 {
    return new THREE.Vector3(
      item.preset.size[0] * item.group.scale.x,
      item.preset.size[1] * item.group.scale.y,
      item.preset.size[2] * item.group.scale.z
    );
  }

  private getWallDimensions(item: WallInstance): THREE.Vector3 {
    return new THREE.Vector3(
      item.baseLength * item.group.scale.x,
      item.baseHeight * item.group.scale.y,
      item.baseThickness * item.group.scale.z
    );
  }

  private resizeFloorZone(item: FloorZoneInstance, width: number, depth: number, level: number): void {
    item.width = clamp(width, MIN_FLOOR_ZONE_SIZE, 18);
    item.depth = clamp(depth, MIN_FLOOR_ZONE_SIZE, 18);
    item.level =
      Math.abs(level) < MIN_FLOOR_ZONE_LEVEL
        ? item.level >= 0
          ? MIN_FLOOR_ZONE_LEVEL
          : -MIN_FLOOR_ZONE_LEVEL
        : clamp(level, -MAX_FLOOR_ZONE_LEVEL, MAX_FLOOR_ZONE_LEVEL);
    updateFloorZoneGeometry(item.group, item.width, item.depth, item.level);
  }

  private handleTransformChange(): void {
    const furniture = this.getSelectedFurniture();
    if (furniture) {
      if (this.toolMode === "scale") {
        furniture.group.scale.set(
          clamp(roundTo(furniture.group.scale.x, 0.05), 0.35, 2.8),
          clamp(roundTo(furniture.group.scale.y, 0.05), 0.35, 2.8),
          clamp(roundTo(furniture.group.scale.z, 0.05), 0.35, 2.8)
        );
      }

      furniture.group.position.x = roundTo(furniture.group.position.x, SNAP_STEP);
      furniture.group.position.z = roundTo(furniture.group.position.z, SNAP_STEP);
      furniture.group.rotation.y = degreesToRadians(roundTo(radiansToDegrees(furniture.group.rotation.y), ROTATION_STEP));

      this.clampFurniture(furniture);
      this.updateSelectionState();
      this.persistScene();
      return;
    }

    const floorZone = this.getSelectedFloorZone();
    if (floorZone) {
      if (this.toolMode === "scale") {
        const nextWidth = clamp(roundTo(floorZone.width * floorZone.group.scale.x, 0.05), MIN_FLOOR_ZONE_SIZE, 18);
        const nextDepth = clamp(roundTo(floorZone.depth * floorZone.group.scale.z, 0.05), MIN_FLOOR_ZONE_SIZE, 18);
        const nextLevel =
          floorZone.group.scale.y !== 1
            ? Math.sign(floorZone.level || 1) *
              clamp(roundTo(Math.abs(floorZone.level * floorZone.group.scale.y), 0.05), MIN_FLOOR_ZONE_LEVEL, MAX_FLOOR_ZONE_LEVEL)
            : floorZone.level;
        this.resizeFloorZone(floorZone, nextWidth, nextDepth, nextLevel);
        floorZone.group.scale.set(1, 1, 1);
      }

      floorZone.group.position.x = roundTo(floorZone.group.position.x, SNAP_STEP);
      floorZone.group.position.z = roundTo(floorZone.group.position.z, SNAP_STEP);
      floorZone.group.position.y = 0;
      floorZone.group.rotation.y = degreesToRadians(roundTo(radiansToDegrees(floorZone.group.rotation.y), ROTATION_STEP));

      this.clampObjectToRoom(floorZone.group);
      this.updateSelectionState();
      this.persistScene();
      return;
    }

    const wall = this.getSelectedWall();
    if (!wall) {
      return;
    }

    if (this.toolMode === "scale") {
      wall.group.scale.set(
        clamp(roundTo(wall.group.scale.x, 0.05), 0.25, 18),
        clamp(roundTo(wall.group.scale.y, 0.05), 0.4, 4),
        clamp(roundTo(wall.group.scale.z, 0.05), 0.4, 8)
      );
    }

    wall.group.position.x = roundTo(wall.group.position.x, SNAP_STEP);
    wall.group.position.z = roundTo(wall.group.position.z, SNAP_STEP);
    wall.group.position.y = 0;
    wall.group.rotation.y = degreesToRadians(roundTo(radiansToDegrees(wall.group.rotation.y), ROTATION_STEP));

    this.clampObjectToRoom(wall.group);
    this.updateSelectionState();
    this.persistScene();
  }

  private deleteSelected(): void {
    const selected = this.getSelectedEntity();
    if (!selected) {
      return;
    }

    if (selected.kind === "furniture") {
      this.furnitureGroup.remove(selected.item.group);
      disposeObject(selected.item.group);
      this.furniture.delete(selected.item.id);
      this.toast("선택한 가구를 삭제했습니다.");
    } else if (selected.kind === "wall") {
      this.wallGroup.remove(selected.item.group);
      disposeObject(selected.item.group);
      this.walls.delete(selected.item.id);
      this.toast("선택한 벽을 삭제했습니다.");
    } else {
      this.floorZoneGroup.remove(selected.item.group);
      disposeObject(selected.item.group);
      this.floorZones.delete(selected.item.id);
      this.toast("선택한 단차 구역을 삭제했습니다.");
    }

    this.clearSelection();
    this.updateMetrics();
    this.persistScene();
  }

  private duplicateSelected(): void {
    const selected = this.getSelectedEntity();
    if (!selected) {
      return;
    }

    if (selected.kind === "furniture") {
      const cloneConfig: SerializedObject = {
        presetId: selected.item.preset.id,
        position: [selected.item.group.position.x + 0.7, 0, selected.item.group.position.z + 0.5],
        rotationY: selected.item.group.rotation.y,
        scale: [selected.item.group.scale.x, selected.item.group.scale.y, selected.item.group.scale.z],
        color: selected.item.color,
        label: `${selected.item.label} 복사본`
      };

      const duplicate = this.instantiateFurniture(cloneConfig, true);
      this.selectFurniture(duplicate.id);
      this.toast("복제본을 만들었습니다.");
      return;
    }

    if (selected.kind === "wall") {
      const serialized = this.serializeWall(selected.item);
      const duplicate = this.instantiateWall(
        {
          ...serialized,
          start: [serialized.start[0] + 0.45, serialized.start[1] + 0.45],
          end: [serialized.end[0] + 0.45, serialized.end[1] + 0.45],
          label: `${selected.item.label} 복사본`
        },
        true
      );
      this.selectWall(duplicate.id);
      this.toast("복제본을 만들었습니다.");
      return;
    }

    const duplicate = this.instantiateFloorZone(
      {
        ...this.serializeFloorZone(selected.item),
        center: [selected.item.group.position.x + 0.6, selected.item.group.position.z + 0.6],
        label: `${selected.item.label} 복사본`
      },
      true
    );
    this.selectFloorZone(duplicate.id);
    this.toast("복제본을 만들었습니다.");
  }

  private focusSelection(announce = true): void {
    const selected = this.getSelectedEntity();
    if (!selected) {
      return;
    }

    const box = new THREE.Box3().setFromObject(selected.item.group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    this.perspectiveControls.target.copy(center);
    if (this.viewMode !== "3d") {
      this.switchView("3d");
    }

    this.perspectiveCamera.position.set(
      center.x + Math.max(2.4, size.x * 1.8 + 1.2),
      Math.max(3.4, size.y * 3.2),
      center.z + Math.max(2.4, size.z * 2.1 + 1.6)
    );
    this.perspectiveControls.update();

    if (announce) {
      this.toast("선택 항목으로 시점을 이동했습니다.");
    }
  }

  private updateSelectionState(): void {
    const selected = this.getSelectedEntity();
    const selectionButtons = this.root.querySelectorAll<HTMLElement>("[data-action='duplicate'], [data-action='delete'], [data-action='focus']");
    selectionButtons.forEach((button) => {
      button.toggleAttribute("disabled", !selected);
    });

    if (!selected) {
      this.selectionBox.visible = false;
      this.dom.selectedKind.textContent = "선택 없음";
      this.dom.selectedEmpty.hidden = false;
      this.dom.selectedFields.hidden = true;
      this.syncSelectionLabels("furniture");
      this.dom.selectionBanner.textContent =
        this.draftMode === "wall"
          ? this.draftAnchor
            ? "벽 그리기 모드입니다. 다음 점을 클릭해 체인을 이어가세요."
            : "벽 그리기 모드입니다. 평면 보기에서 시작점을 클릭해 벽 그리기를 시작하세요."
          : this.draftMode === "floor"
            ? this.draftAnchor
              ? "단차 구역 시작점이 고정되었습니다. 반대쪽 점을 클릭해 구역을 완성하세요."
              : "단차 구역 모드입니다. 평면 보기에서 첫 점과 반대쪽 점을 차례로 클릭하세요."
          : "선택된 항목이 없습니다. 가구를 추가한 뒤 선택 모드에서 크기 핸들을 쓰거나 아래 작업 패널에서 정확한 치수를 입력하세요.";
      return;
    }

    this.selectionBox.setFromObject(selected.item.group);
    this.selectionBox.visible = true;
    this.dom.selectedEmpty.hidden = true;
    this.dom.selectedFields.hidden = false;

    if (selected.kind === "furniture") {
      const size = this.getFurnitureSize(selected.item);
      this.syncSelectionLabels("furniture");
      this.dom.selectedKind.textContent = "가구";
      this.dom.selectionBanner.textContent = `${selected.item.label} 선택됨. S 또는 크기 핸들로 조절하거나 아래 작업 패널에서 정확한 치수를 입력하세요.`;
      this.dom.selectionInputs.label.value = selected.item.label;
      this.dom.selectionInputs.width.value = size.x.toFixed(2);
      this.dom.selectionInputs.depth.value = size.z.toFixed(2);
      this.dom.selectionInputs.height.value = size.y.toFixed(2);
      this.dom.selectionInputs.x.value = selected.item.group.position.x.toFixed(2);
      this.dom.selectionInputs.z.value = selected.item.group.position.z.toFixed(2);
      this.dom.selectionInputs.rotation.value = roundTo(radiansToDegrees(selected.item.group.rotation.y), ROTATION_STEP).toFixed(0);
      this.dom.selectionInputs.color.value = selected.item.color;
      return;
    }

    if (selected.kind === "wall") {
      const size = this.getWallDimensions(selected.item);
      this.syncSelectionLabels("wall");
      this.dom.selectedKind.textContent = "벽 구간";
      this.dom.selectionBanner.textContent = `${selected.item.label} 선택됨. 도면에 맞게 길이, 두께, 각도를 조절하세요.`;
      this.dom.selectionInputs.label.value = selected.item.label;
      this.dom.selectionInputs.width.value = size.x.toFixed(2);
      this.dom.selectionInputs.depth.value = size.z.toFixed(2);
      this.dom.selectionInputs.height.value = size.y.toFixed(2);
      this.dom.selectionInputs.x.value = selected.item.group.position.x.toFixed(2);
      this.dom.selectionInputs.z.value = selected.item.group.position.z.toFixed(2);
      this.dom.selectionInputs.rotation.value = roundTo(radiansToDegrees(selected.item.group.rotation.y), ROTATION_STEP).toFixed(0);
      this.dom.selectionInputs.color.value = selected.item.color;
      return;
    }

    this.syncSelectionLabels("floor");
    this.dom.selectedKind.textContent = "바닥 단차";
    this.dom.selectionBanner.textContent = `${selected.item.label} 선택됨. 가로, 세로, 높낮이를 수치로 조절하고 위치를 맞추세요.`;
    this.dom.selectionInputs.label.value = selected.item.label;
    this.dom.selectionInputs.width.value = selected.item.width.toFixed(2);
    this.dom.selectionInputs.depth.value = selected.item.depth.toFixed(2);
    this.dom.selectionInputs.height.value = selected.item.level.toFixed(2);
    this.dom.selectionInputs.x.value = selected.item.group.position.x.toFixed(2);
    this.dom.selectionInputs.z.value = selected.item.group.position.z.toFixed(2);
    this.dom.selectionInputs.rotation.value = roundTo(radiansToDegrees(selected.item.group.rotation.y), ROTATION_STEP).toFixed(0);
    this.dom.selectionInputs.color.value = selected.item.color;
  }

  private syncSelectionLabels(kind: "furniture" | "wall" | "floor"): void {
    if (kind === "wall") {
      this.dom.selectionLabels.width.textContent = "길이";
      this.dom.selectionLabels.depth.textContent = "두께";
      this.dom.selectionLabels.height.textContent = "높이";
      this.dom.selectionLabels.x.textContent = "위치 X";
      this.dom.selectionLabels.z.textContent = "위치 Z";
      this.dom.selectionLabels.rotation.textContent = "회전";
      this.dom.selectionLabels.color.textContent = "벽 색상";
      return;
    }

    if (kind === "floor") {
      this.dom.selectionLabels.width.textContent = "가로";
      this.dom.selectionLabels.depth.textContent = "세로";
      this.dom.selectionLabels.height.textContent = "높낮이";
      this.dom.selectionLabels.x.textContent = "위치 X";
      this.dom.selectionLabels.z.textContent = "위치 Z";
      this.dom.selectionLabels.rotation.textContent = "회전";
      this.dom.selectionLabels.color.textContent = "단차 색상";
      return;
    }

    this.dom.selectionLabels.width.textContent = "가로";
    this.dom.selectionLabels.depth.textContent = "세로";
    this.dom.selectionLabels.height.textContent = "높이";
    this.dom.selectionLabels.x.textContent = "위치 X";
    this.dom.selectionLabels.z.textContent = "위치 Z";
    this.dom.selectionLabels.rotation.textContent = "회전";
    this.dom.selectionLabels.color.textContent = "마감";
  }

  private updateMetrics(): void {
    this.dom.metricArea.textContent = `${(this.room.width * this.room.depth).toFixed(2)} m²`;
    this.dom.metricFurniture.textContent = String(this.furniture.size);
    this.dom.metricWalls.textContent = String(this.walls.size);
    this.dom.metricView.textContent = formatViewLabel(this.viewMode);
  }

  private syncRoomUi(): void {
    this.dom.roomInputs.width.value = this.room.width.toFixed(2);
    this.dom.roomInputs.depth.value = this.room.depth.toFixed(2);
    this.dom.roomInputs.height.value = this.room.height.toFixed(2);
    this.dom.roomInputs.daylight.value = String(Math.round(this.room.daylight));
    this.dom.roomInputs.floorColor.value = this.room.floorColor;
    this.dom.roomInputs.wallColor.value = this.room.wallColor;
  }

  private syncDraftUi(): void {
    this.dom.draftInputs.thickness.value = this.draftWall.thickness.toFixed(2);
    this.dom.draftInputs.height.value = this.draftWall.height.toFixed(2);
    this.dom.draftInputs.color.value = this.draftWall.color;
    this.dom.floorZoneInputs.level.value = this.draftFloorZone.level.toFixed(2);
    this.dom.floorZoneInputs.color.value = this.draftFloorZone.color;

    const draftButtons = this.root.querySelectorAll<HTMLElement>("[data-draft]");
    draftButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.draft === this.draftMode);
    });

    this.dom.draftNote.textContent =
      this.draftMode === "wall"
        ? this.draftAnchor
          ? "벽 체인이 활성화되었습니다. 포인터를 움직이고 다음 점을 클릭한 뒤 Esc로 마무리하세요."
          : "벽 그리기 모드입니다. 평면 보기에서 시작점을 클릭한 뒤 다시 클릭해 직선 벽을 만드세요."
        : "평면 보기에서 벽 그리기를 켠 뒤 시작점과 끝점을 차례로 클릭하세요. 다음 클릭마다 벽이 이어집니다.";

    this.dom.floorZoneNote.textContent =
      this.draftMode === "floor"
        ? this.draftAnchor
          ? "첫 점이 고정되었습니다. 반대쪽 점을 클릭하면 직사각형 단차 구역이 만들어집니다."
          : "단차 구역 모드입니다. 평면 보기에서 두 점을 찍어 구역을 만들고, 높낮이는 양수면 올림 음수면 내림입니다."
        : "평면 보기에서 단차 구역을 켠 뒤 두 점을 클릭해 직사각형 구역을 만드세요. 높낮이는 양수면 올림, 음수면 내림입니다.";
  }

  private switchView(view: ViewMode): void {
    if (view !== "top" && this.draftMode !== "select") {
      this.finishWallDraft(false);
      this.draftMode = "select";
      this.syncDraftUi();
    }

    this.viewMode = view;
    const activeViewButtons = this.root.querySelectorAll<HTMLElement>("[data-view]");
    activeViewButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === view);
    });

    if (view === "3d") {
      this.activeCamera = this.perspectiveCamera;
      this.transformControls.camera = this.perspectiveCamera;
      this.perspectiveControls.enabled = true;
      this.orthoControls.enabled = false;
      this.perspectiveControls.update();
    } else {
      this.activeCamera = this.orthoCamera;
      this.transformControls.camera = this.orthoCamera;
      this.perspectiveControls.enabled = false;
      this.orthoControls.enabled = true;
      this.updateOrthoCamera();
      this.orthoControls.update();
    }

    this.updateMetrics();
    this.updateSelectionState();
  }

  private updateOrthoCamera(): void {
    if (this.viewMode === "3d") {
      return;
    }

    const width = Math.max(1, this.dom.canvasHost.clientWidth);
    const height = Math.max(1, this.dom.canvasHost.clientHeight);
    const aspect = width / height;
    let spanX = this.room.width + 2;
    let spanY = this.room.depth + 2;

    if (this.viewMode === "front") {
      spanX = this.room.width + 2;
      spanY = this.room.height + 1.4;
    }

    if (this.viewMode === "side") {
      spanX = this.room.depth + 2;
      spanY = this.room.height + 1.4;
    }

    if (spanX / spanY > aspect) {
      spanY = spanX / aspect;
    } else {
      spanX = spanY * aspect;
    }

    this.orthoCamera.left = -spanX * 0.5;
    this.orthoCamera.right = spanX * 0.5;
    this.orthoCamera.top = spanY * 0.5;
    this.orthoCamera.bottom = -spanY * 0.5;
    this.orthoCamera.near = 0.1;
    this.orthoCamera.far = 120;
    this.orthoCamera.zoom = 1;

    if (this.viewMode === "top") {
      this.orthoCamera.position.set(0, this.room.height + 10, 0.001);
      this.orthoCamera.up.set(0, 0, -1);
      this.orthoCamera.lookAt(0, 0, 0);
      this.orthoControls.target.set(0, 0, 0);
    }

    if (this.viewMode === "front") {
      this.orthoCamera.position.set(0, this.room.height * 0.5, this.room.depth + 12);
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.lookAt(0, this.room.height * 0.48, 0);
      this.orthoControls.target.set(0, this.room.height * 0.48, 0);
    }

    if (this.viewMode === "side") {
      this.orthoCamera.position.set(this.room.width + 12, this.room.height * 0.5, 0);
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.lookAt(0, this.room.height * 0.48, 0);
      this.orthoControls.target.set(0, this.room.height * 0.48, 0);
    }

    this.orthoCamera.updateProjectionMatrix();
  }

  private setToolMode(mode: ToolMode): void {
    this.toolMode = mode;
    this.transformControls.setMode(mode);

    const toolButtons = this.root.querySelectorAll<HTMLElement>("[data-tool]");
    toolButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tool === mode);
    });
  }

  private setDraftMode(mode: DraftMode): void {
    this.draftMode = mode;

    if (mode === "wall" || mode === "floor") {
      if (this.viewMode !== "top") {
        this.switchView("top");
      }
      this.clearSelection();
      this.toast(mode === "wall" ? "벽 그리기 모드를 켰습니다. 평면 보기에서 점을 클릭하세요." : "단차 구역 모드를 켰습니다. 평면 보기에서 두 점을 클릭하세요.");
    } else {
      this.finishWallDraft(false);
    }

    this.syncDraftUi();
    this.updateSelectionState();
  }

  private finishWallDraft(showToast = true): void {
    this.draftAnchor = null;
    this.draftLine.visible = false;
    this.draftAreaLine.visible = false;
    this.draftMarker.visible = false;
    this.syncDraftUi();
    this.updateSelectionState();

    if (showToast && this.draftMode !== "select") {
      this.toast(this.draftMode === "floor" ? "단차 구역 입력을 종료했습니다." : "벽 체인을 종료했습니다.");
    }
  }

  private handleWallDraftClick(point: THREE.Vector3): void {
    const snapped = this.normalizeWallDraftPoint(point);
    if (!this.draftAnchor) {
      this.draftAnchor = snapped.clone();
      this.draftMarker.position.set(snapped.x, 0.06, snapped.z);
      this.draftMarker.visible = true;
      this.updateWallDraftPreview(snapped);
      this.syncDraftUi();
      this.updateSelectionState();
      this.toast("벽 시작점을 고정했습니다.");
      return;
    }

    if (snapped.distanceTo(this.draftAnchor) < MIN_WALL_LENGTH) {
      this.toast("벽 길이가 너무 짧습니다.");
      return;
    }

    this.instantiateWall(
      {
        start: [this.draftAnchor.x, this.draftAnchor.z],
        end: [snapped.x, snapped.z],
        thickness: this.draftWall.thickness,
        height: this.draftWall.height,
        color: this.draftWall.color,
        label: `벽 ${this.walls.size + 1}`
      },
      true
    );

    this.draftAnchor = snapped.clone();
    this.draftMarker.position.set(snapped.x, 0.06, snapped.z);
    this.updateWallDraftPreview(snapped);
    this.updateMetrics();
    this.syncDraftUi();
    this.updateSelectionState();
    this.toast("벽 구간을 만들었습니다.");
  }

  private handleFloorZoneDraftClick(point: THREE.Vector3): void {
    const snapped = this.normalizeFloorZoneDraftPoint(point);
    if (!this.draftAnchor) {
      this.draftAnchor = snapped.clone();
      this.draftMarker.position.set(snapped.x, 0.06, snapped.z);
      this.draftMarker.visible = true;
      this.updateFloorZoneDraftPreview(snapped);
      this.syncDraftUi();
      this.updateSelectionState();
      this.toast("단차 구역 첫 점을 고정했습니다.");
      return;
    }

    const width = Math.abs(snapped.x - this.draftAnchor.x);
    const depth = Math.abs(snapped.z - this.draftAnchor.z);
    if (width < MIN_FLOOR_ZONE_SIZE || depth < MIN_FLOOR_ZONE_SIZE) {
      this.toast("단차 구역 크기가 너무 작습니다.");
      return;
    }

    const zone = this.instantiateFloorZone(
      {
        center: [(this.draftAnchor.x + snapped.x) * 0.5, (this.draftAnchor.z + snapped.z) * 0.5],
        size: [width, depth],
        level: this.draftFloorZone.level,
        color: this.draftFloorZone.color,
        label: `단차 ${this.floorZones.size + 1}`
      },
      true
    );
    this.selectFloorZone(zone.id);
    this.finishWallDraft(false);
    this.toast("단차 구역을 만들었습니다.");
  }

  private normalizeWallDraftPoint(point: THREE.Vector3): THREE.Vector3 {
    let nextX = clamp(point.x, -this.room.width * 0.5, this.room.width * 0.5);
    let nextZ = clamp(point.z, -this.room.depth * 0.5, this.room.depth * 0.5);

    if (this.draftAnchor) {
      const deltaX = nextX - this.draftAnchor.x;
      const deltaZ = nextZ - this.draftAnchor.z;
      if (Math.abs(deltaX) >= Math.abs(deltaZ)) {
        nextZ = this.draftAnchor.z;
      } else {
        nextX = this.draftAnchor.x;
      }
    }

    return new THREE.Vector3(roundTo(nextX, SNAP_STEP), 0, roundTo(nextZ, SNAP_STEP));
  }

  private normalizeFloorZoneDraftPoint(point: THREE.Vector3): THREE.Vector3 {
    const nextX = clamp(point.x, -this.room.width * 0.5, this.room.width * 0.5);
    const nextZ = clamp(point.z, -this.room.depth * 0.5, this.room.depth * 0.5);
    return new THREE.Vector3(roundTo(nextX, SNAP_STEP), 0, roundTo(nextZ, SNAP_STEP));
  }

  private updateWallDraftPreview(point: THREE.Vector3): void {
    if (!this.draftAnchor) {
      this.draftLine.visible = false;
      return;
    }

    const start = new THREE.Vector3(this.draftAnchor.x, 0.02, this.draftAnchor.z);
    const end = new THREE.Vector3(point.x, 0.02, point.z);
    this.draftLine.geometry.dispose();
    this.draftLine.geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    this.draftLine.computeLineDistances();
    this.draftLine.visible = true;
  }

  private updateFloorZoneDraftPreview(point: THREE.Vector3): void {
    if (!this.draftAnchor) {
      this.draftAreaLine.visible = false;
      return;
    }

    const minX = Math.min(this.draftAnchor.x, point.x);
    const maxX = Math.max(this.draftAnchor.x, point.x);
    const minZ = Math.min(this.draftAnchor.z, point.z);
    const maxZ = Math.max(this.draftAnchor.z, point.z);
    const points = [
      new THREE.Vector3(minX, 0.03, minZ),
      new THREE.Vector3(maxX, 0.03, minZ),
      new THREE.Vector3(maxX, 0.03, maxZ),
      new THREE.Vector3(minX, 0.03, maxZ),
      new THREE.Vector3(minX, 0.03, minZ)
    ];
    this.draftAreaLine.geometry.dispose();
    this.draftAreaLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.draftAreaLine.computeLineDistances();
    this.draftAreaLine.visible = true;
  }

  private getActiveControls(): OrbitControls {
    return this.viewMode === "3d" ? this.perspectiveControls : this.orthoControls;
  }

  private syncModifierNavigation(isCtrlPressed: boolean): void {
    this.perspectiveControls.mouseButtons.LEFT = isCtrlPressed ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;

    if (!this.orthoControls) {
      return;
    }

    this.orthoControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.orthoControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }

  private nudgeSelectedWithKeyboard(key: string): void {
    const selected = this.getSelectedEntity();
    if (!selected) {
      return;
    }

    let deltaX = 0;
    let deltaZ = 0;

    if (key === "ArrowLeft") {
      deltaX = -KEYBOARD_NUDGE_STEP;
    } else if (key === "ArrowRight") {
      deltaX = KEYBOARD_NUDGE_STEP;
    } else if (key === "ArrowUp") {
      deltaZ = -KEYBOARD_NUDGE_STEP;
    } else if (key === "ArrowDown") {
      deltaZ = KEYBOARD_NUDGE_STEP;
    }

    if (!deltaX && !deltaZ) {
      return;
    }

    selected.item.group.position.x = roundTo(selected.item.group.position.x + deltaX, KEYBOARD_NUDGE_STEP);
    selected.item.group.position.z = roundTo(selected.item.group.position.z + deltaZ, KEYBOARD_NUDGE_STEP);
    selected.item.group.position.y = 0;

    if (selected.kind === "furniture") {
      this.clampFurniture(selected.item);
    } else {
      this.clampObjectToRoom(selected.item.group);
    }

    selected.item.group.position.x = roundTo(selected.item.group.position.x, KEYBOARD_NUDGE_STEP);
    selected.item.group.position.z = roundTo(selected.item.group.position.z, KEYBOARD_NUDGE_STEP);
    this.updateSelectionState();
    this.persistScene();
  }

  private resize(): void {
    const width = Math.max(1, this.dom.canvasHost.clientWidth);
    const height = Math.max(1, this.dom.canvasHost.clientHeight);
    this.renderer.setSize(width, height);
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthoCamera();
  }

  private animate = (): void => {
    this.frameHandle = window.requestAnimationFrame(this.animate);
    this.perspectiveControls.update();
    this.orthoControls.update();

    const selected = this.getSelectedEntity();
    if (selected) {
      this.selectionBox.setFromObject(selected.item.group);
    }

    this.renderer.render(this.scene, this.activeCamera);
  };

  private toast(message: string): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    this.dom.toastStack.append(toast);

    window.setTimeout(() => {
      toast.classList.add("toast-out");
    }, 1600);

    window.setTimeout(() => {
      toast.remove();
    }, 2200);
  }

  public destroy(): void {
    window.cancelAnimationFrame(this.frameHandle);
    this.perspectiveControls.dispose();
    this.orthoControls.dispose();
    this.transformControls.dispose();
    this.renderer.dispose();
    this.floorTexture?.dispose();
    this.draftLine.geometry.dispose();
    this.draftAreaLine.geometry.dispose();
  }
}
