import type { FurniturePreset, RoomSettings, TemplateConfig } from "./types";

export const DEFAULT_ROOM: RoomSettings = {
  width: 8.4,
  depth: 6.6,
  height: 3.2,
  floorColor: "#d6bea1",
  wallColor: "#f4efe6",
  daylight: 82
};

function createPreset(
  id: string,
  label: string,
  category: string,
  model: FurniturePreset["model"],
  size: [number, number, number],
  color: string,
  accent: string
): FurniturePreset {
  return {
    id,
    label,
    category,
    tagline: "",
    model,
    size,
    color,
    accent
  };
}

export const FURNITURE_PRESETS: FurniturePreset[] = [
  createPreset("refrigerator", "양문형 냉장고", "냉장고", "cabinet", [0.95, 1.9, 0.75], "#d9dde1", "#9099a3"),
  createPreset("single-door-refrigerator", "단문형 냉장고", "냉장고", "cabinet", [0.62, 1.85, 0.68], "#e3e7eb", "#9aa3ad"),
  createPreset("kimchi-fridge", "김치냉장고", "냉장고", "cabinet", [0.9, 0.92, 0.72], "#dadfe5", "#8e98a2"),

  createPreset("top-load-washer", "일반 세탁기", "세탁기·건조기", "appliance", [0.62, 0.95, 0.65], "#f4f6f8", "#a0a7af"),
  createPreset("drum-washer", "드럼 세탁기", "세탁기·건조기", "appliance", [0.7, 0.95, 0.72], "#f3f5f7", "#88919c"),
  createPreset("dryer", "건조기", "세탁기·건조기", "appliance", [0.7, 0.92, 0.72], "#eef1f4", "#8d959d"),
  createPreset("washer-dryer", "세탁기+건조기", "세탁기·건조기", "appliance", [0.7, 1.9, 0.75], "#eef1f4", "#8d959d"),

  createPreset("gas-range", "가스레인지", "가스레인지·인덕션", "appliance", [0.6, 0.14, 0.52], "#444a52", "#0f1115"),
  createPreset("induction", "인덕션", "가스레인지·인덕션", "appliance", [0.58, 0.08, 0.52], "#1e2329", "#8aa1b5"),

  createPreset("microwave", "전자레인지", "오븐·전자레인지", "appliance", [0.52, 0.34, 0.42], "#d8d8d6", "#4a4742"),
  createPreset("steam-oven", "광파오븐", "오븐·전자레인지", "appliance", [0.6, 0.42, 0.48], "#d3d2ce", "#5a5750"),

  createPreset("air-fryer", "에어프라이어", "에어프라이어·튀김기", "appliance", [0.34, 0.38, 0.32], "#2f3136", "#8d9199"),
  createPreset("air-fryer-oven", "오븐형 에어프라이어", "에어프라이어·튀김기", "appliance", [0.42, 0.46, 0.4], "#2f3136", "#9ca3af"),

  createPreset("rice-cooker", "전기밥솥", "전기밥솥", "appliance", [0.32, 0.3, 0.32], "#f5f1ec", "#a7a09a"),
  createPreset("multi-cooker", "멀티쿠커", "전기쿠커", "appliance", [0.36, 0.3, 0.32], "#f0ece8", "#a49d95"),
  createPreset("water-purifier", "정수기", "정수기", "appliance", [0.32, 1.05, 0.34], "#f1f3f5", "#a1a8b0"),
  createPreset("electric-kettle", "전기포트", "전기·멀티포트", "appliance", [0.22, 0.28, 0.22], "#efebe6", "#77716a"),
  createPreset("coffee-machine", "커피머신", "커피메이커·머신", "appliance", [0.3, 0.38, 0.34], "#2f3135", "#9a8d80"),
  createPreset("blender", "믹서기", "믹서·착즙기", "appliance", [0.22, 0.42, 0.22], "#dde3e8", "#73808b"),
  createPreset("dishwasher", "식기세척기", "식기세척기·건조기", "appliance", [0.6, 0.85, 0.6], "#d8d8d6", "#4c4a45"),
  createPreset("food-waste-processor", "음식물처리기", "음식물처리기", "appliance", [0.32, 0.46, 0.32], "#ced7cf", "#667060"),
  createPreset("toaster", "토스터", "토스터·와플메이커", "appliance", [0.34, 0.24, 0.22], "#e9ddd0", "#8d6c55"),

  createPreset("microwave-rack", "전자레인지 선반", "주방선반·정리대", "shelf", [0.72, 1.25, 0.45], "#dfd9d1", "#7a6f63"),
  createPreset("oven-rack", "오븐랙", "주방선반·정리대", "shelf", [0.82, 1.45, 0.46], "#d9d2ca", "#6b635b"),
  createPreset("sliding-shelf", "슬라이딩 선반", "주방선반·정리대", "shelf", [0.7, 0.62, 0.44], "#e8e1d6", "#786d5d"),
  createPreset("utility-organizer", "다용도 정리선반", "주방선반·정리대", "shelf", [0.9, 1.6, 0.36], "#ddd6ce", "#6a6158"),
  createPreset("pantry-shelf", "팬트리 선반", "주방선반·정리대", "shelf", [1.1, 1.8, 0.42], "#d5cdc4", "#5f564d"),

  createPreset("air-purifier", "공기청정기", "생활·건강가전", "appliance", [0.38, 1.08, 0.38], "#edf1f4", "#a1aab3"),
  createPreset("robot-vacuum", "로봇청소기", "생활·건강가전", "appliance", [0.38, 0.11, 0.38], "#2f3238", "#888d94"),

  createPreset("sofa", "클라우드 소파", "거실", "sofa", [2.4, 0.86, 0.98], "#c2a58a", "#7b6858"),
  createPreset("coffee-table", "커피 테이블", "거실", "table", [1.2, 0.38, 0.7], "#8f715c", "#34261d"),
  createPreset("chair", "독서 의자", "거실", "chair", [0.9, 0.88, 0.9], "#ba6e53", "#623d31"),
  createPreset("bed", "퀸 침대", "침실", "bed", [2.1, 1.05, 1.9], "#d9cec1", "#8c715f"),
  createPreset("dining-table", "식탁", "다이닝", "table", [1.8, 0.76, 0.92], "#a2876d", "#2f241d"),
  createPreset("island", "주방 아일랜드", "다이닝", "island", [1.6, 0.95, 0.8], "#e2d8ca", "#8d6b55"),
  createPreset("cabinet", "수납장", "수납", "cabinet", [1.8, 2.1, 0.45], "#c8baa4", "#5b4b40"),
  createPreset("plant", "실내 식물", "데코", "plant", [0.8, 1.7, 0.8], "#6a7b4e", "#9a785c"),
  createPreset("rug", "러그", "데코", "rug", [2.8, 0.04, 1.8], "#e7ddd2", "#b38a6c"),
  createPreset("lamp", "플로어 램프", "데코", "lamp", [0.42, 1.7, 0.42], "#efe4d5", "#3a2d27")
];

