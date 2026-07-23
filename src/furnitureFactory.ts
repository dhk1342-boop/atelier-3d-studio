import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { FurniturePreset } from "./types";

type TintRole = "primary" | "secondary" | "frame" | "leaf" | "pot" | "shade";

const METAL_SHADE = "#3b2f2a";

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function tone(base: string, lightnessDelta: number, saturationDelta = 0): THREE.Color {
  const color = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, clamp01(hsl.s + saturationDelta), clamp01(hsl.l + lightnessDelta));
  return color;
}

function createMaterial(color: THREE.ColorRepresentation, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness
  });
}

function markMesh(mesh: THREE.Mesh, tintRole?: TintRole): THREE.Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (tintRole) {
    mesh.userData.tintRole = tintRole;
  }
  return mesh;
}

function addMesh(group: THREE.Group, mesh: THREE.Mesh, position: [number, number, number]): void {
  mesh.position.set(position[0], position[1], position[2]);
  group.add(mesh);
}

function addLeg(group: THREE.Group, position: [number, number, number], height: number, radius: number): void {
  const leg = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 18),
      createMaterial(METAL_SHADE, 0.45, 0.7)
    ),
    "frame"
  );
  addMesh(group, leg, position);
}

function buildSofa(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();

  const base = markMesh(
    new THREE.Mesh(new RoundedBoxGeometry(width, height * 0.46, depth * 0.9, 6, 0.08), createMaterial(preset.color, 0.95, 0.05)),
    "primary"
  );
  const back = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.98, height * 0.34, depth * 0.24, 6, 0.06),
      createMaterial(tone(preset.color, -0.06), 0.92, 0.04)
    ),
    "secondary"
  );
  const armLeft = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.13, height * 0.33, depth * 0.88, 6, 0.06),
      createMaterial(tone(preset.color, -0.08), 0.93, 0.04)
    ),
    "secondary"
  );
  const armRight = armLeft.clone();
  const cushionLeft = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.4, height * 0.18, depth * 0.56, 5, 0.05),
      createMaterial(tone(preset.color, 0.06), 0.98, 0.02)
    ),
    "primary"
  );
  const cushionRight = cushionLeft.clone();

  addMesh(group, base, [0, height * 0.23, 0]);
  addMesh(group, back, [0, height * 0.55, -depth * 0.31]);
  addMesh(group, armLeft, [-width * 0.43, height * 0.41, 0]);
  addMesh(group, armRight, [width * 0.43, height * 0.41, 0]);
  addMesh(group, cushionLeft, [-width * 0.18, height * 0.5, depth * 0.04]);
  addMesh(group, cushionRight, [width * 0.18, height * 0.5, depth * 0.04]);

  const legHeight = height * 0.12;
  const legRadius = 0.03;
  addLeg(group, [-width * 0.4, legHeight * 0.5, -depth * 0.28], legHeight, legRadius);
  addLeg(group, [width * 0.4, legHeight * 0.5, -depth * 0.28], legHeight, legRadius);
  addLeg(group, [-width * 0.4, legHeight * 0.5, depth * 0.28], legHeight, legRadius);
  addLeg(group, [width * 0.4, legHeight * 0.5, depth * 0.28], legHeight, legRadius);

  return group;
}

function buildTable(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();
  const isCoffee = height < 0.45;

  const top = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width, height * 0.14, depth, 4, 0.04),
      createMaterial(tone(preset.color, 0.04), 0.68, 0.08)
    ),
    "primary"
  );
  addMesh(group, top, [0, height * 0.93, 0]);

  const apronHeight = isCoffee ? 0 : height * 0.08;
  if (!isCoffee) {
    const apron = markMesh(
      new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.86, apronHeight, depth * 0.68, 4, 0.03),
        createMaterial(tone(preset.accent, -0.04), 0.6, 0.15)
      ),
      "secondary"
    );
    addMesh(group, apron, [0, height * 0.78, 0]);
  }

  const legRadius = isCoffee ? 0.036 : 0.042;
  const legHeight = isCoffee ? height * 0.7 : height * 0.82;
  const offsetX = width * 0.36;
  const offsetZ = depth * 0.33;
  addLeg(group, [-offsetX, legHeight * 0.5, -offsetZ], legHeight, legRadius);
  addLeg(group, [offsetX, legHeight * 0.5, -offsetZ], legHeight, legRadius);
  addLeg(group, [-offsetX, legHeight * 0.5, offsetZ], legHeight, legRadius);
  addLeg(group, [offsetX, legHeight * 0.5, offsetZ], legHeight, legRadius);

  return group;
}

