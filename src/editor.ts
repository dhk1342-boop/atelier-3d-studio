import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import { DEFAULT_ROOM, DESIGN_TEMPLATES, FURNITURE_PRESETS } from "./catalog";
import { applyFurnitureColor, createFurnitureAsset } from "./furnitureFactory";
import type { FurniturePreset, RoomSettings, SerializedObject, ToolMode, ViewMode } from "./types";

const STORAGE_KEY = "atelier-3d-scene-v1";
const SNAP_STEP = 0.25;
const ROTATION_STEP = 15;

interface FurnitureInstance {
  id: string;
  preset: FurniturePreset;
  group: THREE.Group;
  label: string;
  color: string;
}

interface StudioDom {
  canvasHost: HTMLDivElement;
  toastStack: HTMLDivElement;
  selectionBanner: HTMLDivElement;
  selectedEmpty: HTMLDivElement;
  selectedFields: HTMLDivElement;
  duplicateButton: HTMLButtonElement;
  metricArea: HTMLElement;
  metricItems: HTMLElement;
  metricView: HTMLElement;
  roomInputs: {
    width: HTMLInputElement;
    depth: HTMLInputElement;
    height: HTMLInputElement;
    daylight: HTMLInputElement;
    floorColor: HTMLInputElement;
    wallColor: HTMLInputElement;
  };
  roomOutputs: {
    width: HTMLElement;
    depth: HTMLElement;
    height: HTMLElement;
    daylight: HTMLElement;
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
}

interface SceneSnapshot {
  room: RoomSettings;
  objects: SerializedObject[];
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

function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
}

function groupByCategory(presets: FurniturePreset[]): Map<string, FurniturePreset[]> {
  const map = new Map<string, FurniturePreset[]>();

  presets.forEach((preset) => {
    const existing = map.get(preset.category) ?? [];
    existing.push(preset);
    map.set(preset.category, existing);
  });

  return map;
}

function createFloorTexture(baseColor: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create floor texture.");
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
    if (!(node instanceof THREE.Mesh)) {
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
  private readonly furnitureGroup = new THREE.Group();
  private readonly selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xdb5c3f);
  private readonly floorHitArea: THREE.Mesh;
  private readonly ambientLight = new THREE.HemisphereLight("#fff8ef", "#9d7650", 1.1);
  private readonly sunLight = new THREE.DirectionalLight("#fff6ea", 2.2);
  private readonly furniture = new Map<string, FurnitureInstance>();
  private activeCamera: THREE.Camera;
  private room = { ...DEFAULT_ROOM };
  private selectedId: string | null = null;
  private viewMode: ViewMode = "3d";
  private toolMode: ToolMode = "translate";
  private frameHandle = 0;
  private floorTexture: THREE.CanvasTexture | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
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
    this.perspectiveControls.maxDistance = 24;
    this.perspectiveControls.maxPolarAngle = Math.PI / 2.03;

    this.orthoControls = new OrbitControls(this.orthoCamera, this.renderer.domElement);
    this.orthoControls.enableDamping = true;
    this.orthoControls.enableRotate = false;
    this.orthoControls.screenSpacePanning = true;
    this.orthoControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.orthoControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.orthoControls.enablePan = true;
    this.orthoControls.enableZoom = true;

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

    this.scene.add(this.roomGroup);
    this.scene.add(this.furnitureGroup);
    this.scene.add(this.floorHitArea);
    this.scene.add(this.selectionBox);
    this.scene.add(this.transformControls.getHelper());
    this.scene.add(this.ambientLight);
    this.scene.add(this.sunLight);

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
    this.loadScene();
    this.switchView("3d");
    this.setToolMode("translate");
    this.resize();
    this.animate();
  }