export const DESIGN_TEMPLATES: TemplateConfig[] = [
  {
    id: "draft-apartment",
    label: "아파트 초안",
    description: "벽을 한 구간씩 수정하기 좋은 좁은 아파트 골조입니다.",
    room: {
      width: 5.6,
      depth: 13.2,
      height: 3.1,
      floorColor: "#d8b384",
      wallColor: "#f3efe7",
      daylight: 78
    },
    objects: [
      {
        presetId: "rug",
        position: [-1.1, 0, 4.65],
        rotationY: 0,
        scale: [0.95, 1, 0.85],
        color: "#dec7b0",
        label: "침실 러그"
      },
      {
        presetId: "chair",
        position: [-0.2, 0, -0.35],
        rotationY: -0.8,
        scale: [0.9, 0.9, 0.9],
        color: "#b76f57",
        label: "포인트 체어"
      },
      {
        presetId: "cabinet",
        position: [2.0, 0, 4.8],
        rotationY: 0,
        scale: [0.75, 1, 0.8],
        color: "#c7b9a5",
        label: "현관 수납장"
      }
    ],
    walls: [
      {
        start: [-2.76, -1.5],
        end: [0.9, -1.5],
        thickness: 0.14,
        height: 2.8,
        color: "#f3efe7",
        label: "거실 칸막이벽"
      },
      {
        start: [0.9, -1.5],
        end: [0.9, 2.55],
        thickness: 0.14,
        height: 2.8,
        color: "#f3efe7",
        label: "복도 벽"
      },
      {
        start: [-2.76, 3.0],
        end: [0.55, 3.0],
        thickness: 0.14,
        height: 2.8,
        color: "#f3efe7",
        label: "침실 칸막이벽"
      },
      {
        start: [0.55, 3.0],
        end: [0.55, 6.25],
        thickness: 0.14,
        height: 2.8,
        color: "#f3efe7",
        label: "욕실 경계벽"
      },
      {
        start: [-0.15, 4.35],
        end: [0.55, 4.35],
        thickness: 0.14,
        height: 2.8,
        color: "#f3efe7",
        label: "보조 칸막이벽"
      }
    ]
  },
  {
    id: "loft",
    label: "로프트 거실",
    description: "조형적인 좌석 배치와 다이닝 존이 있는 오픈 라운지입니다.",
    room: {
      width: 8.8,
      depth: 7.2,
      height: 3.4,
      floorColor: "#cfb896",
      wallColor: "#f3ede3",
      daylight: 86
    },
    objects: [
      {
        presetId: "rug",
        position: [0.15, 0, 0.9],
        rotationY: 0.02,
        scale: [1.08, 1, 1.08],
        color: "#e8dfd3",
        label: "거실 러그"
      },
      {
        presetId: "sofa",
        position: [-1.2, 0, 1.15],
        rotationY: 0.16,
        scale: [1, 1, 1],
        color: "#c4ab93",
        label: "라운지 소파"
      },
      {
        presetId: "chair",
        position: [1.65, 0, 0.25],
        rotationY: -0.7,
        scale: [1, 1, 1],
        color: "#b76f57",
        label: "포인트 체어"
      },
      {
        presetId: "coffee-table",
        position: [0.05, 0, 0.95],
        rotationY: -0.06,
        scale: [1, 1, 1],
        color: "#8f715c",
        label: "스톤 테이블"
      },
      {
        presetId: "dining-table",
        position: [2.15, 0, -1.15],
        rotationY: -0.1,
        scale: [1, 1, 1],
        color: "#9f846c",
        label: "식탁"
      },
      {
        presetId: "plant",
        position: [-3.15, 0, -2.45],
        rotationY: 0,
        scale: [1.08, 1.08, 1.08],
        color: "#6b7d4e",
        label: "실내 식물"
      },
      {
        presetId: "cabinet",
        position: [-2.7, 0, -3.18],
        rotationY: 0,
        scale: [1, 1, 1],
        color: "#cbbda6",
        label: "수납장"
      },
      {
        presetId: "lamp",
        position: [2.7, 0, 2.2],
        rotationY: 0,
        scale: [1, 1, 1],
        color: "#ece2d4",
        label: "플로어 램프"
      }
    ]
  },
  {
    id: "suite",
    label: "스위트 침실",
    description: "수납장과 라운지 가구가 함께 있는 침실 중심 스위트입니다.",
    room: {
      width: 7.4,
      depth: 6.8,
      height: 3.1,
      floorColor: "#ceb59a",
      wallColor: "#f7f1e9",
      daylight: 74
    },
    objects: [
      {
        presetId: "bed",
        position: [-1.15, 0, -1.55],
        rotationY: 0,
        scale: [1, 1, 1],
        color: "#ddd2c5",
        label: "플랫폼 침대"
      },
      {
        presetId: "rug",
        position: [-1.05, 0, -0.7],
        rotationY: 0.02,
        scale: [1.1, 1, 1.16],
        color: "#eadfcf",
        label: "침실 러그"
      },
      {
        presetId: "cabinet",
        position: [2.45, 0, -2.88],
        rotationY: 0,
        scale: [0.9, 1, 0.95],
        color: "#cbbca5",
        label: "옷장"
      },
      {
        presetId: "chair",
        position: [2.05, 0, 1.35],
        rotationY: -1.2,
        scale: [1, 1, 1],
        color: "#b66c52",
        label: "독서 의자"
      },
      {
        presetId: "coffee-table",
        position: [1.1, 0, 1.6],
        rotationY: 0.16,
        scale: [0.9, 1, 0.9],
        color: "#93745f",
        label: "사이드 테이블"
      },
      {
        presetId: "plant",
        position: [-2.85, 0, 2.42],
        rotationY: 0,
        scale: [0.9, 1, 0.9],
        color: "#67784d",
        label: "그린 포인트"
      },
      {
        presetId: "lamp",
        position: [-0.1, 0, 1.9],
        rotationY: 0,
        scale: [1, 1, 1],
        color: "#f0e5d6",
        label: "독서등"
      }
    ]
  }
];