function buildBed(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();

  const platform = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width, height * 0.28, depth, 6, 0.06),
      createMaterial(tone(preset.accent, -0.02), 0.82, 0.05)
    ),
    "secondary"
  );
  const mattress = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.96, height * 0.24, depth * 0.94, 6, 0.06),
      createMaterial(tone(preset.color, 0.06), 0.95, 0.02)
    ),
    "primary"
  );
  const headboard = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 1.02, height * 0.54, depth * 0.08, 6, 0.05),
      createMaterial(tone(preset.color, -0.08), 0.9, 0.04)
    ),
    "secondary"
  );
  const pillowLeft = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.32, height * 0.11, depth * 0.19, 5, 0.05),
      createMaterial("#f4eee4", 0.96, 0.01)
    ),
    "primary"
  );
  const pillowRight = pillowLeft.clone();

  addMesh(group, platform, [0, height * 0.14, 0]);
  addMesh(group, mattress, [0, height * 0.37, 0]);
  addMesh(group, headboard, [0, height * 0.49, -depth * 0.46]);
  addMesh(group, pillowLeft, [-width * 0.18, height * 0.54, -depth * 0.22]);
  addMesh(group, pillowRight, [width * 0.18, height * 0.54, -depth * 0.22]);

  return group;
}

function buildCabinet(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();

  const shell = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width, height, depth, 5, 0.03),
      createMaterial(preset.color, 0.84, 0.04)
    ),
    "primary"
  );
  addMesh(group, shell, [0, height * 0.5, 0]);

  const door = markMesh(
    new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.96, height * 0.92, depth * 0.06),
      createMaterial(tone(preset.color, 0.06), 0.82, 0.03)
    ),
    "secondary"
  );
  addMesh(group, door, [0, height * 0.52, depth * 0.48]);

  const seam = markMesh(
    new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.02, height * 0.86, depth * 0.068),
      createMaterial(tone(preset.accent, -0.12), 0.65, 0.12)
    ),
    "frame"
  );
  addMesh(group, seam, [0, height * 0.52, depth * 0.49]);

  const handleLeft = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, height * 0.18, 12),
      createMaterial(METAL_SHADE, 0.32, 0.82)
    ),
    "frame"
  );
  handleLeft.rotation.z = Math.PI * 0.5;
  const handleRight = handleLeft.clone();
  addMesh(group, handleLeft, [-width * 0.12, height * 0.56, depth * 0.51]);
  addMesh(group, handleRight, [width * 0.12, height * 0.56, depth * 0.51]);

  return group;
}

function buildAppliance(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();
  const lowProfile = height <= 0.18;
  const compact = height <= 0.5;

  const shell = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width, Math.max(height * 0.96, 0.06), depth, 5, Math.min(0.06, height * 0.2)),
      createMaterial(preset.color, 0.55, 0.12)
    ),
    "primary"
  );
  addMesh(group, shell, [0, Math.max(height * 0.48, 0.03), 0]);

  const frontPanel = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.84, Math.max(height * (lowProfile ? 0.26 : 0.62), 0.04), depth * 0.04, 4, 0.02),
      createMaterial(tone(preset.accent, -0.04), 0.3, 0.55)
    ),
    "secondary"
  );
  addMesh(group, frontPanel, [0, Math.max(height * (lowProfile ? 0.56 : 0.52), 0.03), depth * 0.49]);

  if (lowProfile) {
    const topPlate = markMesh(
      new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.96, Math.max(height * 0.12, 0.02), depth * 0.96, 4, 0.02),
        createMaterial("#23272d", 0.24, 0.64)
      ),
      "frame"
    );
    addMesh(group, topPlate, [0, Math.max(height * 0.93, 0.04), 0]);

    const burnerRadius = Math.min(width, depth) * 0.12;
    [-1, 1].forEach((column) => {
      [-1, 1].forEach((row) => {
        const burner = markMesh(
          new THREE.Mesh(
            new THREE.CylinderGeometry(burnerRadius, burnerRadius, 0.012, 20),
            createMaterial("#121417", 0.22, 0.82)
          ),
          "frame"
        );
        addMesh(group, burner, [column * width * 0.22, Math.max(height * 0.99, 0.045), row * depth * 0.18]);
      });
    });

    return group;
  }

  const controlStrip = markMesh(
    new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.78, Math.max(height * 0.08, 0.025), depth * 0.05),
      createMaterial("#d9dde4", 0.48, 0.14)
    ),
    "shade"
  );
  addMesh(group, controlStrip, [0, height * 0.82, depth * 0.5]);

  if (compact) {
    const knob = markMesh(
      new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16), createMaterial("#f5f7fa", 0.42, 0.18)),
      "shade"
    );
    knob.rotation.x = Math.PI / 2;
    addMesh(group, knob, [-width * 0.18, height * 0.82, depth * 0.515]);
    addMesh(group, knob.clone(), [0, height * 0.82, depth * 0.515]);
    addMesh(group, knob.clone(), [width * 0.18, height * 0.82, depth * 0.515]);
  } else if (Math.abs(width - depth) < 0.14) {
    const door = markMesh(
      new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.2, width * 0.2, depth * 0.045, 24),
        createMaterial("#2a2f36", 0.28, 0.72)
      ),
      "secondary"
    );
    door.rotation.x = Math.PI / 2;
    addMesh(group, door, [0, height * 0.48, depth * 0.505]);
  } else {
    const window = markMesh(
      new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.52, height * 0.28, depth * 0.03, 4, 0.02),
        createMaterial("#1f2328", 0.24, 0.78)
      ),
      "secondary"
    );
    addMesh(group, window, [0, height * 0.5, depth * 0.505]);
  }

  if (height > 0.2) {
    const footHeight = Math.min(0.06, height * 0.08);
    const footRadius = Math.min(0.025, width * 0.04);
    addLeg(group, [-width * 0.34, footHeight * 0.5, -depth * 0.28], footHeight, footRadius);
    addLeg(group, [width * 0.34, footHeight * 0.5, -depth * 0.28], footHeight, footRadius);
    addLeg(group, [-width * 0.34, footHeight * 0.5, depth * 0.28], footHeight, footRadius);
    addLeg(group, [width * 0.34, footHeight * 0.5, depth * 0.28], footHeight, footRadius);
  }

  return group;
}