  private renderShell(): string {
    const groupedPresets = [...groupByCategory(FURNITURE_PRESETS).entries()];
    const catalogMarkup = groupedPresets
      .map(
        ([category, presets]) => `
          <section class="catalog-group">
            <div class="panel-subhead">
              <h3>${category}</h3>
              <span>${presets.length}</span>
            </div>
            <div class="catalog-grid">
              ${presets
                .map(
                  (preset) => `
                    <button type="button" class="catalog-card" data-preset="${preset.id}">
                      <span class="catalog-label">${preset.label}</span>
                      <span class="catalog-copy">${preset.tagline}</span>
                      <span class="catalog-size">${preset.size[0].toFixed(1)} x ${preset.size[2].toFixed(1)} m</span>
                    </button>
                  `
                )
                .join("")}
            </div>
          </section>
        `
      )
      .join("");

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
            <p class="eyebrow">Interior CAD Prototype</p>
            <h1>Atelier 3D</h1>
            <p class="brand-copy">Shapr3D-style camera flow with an Urbanbase-inspired interior planning canvas.</p>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Quick Insert</h2>
              <span>${FURNITURE_PRESETS.length} pieces</span>
            </div>
            ${catalogMarkup}
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Starter Layouts</h2>
              <span>2 scenes</span>
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
              <button type="button" class="toolbar-pill" data-view="top">Top</button>
              <button type="button" class="toolbar-pill" data-view="front">Front</button>
              <button type="button" class="toolbar-pill" data-view="side">Side</button>
            </div>

            <div class="toolbar-cluster">
              <button type="button" class="toolbar-pill" data-tool="translate">Move</button>
              <button type="button" class="toolbar-pill" data-tool="rotate">Rotate</button>
              <button type="button" class="toolbar-pill" data-tool="scale">Scale</button>
            </div>

            <div class="toolbar-cluster">
              <button type="button" class="toolbar-pill toolbar-pill-strong" data-action="save">Save</button>
              <button type="button" class="toolbar-pill" data-action="export">Export</button>
              <button type="button" class="toolbar-pill" data-action="reset">Reset</button>
            </div>
          </header>

          <section class="viewport-panel">
            <div class="hud-strip">
              <div class="hud-chip">
                <span>Room area</span>
                <strong data-metric="area">0.00 sqm</strong>
              </div>
              <div class="hud-chip">
                <span>Pieces</span>
                <strong data-metric="items">0</strong>
              </div>
              <div class="hud-chip">
                <span>View</span>
                <strong data-metric="view">3D</strong>
              </div>
            </div>

            <div class="selection-banner" data-selection-banner>No selection. Add furniture from the left panel, then drag or transform it in the viewport.</div>
            <div class="canvas-host"></div>

            <div class="viewport-note">
              <span>Shortcuts</span>
              <span>Delete item, 1-4 views, G/R/S tools</span>
            </div>
          </section>
        </main>

        <aside class="sidebar sidebar-right">
          <section class="panel">
            <div class="panel-head">
              <h2>Room Lab</h2>
              <span>Live scene</span>
            </div>

            <div class="range-stack">
              <label class="range-row">
                <span>Width <strong data-room-output="width">0.0 m</strong></span>
                <input type="range" min="4" max="14" step="0.1" value="${DEFAULT_ROOM.width}" data-room-input="width" />
              </label>
              <label class="range-row">
                <span>Depth <strong data-room-output="depth">0.0 m</strong></span>
                <input type="range" min="4" max="14" step="0.1" value="${DEFAULT_ROOM.depth}" data-room-input="depth" />
              </label>
              <label class="range-row">
                <span>Height <strong data-room-output="height">0.0 m</strong></span>
                <input type="range" min="2.4" max="4.2" step="0.05" value="${DEFAULT_ROOM.height}" data-room-input="height" />
              </label>
              <label class="range-row">
                <span>Daylight <strong data-room-output="daylight">0%</strong></span>
                <input type="range" min="30" max="100" step="1" value="${DEFAULT_ROOM.daylight}" data-room-input="daylight" />
              </label>
            </div>

            <div class="form-grid compact-grid">
              <label class="field">
                <span>Floor tone</span>
                <input type="color" value="${DEFAULT_ROOM.floorColor}" data-room-input="floorColor" />
              </label>
              <label class="field">
                <span>Wall tone</span>
                <input type="color" value="${DEFAULT_ROOM.wallColor}" data-room-input="wallColor" />
              </label>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Selected Item</h2>
              <button type="button" class="text-button" data-action="duplicate">Duplicate</button>
            </div>

            <div class="empty-state" data-selected-empty>Pick any furniture piece in the scene to edit its size, placement and finish.</div>

            <div class="selected-fields" data-selected-fields hidden>
              <div class="form-grid">
                <label class="field field-full">
                  <span>Label</span>
                  <input type="text" data-selection-input="label" placeholder="Item name" />
                </label>
                <label class="field">
                  <span>Width</span>
                  <input type="number" min="0.3" max="8" step="0.05" data-selection-input="width" />
                </label>
                <label class="field">
                  <span>Depth</span>
                  <input type="number" min="0.3" max="8" step="0.05" data-selection-input="depth" />
                </label>
                <label class="field">
                  <span>Height</span>
                  <input type="number" min="0.1" max="5" step="0.05" data-selection-input="height" />
                </label>
                <label class="field">
                  <span>Position X</span>
                  <input type="number" min="-10" max="10" step="0.05" data-selection-input="x" />
                </label>
                <label class="field">
                  <span>Position Z</span>
                  <input type="number" min="-10" max="10" step="0.05" data-selection-input="z" />
                </label>
                <label class="field">
                  <span>Rotation</span>
                  <input type="number" min="-180" max="180" step="15" data-selection-input="rotation" />
                </label>
                <label class="field">
                  <span>Finish</span>
                  <input type="color" data-selection-input="color" />
                </label>
              </div>

              <div class="selection-actions">
                <button type="button" class="toolbar-pill toolbar-pill-strong" data-action="focus">Focus</button>
                <button type="button" class="toolbar-pill" data-action="delete">Delete</button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Controls</h2>
              <span>Fast edits</span>
            </div>
            <ul class="shortcut-list">
              <li><strong>Drag</strong> orbit or pan the camera.</li>
              <li><strong>G / R / S</strong> switches move, rotate and scale.</li>
              <li><strong>1 / 2 / 3 / 4</strong> changes the camera view.</li>
              <li><strong>Delete</strong> removes the selected furniture.</li>
            </ul>
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
      toastStack: query<HTMLDivElement>(".toast-stack"),
      selectionBanner: query<HTMLDivElement>("[data-selection-banner]"),
      selectedEmpty: query<HTMLDivElement>("[data-selected-empty]"),
      selectedFields: query<HTMLDivElement>("[data-selected-fields]"),
      duplicateButton: query<HTMLButtonElement>("[data-action='duplicate']"),
      metricArea: query<HTMLElement>("[data-metric='area']"),
      metricItems: query<HTMLElement>("[data-metric='items']"),
      metricView: query<HTMLElement>("[data-metric='view']"),
      roomInputs: {
        width: query<HTMLInputElement>("[data-room-input='width']"),
        depth: query<HTMLInputElement>("[data-room-input='depth']"),
        height: query<HTMLInputElement>("[data-room-input='height']"),
        daylight: query<HTMLInputElement>("[data-room-input='daylight']"),
        floorColor: query<HTMLInputElement>("[data-room-input='floorColor']"),
        wallColor: query<HTMLInputElement>("[data-room-input='wallColor']")
      },
      roomOutputs: {
        width: query<HTMLElement>("[data-room-output='width']"),
        depth: query<HTMLElement>("[data-room-output='depth']"),
        height: query<HTMLElement>("[data-room-output='height']"),
        daylight: query<HTMLElement>("[data-room-output='daylight']")
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
      input.addEventListener("input", () => {
        this.handleRoomInput(key, input.value);
      });
    });

    this.dom.selectionInputs.label.addEventListener("input", () => {
      const selected = this.getSelectedFurniture();
      if (!selected) {
        return;
      }
      selected.label = this.dom.selectionInputs.label.value.trim() || selected.preset.label;
      this.updateSelectionState();
      this.persistScene();
    });

    (["width", "depth", "height", "x", "z", "rotation"] as const).forEach((key) => {
      this.dom.selectionInputs[key].addEventListener("change", () => {
        this.handleSelectionNumberInput(key, this.dom.selectionInputs[key].value);
      });
    });

    this.dom.selectionInputs.color.addEventListener("input", () => {
      const selected = this.getSelectedFurniture();
      if (!selected) {
        return;
      }

      selected.color = this.dom.selectionInputs.color.value;
      applyFurnitureColor(selected.group, selected.color, selected.preset.accent);
      this.persistScene();
    });

    window.addEventListener("resize", () => {
      this.resize();
    });

    window.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.deleteSelected();
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

      if (event.key === "1") {
        this.switchView("3d");
        return;
      }

      if (event.key === "2") {
        this.switchView("top");
        return;
      }

      if (event.key === "3") {
        this.switchView("front");
        return;
      }

      if (event.key === "4") {
        this.switchView("side");
      }
    });

    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      const transformAxis = (this.transformControls as unknown as { axis?: string | null }).axis;
      if (transformAxis) {
        return;
      }

      const bounds = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.activeCamera);

      const furnitureMeshes = Array.from(this.furnitureGroup.children);
      const hit = this.raycaster.intersectObjects(furnitureMeshes, true)[0];
      if (hit) {
        const item = this.findFurnitureFromObject(hit.object);
        if (item) {
          this.selectFurniture(item.id);
          return;
        }
      }

      const floorHit = this.raycaster.intersectObject(this.floorHitArea)[0];
      if (floorHit) {
        this.clearSelection();
      }
    });
  }

  private handleAction(action: string): void {
    switch (action) {
      case "save":
        this.persistScene(true);
        break;
      case "export":
        this.exportScene();
        break;
      case "reset":
        this.applyTemplate(DESIGN_TEMPLATES[0].id);
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
      default:
        break;
    }
  }

  private handleRoomInput(key: keyof StudioDom["roomInputs"], value: string): void {
    if (key === "floorColor" || key === "wallColor") {
      this.room[key] = value;
      this.rebuildRoom();
      this.persistScene();
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    this.room[key] = numericValue;
    this.rebuildRoom();
    this.furniture.forEach((item) => this.clampFurniture(item));
    this.syncRoomUi();
    this.updateMetrics();
    this.persistScene();
  }

  private handleSelectionNumberInput(
    key: "width" | "depth" | "height" | "x" | "z" | "rotation",
    value: string
  ): void {
    const selected = this.getSelectedFurniture();
    if (!selected) {
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    const baseSize = selected.preset.size;
    switch (key) {
      case "width":
        selected.group.scale.x = clamp(numericValue / baseSize[0], 0.35, 2.8);
        break;
      case "depth":
        selected.group.scale.z = clamp(numericValue / baseSize[2], 0.35, 2.8);
        break;
      case "height":
        selected.group.scale.y = clamp(numericValue / baseSize[1], 0.35, 2.8);
        break;
      case "x":
        selected.group.position.x = numericValue;
        break;
      case "z":
        selected.group.position.z = numericValue;
        break;
      case "rotation":
        selected.group.rotation.y = degreesToRadians(numericValue);
        break;
    }

    this.clampFurniture(selected);
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
    this.roomGroup.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, this.room.height, this.room.depth), wallMaterial.clone());
    leftWall.position.set(-this.room.width * 0.5, this.room.height * 0.5, 0);
    leftWall.receiveShadow = true;
    this.roomGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, this.room.height, this.room.depth), wallMaterial.clone());
    rightWall.position.set(this.room.width * 0.5, this.room.height * 0.5, 0);
    rightWall.receiveShadow = true;
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
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.applyTemplate(DESIGN_TEMPLATES[0].id, false);
        return;
      }

      const snapshot = JSON.parse(raw) as SceneSnapshot;
      this.room = { ...DEFAULT_ROOM, ...snapshot.room };
      this.rebuildRoom();
      this.clearFurniture();
      snapshot.objects.forEach((serialized) => this.instantiateFurniture(serialized, false));
      this.updateMetrics();
      this.clearSelection();
    } catch {
      this.applyTemplate(DESIGN_TEMPLATES[0].id, false);
    }
  }

  private persistScene(showToast = false): void {
    const snapshot: SceneSnapshot = {
      room: { ...this.room },
      objects: [...this.furniture.values()].map((item) => ({
        id: item.id,
        presetId: item.preset.id,
        position: [item.group.position.x, item.group.position.y, item.group.position.z],
        rotationY: item.group.rotation.y,
        scale: [item.group.scale.x, item.group.scale.y, item.group.scale.z],
        color: item.color,
        label: item.label
      }))
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    if (showToast) {
      this.toast("Scene saved locally.");
    }
  }

  private exportScene(): void {
    const snapshot: SceneSnapshot = {
      room: { ...this.room },
      objects: [...this.furniture.values()].map((item) => ({
        id: item.id,
        presetId: item.preset.id,
        position: [item.group.position.x, item.group.position.y, item.group.position.z],
        rotationY: item.group.rotation.y,
        scale: [item.group.scale.x, item.group.scale.y, item.group.scale.z],
        color: item.color,
        label: item.label
      }))
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "atelier-3d-scene.json";
    anchor.click();
    URL.revokeObjectURL(url);
    this.toast("JSON export downloaded.");
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
    this.toast(`${preset.label} added.`);
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
      label: serialized.label,
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

  private applyTemplate(templateId: string, announce = true): void {
    const template = DESIGN_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    this.room = { ...template.room };
    this.rebuildRoom();
    this.clearFurniture();
    template.objects.forEach((objectConfig) => {
      this.instantiateFurniture(objectConfig, false);
    });
    this.clearSelection();
    this.updateMetrics();
    this.persistScene();

    if (announce) {
      this.toast(`${template.label} loaded.`);
    }
  }

  private clearFurniture(): void {
    this.furniture.forEach((item) => {
      this.furnitureGroup.remove(item.group);
      disposeObject(item.group);
    });
    this.furniture.clear();
    this.transformControls.detach();
    this.selectedId = null;
  }

  private selectFurniture(id: string): void {
    const item = this.furniture.get(id);
    if (!item) {
      return;
    }

    this.selectedId = id;
    this.transformControls.attach(item.group);
    this.updateSelectionState();
  }

  private clearSelection(): void {
    this.selectedId = null;
    this.transformControls.detach();
    this.updateSelectionState();
  }

  private getSelectedFurniture(): FurnitureInstance | null {
    if (!this.selectedId) {
      return null;
    }

    return this.furniture.get(this.selectedId) ?? null;
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

  private clampFurniture(item: FurnitureInstance): void {
    const size = this.getFurnitureSize(item);
    const theta = item.group.rotation.y;
    const extentX = Math.abs(Math.cos(theta)) * size.x + Math.abs(Math.sin(theta)) * size.z;
    const extentZ = Math.abs(Math.sin(theta)) * size.x + Math.abs(Math.cos(theta)) * size.z;

    item.group.position.x = clamp(item.group.position.x, -this.room.width * 0.5 + extentX * 0.5, this.room.width * 0.5 - extentX * 0.5);
    item.group.position.z = clamp(item.group.position.z, -this.room.depth * 0.5 + extentZ * 0.5, this.room.depth * 0.5 - extentZ * 0.5);
    item.group.position.y = 0;
  }

  private getFurnitureSize(item: FurnitureInstance): THREE.Vector3 {
    return new THREE.Vector3(
      item.preset.size[0] * item.group.scale.x,
      item.preset.size[1] * item.group.scale.y,
      item.preset.size[2] * item.group.scale.z
    );
  }

  private handleTransformChange(): void {
    const selected = this.getSelectedFurniture();
    if (!selected) {
      return;
    }

    if (this.toolMode === "scale") {
      selected.group.scale.set(
        clamp(roundTo(selected.group.scale.x, 0.05), 0.35, 2.8),
        clamp(roundTo(selected.group.scale.y, 0.05), 0.35, 2.8),
        clamp(roundTo(selected.group.scale.z, 0.05), 0.35, 2.8)
      );
    }

    selected.group.position.x = roundTo(selected.group.position.x, SNAP_STEP);
    selected.group.position.z = roundTo(selected.group.position.z, SNAP_STEP);
    selected.group.rotation.y = degreesToRadians(roundTo(radiansToDegrees(selected.group.rotation.y), ROTATION_STEP));

    this.clampFurniture(selected);
    this.updateSelectionState();
    this.persistScene();
  }

  private deleteSelected(): void {
    const selected = this.getSelectedFurniture();
    if (!selected) {
      return;
    }

    this.furnitureGroup.remove(selected.group);
    disposeObject(selected.group);
    this.furniture.delete(selected.id);
    this.clearSelection();
    this.updateMetrics();
    this.persistScene();
    this.toast("Selected item deleted.");
  }

  private duplicateSelected(): void {
    const selected = this.getSelectedFurniture();
    if (!selected) {
      return;
    }

    const cloneConfig: SerializedObject = {
      presetId: selected.preset.id,
      position: [selected.group.position.x + 0.7, 0, selected.group.position.z + 0.5],
      rotationY: selected.group.rotation.y,
      scale: [selected.group.scale.x, selected.group.scale.y, selected.group.scale.z],
      color: selected.color,
      label: `${selected.label} Copy`
    };

    const duplicate = this.instantiateFurniture(cloneConfig, true);
    this.selectFurniture(duplicate.id);
    this.toast("Duplicate created.");
  }

  private focusSelection(announce = true): void {
    const selected = this.getSelectedFurniture();
    if (!selected) {
      return;
    }

    const size = this.getFurnitureSize(selected);
    const target = new THREE.Vector3(selected.group.position.x, size.y * 0.4, selected.group.position.z);
    this.perspectiveControls.target.copy(target);
    if (this.viewMode !== "3d") {
      this.switchView("3d");
    }
    this.perspectiveCamera.position.set(target.x + size.x * 1.8 + 2.4, Math.max(3.4, size.y * 3.2), target.z + size.z * 1.9 + 2.4);
    this.perspectiveControls.update();

    if (announce) {
      this.toast("Camera focused on selection.");
    }
  }

  private updateSelectionState(): void {
    const selected = this.getSelectedFurniture();
    const selectionButtons = this.root.querySelectorAll<HTMLElement>("[data-action='duplicate'], [data-action='delete'], [data-action='focus']");
    selectionButtons.forEach((button) => {
      button.toggleAttribute("disabled", !selected);
    });

    if (!selected) {
      this.selectionBox.visible = false;
      this.dom.selectedEmpty.hidden = false;
      this.dom.selectedFields.hidden = true;
      this.dom.selectionBanner.textContent = "No selection. Add furniture from the left panel, then drag or transform it in the viewport.";
      return;
    }

    this.selectionBox.setFromObject(selected.group);
    this.selectionBox.visible = true;
    this.dom.selectedEmpty.hidden = true;
    this.dom.selectedFields.hidden = false;
    this.dom.selectionBanner.textContent = `${selected.label} selected. Use gizmos or numeric fields to refine placement.`;

    const size = this.getFurnitureSize(selected);
    this.dom.selectionInputs.label.value = selected.label;
    this.dom.selectionInputs.width.value = size.x.toFixed(2);
    this.dom.selectionInputs.depth.value = size.z.toFixed(2);
    this.dom.selectionInputs.height.value = size.y.toFixed(2);
    this.dom.selectionInputs.x.value = selected.group.position.x.toFixed(2);
    this.dom.selectionInputs.z.value = selected.group.position.z.toFixed(2);
    this.dom.selectionInputs.rotation.value = roundTo(radiansToDegrees(selected.group.rotation.y), ROTATION_STEP).toFixed(0);
    this.dom.selectionInputs.color.value = selected.color;
  }

  private updateMetrics(): void {
    this.dom.metricArea.textContent = `${(this.room.width * this.room.depth).toFixed(2)} sqm`;
    this.dom.metricItems.textContent = String(this.furniture.size);
    this.dom.metricView.textContent = this.viewMode.toUpperCase();
  }

  private syncRoomUi(): void {
    this.dom.roomInputs.width.value = String(this.room.width);
    this.dom.roomInputs.depth.value = String(this.room.depth);
    this.dom.roomInputs.height.value = String(this.room.height);
    this.dom.roomInputs.daylight.value = String(this.room.daylight);
    this.dom.roomInputs.floorColor.value = this.room.floorColor;
    this.dom.roomInputs.wallColor.value = this.room.wallColor;

    this.dom.roomOutputs.width.textContent = formatMeters(this.room.width);
    this.dom.roomOutputs.depth.textContent = formatMeters(this.room.depth);
    this.dom.roomOutputs.height.textContent = formatMeters(this.room.height);
    this.dom.roomOutputs.daylight.textContent = `${Math.round(this.room.daylight)}%`;
  }

  private switchView(view: ViewMode): void {
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

  private getActiveControls(): OrbitControls {
    return this.viewMode === "3d" ? this.perspectiveControls : this.orthoControls;
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

    const selected = this.getSelectedFurniture();
    if (selected) {
      this.selectionBox.setFromObject(selected.group);
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
  }
}