function buildShelf(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();
  const postRadius = Math.min(0.022, width * 0.03);
  const boardThickness = Math.min(0.05, Math.max(0.024, height * 0.03));
  const levelCount = height > 1.7 ? 5 : height > 1.25 ? 4 : height > 0.8 ? 3 : 2;
  const firstLevelY = boardThickness * 0.5;
  const spacing = levelCount > 1 ? (height - boardThickness) / (levelCount - 1) : 0;

  addLeg(group, [-width * 0.44, height * 0.5, -depth * 0.44], height, postRadius);
  addLeg(group, [width * 0.44, height * 0.5, -depth * 0.44], height, postRadius);
  addLeg(group, [-width * 0.44, height * 0.5, depth * 0.44], height, postRadius);
  addLeg(group, [width * 0.44, height * 0.5, depth * 0.44], height, postRadius);

  for (let level = 0; level < levelCount; level += 1) {
    const shelf = markMesh(
      new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.9, boardThickness, depth * 0.88, 4, 0.02),
        createMaterial(tone(preset.color, 0.04), 0.72, 0.08)
      ),
      "primary"
    );
    addMesh(group, shelf, [0, firstLevelY + spacing * level, 0]);
  }

  const brace = markMesh(
    new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.82, boardThickness * 0.6, depth * 0.04),
      createMaterial(tone(preset.accent, -0.08), 0.58, 0.22)
    ),
    "secondary"
  );
  brace.rotation.z = Math.PI * 0.12;
  addMesh(group, brace, [0, height * 0.56, -depth * 0.43]);

  return group;
}

function buildChair(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();

  const seat = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.72, height * 0.18, depth * 0.72, 6, 0.06),
      createMaterial(preset.color, 0.92, 0.03)
    ),
    "primary"
  );
  const back = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.7, height * 0.34, depth * 0.12, 6, 0.05),
      createMaterial(tone(preset.color, -0.08), 0.91, 0.03)
    ),
    "secondary"
  );

  addMesh(group, seat, [0, height * 0.46, 0]);
  addMesh(group, back, [0, height * 0.76, -depth * 0.25]);

  const legHeight = height * 0.48;
  const offsetX = width * 0.24;
  const offsetZ = depth * 0.24;
  addLeg(group, [-offsetX, legHeight * 0.5, -offsetZ], legHeight, 0.028);
  addLeg(group, [offsetX, legHeight * 0.5, -offsetZ], legHeight, 0.028);
  addLeg(group, [-offsetX, legHeight * 0.5, offsetZ], legHeight, 0.028);
  addLeg(group, [offsetX, legHeight * 0.5, offsetZ], legHeight, 0.028);

  return group;
}

function buildIsland(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();

  const base = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.9, height * 0.86, depth * 0.88, 5, 0.04),
      createMaterial(preset.color, 0.85, 0.03)
    ),
    "primary"
  );
  const slab = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width, height * 0.08, depth, 5, 0.03),
      createMaterial(tone("#f2eee7", -0.02), 0.44, 0.06)
    ),
    "shade"
  );

  addMesh(group, base, [0, height * 0.43, 0]);
  addMesh(group, slab, [0, height * 0.96, 0]);

  return group;
}

function buildPlant(preset: FurniturePreset): THREE.Group {
  const [width, height] = preset.size;
  const group = new THREE.Group();

  const pot = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.2, width * 0.28, height * 0.2, 24),
      createMaterial(preset.accent, 0.85, 0.02)
    ),
    "pot"
  );
  const trunk = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.04, width * 0.05, height * 0.72, 12),
      createMaterial("#6f513f", 0.92, 0.02)
    ),
    "frame"
  );
  const crownMain = markMesh(
    new THREE.Mesh(
      new THREE.SphereGeometry(width * 0.28, 24, 18),
      createMaterial(preset.color, 0.96, 0.01)
    ),
    "leaf"
  );
  const crownSide = crownMain.clone();
  const crownRear = crownMain.clone();

  addMesh(group, pot, [0, height * 0.1, 0]);
  addMesh(group, trunk, [0, height * 0.46, 0]);
  addMesh(group, crownMain, [0, height * 0.9, 0]);
  addMesh(group, crownSide, [width * 0.16, height * 0.8, width * 0.08]);
  addMesh(group, crownRear, [-width * 0.14, height * 0.83, -width * 0.12]);

  return group;
}

function buildRug(preset: FurniturePreset): THREE.Group {
  const [width, height, depth] = preset.size;
  const group = new THREE.Group();
  const rug = markMesh(
    new THREE.Mesh(
      new RoundedBoxGeometry(width, height, depth, 4, 0.02),
      createMaterial(preset.color, 1, 0)
    ),
    "primary"
  );
  addMesh(group, rug, [0, height * 0.5, 0]);

  const stripe = markMesh(
    new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.84, height * 0.2, depth * 0.08),
      createMaterial(tone(preset.accent, 0.05), 1, 0)
    ),
    "secondary"
  );
  addMesh(group, stripe, [0, height * 0.65, 0]);

  return group;
}

function buildLamp(preset: FurniturePreset): THREE.Group {
  const [width, height] = preset.size;
  const group = new THREE.Group();

  const base = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.16, width * 0.18, height * 0.04, 24),
      createMaterial(METAL_SHADE, 0.3, 0.82)
    ),
    "frame"
  );
  const pole = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.03, width * 0.03, height * 0.74, 18),
      createMaterial(METAL_SHADE, 0.3, 0.82)
    ),
    "frame"
  );
  const shade = markMesh(
    new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.23, width * 0.3, height * 0.24, 24, 1, true),
      createMaterial(preset.color, 0.9, 0.02)
    ),
    "shade"
  );

  addMesh(group, base, [0, height * 0.02, 0]);
  addMesh(group, pole, [0, height * 0.41, 0]);
  addMesh(group, shade, [0, height * 0.84, 0]);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(width * 0.08, 16, 12),
    new THREE.MeshStandardMaterial({
      color: "#ffe8bf",
      emissive: "#f7c86e",
      emissiveIntensity: 1.25,
      roughness: 0.5,
      metalness: 0
    })
  );
  bulb.castShadow = true;
  bulb.receiveShadow = true;
  addMesh(group, bulb, [0, height * 0.77, 0]);

  return group;
}

export function applyFurnitureColor(group: THREE.Group, baseColor: string, accentColor: string): void {
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const material = node.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      return;
    }

    const tintRole = node.userData.tintRole as TintRole | undefined;
    if (!tintRole) {
      return;
    }

    switch (tintRole) {
      case "primary":
        material.color.copy(tone(baseColor, 0.02));
        break;
      case "secondary":
        material.color.copy(tone(baseColor, -0.08));
        break;
      case "frame":
        material.color.copy(tone(accentColor, -0.12));
        break;
      case "leaf":
        material.color.copy(tone(baseColor, -0.02, 0.04));
        break;
      case "pot":
        material.color.copy(tone(accentColor, 0.02));
        break;
      case "shade":
        material.color.copy(tone(baseColor, 0.14));
        break;
    }
  });
}

export function createFurnitureAsset(preset: FurniturePreset, colorOverride?: string): THREE.Group {
  let asset: THREE.Group;

  switch (preset.model) {
    case "sofa":
      asset = buildSofa(preset);
      break;
    case "table":
      asset = buildTable(preset);
      break;
    case "bed":
      asset = buildBed(preset);
      break;
    case "cabinet":
      asset = buildCabinet(preset);
      break;
    case "plant":
      asset = buildPlant(preset);
      break;
    case "chair":
      asset = buildChair(preset);
      break;
    case "island":
      asset = buildIsland(preset);
      break;
    case "rug":
      asset = buildRug(preset);
      break;
    case "lamp":
      asset = buildLamp(preset);
      break;
    case "appliance":
      asset = buildAppliance(preset);
      break;
    case "shelf":
      asset = buildShelf(preset);
      break;
  }

  asset.userData.accentColor = preset.accent;
  applyFurnitureColor(asset, colorOverride ?? preset.color, preset.accent);
  return asset;
}
