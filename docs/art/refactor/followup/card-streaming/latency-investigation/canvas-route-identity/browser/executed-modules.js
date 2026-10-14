var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// canvas-route-proof:atlas-before
var atlas_before_exports = {};
__export(atlas_before_exports, {
  PAPER_BASE: () => PAPER_BASE,
  canvasArtCacheStats: () => canvasArtCacheStats,
  clearCanvasArtCache: () => clearCanvasArtCache,
  drawAtlasBuilding: () => drawAtlasBuilding,
  drawAtlasBuildingPortrait: () => drawAtlasBuildingPortrait,
  drawAtlasCamp: () => drawAtlasCamp,
  drawAtlasCorpse: () => drawAtlasCorpse,
  drawAtlasGround: () => drawAtlasGround,
  drawAtlasLandmark: () => paintLandmark,
  drawAtlasMine: () => drawAtlasMine,
  drawAtlasModel: () => drawAtlasModel,
  drawAtlasObstacle: () => paintObstacle,
  drawAtlasProp: () => drawAtlasProp,
  drawAtlasShop: () => drawAtlasShop,
  drawAtlasTree: () => paintTree,
  drawAtlasUnit: () => drawAtlasUnit,
  drawAtlasUnitFigure: () => drawAtlasUnitFigure,
  drawAtlasUnitPortrait: () => drawAtlasUnitPortrait,
  obstacleArtTop: () => obstacleArtTop
});

// src/shared/generated/ship-geometry.json
var ship_geometry_default = {
  sourceSha256: "22acecf80139ea9f084dbc3411a61d94128d400092ef1428e3a45ee86f5ea01e",
  camera: {
    tilt: 0.72,
    frameSize: 384,
    worldSize: 360,
    directions: 32,
    anchorY: 24
  },
  ships: {
    cutter: {
      length: 116,
      beam: 46,
      deckHeight: 18,
      hullMass: 7e3,
      loadCapacity: 450,
      acceleration: 72,
      turnRate: 0.628318531,
      obstacles: [
        {
          x: -35,
          y: 0,
          radius: 6,
          type: "mast"
        },
        {
          x: -39,
          y: 0,
          radius: 14,
          type: "cabin"
        }
      ],
      weaponMount: [
        31,
        0,
        11
      ],
      mastHeight: 78,
      weaponPivot: null,
      hull: [
        [
          -58,
          -12.88
        ],
        [
          -51.04,
          -18.86
        ],
        [
          -31.900000000000002,
          -23
        ],
        [
          0,
          -23
        ],
        [
          23.200000000000003,
          -20.7
        ],
        [
          42.339999999999996,
          -12.88
        ],
        [
          58,
          0
        ],
        [
          42.339999999999996,
          12.88
        ],
        [
          23.200000000000003,
          20.7
        ],
        [
          0,
          23
        ],
        [
          -31.900000000000002,
          23
        ],
        [
          -51.04,
          18.86
        ],
        [
          -58,
          12.88
        ]
      ],
      deck: [
        [
          -53,
          -10.080000000000002
        ],
        [
          -46.64,
          -14.76
        ],
        [
          -29.150000000000002,
          -18
        ],
        [
          0,
          -18
        ],
        [
          21.200000000000003,
          -16.2
        ],
        [
          38.69,
          -10.080000000000002
        ],
        [
          53,
          0
        ],
        [
          38.69,
          10.080000000000002
        ],
        [
          21.200000000000003,
          16.2
        ],
        [
          0,
          18
        ],
        [
          -29.150000000000002,
          18
        ],
        [
          -46.64,
          14.76
        ],
        [
          -53,
          10.080000000000002
        ]
      ]
    },
    transport: {
      length: 184,
      beam: 80,
      deckHeight: 26,
      hullMass: 14e3,
      loadCapacity: 1800,
      acceleration: 48,
      turnRate: 0.383972435,
      obstacles: [
        {
          x: -50,
          y: 0,
          radius: 6,
          type: "mast"
        },
        {
          x: -63,
          y: 0,
          radius: 23,
          type: "cabin"
        }
      ],
      weaponMount: null,
      mastHeight: 64,
      weaponPivot: null,
      hull: [
        [
          -92,
          -22.400000000000002
        ],
        [
          -80.96,
          -32.8
        ],
        [
          -50.6,
          -40
        ],
        [
          0,
          -40
        ],
        [
          36.800000000000004,
          -36
        ],
        [
          67.16,
          -22.400000000000002
        ],
        [
          92,
          0
        ],
        [
          67.16,
          22.400000000000002
        ],
        [
          36.800000000000004,
          36
        ],
        [
          0,
          40
        ],
        [
          -50.6,
          40
        ],
        [
          -80.96,
          32.8
        ],
        [
          -92,
          22.400000000000002
        ]
      ],
      deck: [
        [
          -87,
          -19.6
        ],
        [
          -76.56,
          -28.7
        ],
        [
          -47.85,
          -35
        ],
        [
          0,
          -35
        ],
        [
          34.800000000000004,
          -31.5
        ],
        [
          63.51,
          -19.6
        ],
        [
          87,
          0
        ],
        [
          63.51,
          19.6
        ],
        [
          34.800000000000004,
          31.5
        ],
        [
          0,
          35
        ],
        [
          -47.85,
          35
        ],
        [
          -76.56,
          28.7
        ],
        [
          -87,
          19.6
        ]
      ]
    },
    warship: {
      length: 170,
      beam: 72,
      deckHeight: 28,
      hullMass: 23e3,
      loadCapacity: 850,
      acceleration: 44,
      turnRate: 0.314159265,
      obstacles: [
        {
          x: -45,
          y: 0,
          radius: 6,
          type: "mast"
        },
        {
          x: 34,
          y: 0,
          radius: 16,
          type: "gun"
        },
        {
          x: -58,
          y: 0,
          radius: 23,
          type: "cabin"
        }
      ],
      weaponMount: [
        60,
        0,
        35
      ],
      mastHeight: 102,
      weaponPivot: [
        34,
        0,
        28
      ],
      hull: [
        [
          -85,
          -20.160000000000004
        ],
        [
          -74.8,
          -29.52
        ],
        [
          -46.75000000000001,
          -36
        ],
        [
          0,
          -36
        ],
        [
          34,
          -32.4
        ],
        [
          62.05,
          -20.160000000000004
        ],
        [
          85,
          0
        ],
        [
          62.05,
          20.160000000000004
        ],
        [
          34,
          32.4
        ],
        [
          0,
          36
        ],
        [
          -46.75000000000001,
          36
        ],
        [
          -74.8,
          29.52
        ],
        [
          -85,
          20.160000000000004
        ]
      ],
      deck: [
        [
          -80,
          -17.360000000000003
        ],
        [
          -70.4,
          -25.419999999999998
        ],
        [
          -44,
          -31
        ],
        [
          0,
          -31
        ],
        [
          32,
          -27.900000000000002
        ],
        [
          58.4,
          -17.360000000000003
        ],
        [
          80,
          0
        ],
        [
          58.4,
          17.360000000000003
        ],
        [
          32,
          27.900000000000002
        ],
        [
          0,
          31
        ],
        [
          -44,
          31
        ],
        [
          -70.4,
          25.419999999999998
        ],
        [
          -80,
          17.360000000000003
        ]
      ]
    },
    bombardShip: {
      length: 184,
      beam: 70,
      deckHeight: 30,
      hullMass: 31e3,
      loadCapacity: 1300,
      acceleration: 30,
      turnRate: 0.226892803,
      obstacles: [
        {
          x: -50,
          y: 0,
          radius: 6,
          type: "mast"
        },
        {
          x: 30,
          y: 0,
          radius: 23,
          type: "mortar"
        },
        {
          x: -63,
          y: 0,
          radius: 23,
          type: "cabin"
        }
      ],
      weaponMount: [
        38,
        0,
        54
      ],
      mastHeight: 58,
      weaponPivot: [
        30,
        0,
        30
      ],
      hull: [
        [
          -92,
          -19.6
        ],
        [
          -80.96,
          -28.7
        ],
        [
          -50.6,
          -35
        ],
        [
          0,
          -35
        ],
        [
          36.800000000000004,
          -31.5
        ],
        [
          67.16,
          -19.6
        ],
        [
          92,
          0
        ],
        [
          67.16,
          19.6
        ],
        [
          36.800000000000004,
          31.5
        ],
        [
          0,
          35
        ],
        [
          -50.6,
          35
        ],
        [
          -80.96,
          28.7
        ],
        [
          -92,
          19.6
        ]
      ],
      deck: [
        [
          -87,
          -16.8
        ],
        [
          -76.56,
          -24.599999999999998
        ],
        [
          -47.85,
          -30
        ],
        [
          0,
          -30
        ],
        [
          34.800000000000004,
          -27
        ],
        [
          63.51,
          -16.8
        ],
        [
          87,
          0
        ],
        [
          63.51,
          16.8
        ],
        [
          34.800000000000004,
          27
        ],
        [
          0,
          30
        ],
        [
          -47.85,
          30
        ],
        [
          -76.56,
          24.599999999999998
        ],
        [
          -87,
          16.8
        ]
      ]
    },
    fireShip: {
      length: 158,
      beam: 60,
      deckHeight: 26,
      hullMass: 19e3,
      loadCapacity: 700,
      acceleration: 56,
      turnRate: 0.453785606,
      obstacles: [
        {
          x: -41,
          y: 0,
          radius: 6,
          type: "mast"
        },
        {
          x: 25,
          y: 0,
          radius: 18,
          type: "flame"
        },
        {
          x: -54,
          y: 0,
          radius: 23,
          type: "cabin"
        }
      ],
      weaponMount: [
        67,
        0,
        32
      ],
      mastHeight: 44,
      weaponPivot: [
        25,
        0,
        26
      ],
      hull: [
        [
          -79,
          -16.8
        ],
        [
          -69.52,
          -24.599999999999998
        ],
        [
          -43.45,
          -30
        ],
        [
          0,
          -30
        ],
        [
          31.6,
          -27
        ],
        [
          57.67,
          -16.8
        ],
        [
          79,
          0
        ],
        [
          57.67,
          16.8
        ],
        [
          31.6,
          27
        ],
        [
          0,
          30
        ],
        [
          -43.45,
          30
        ],
        [
          -69.52,
          24.599999999999998
        ],
        [
          -79,
          16.8
        ]
      ],
      deck: [
        [
          -74,
          -14.000000000000002
        ],
        [
          -65.12,
          -20.5
        ],
        [
          -40.7,
          -25
        ],
        [
          0,
          -25
        ],
        [
          29.6,
          -22.5
        ],
        [
          54.019999999999996,
          -14.000000000000002
        ],
        [
          74,
          0
        ],
        [
          54.019999999999996,
          14.000000000000002
        ],
        [
          29.6,
          22.5
        ],
        [
          0,
          25
        ],
        [
          -40.7,
          25
        ],
        [
          -65.12,
          20.5
        ],
        [
          -74,
          14.000000000000002
        ]
      ]
    },
    carrier: {
      length: 224,
      beam: 106,
      deckHeight: 32,
      hullMass: 55e3,
      loadCapacity: 5200,
      acceleration: 32,
      turnRate: 0.20943951,
      obstacles: [
        {
          x: -60,
          y: 0,
          radius: 8,
          type: "mast"
        },
        {
          x: 26,
          y: 0,
          radius: 8,
          type: "mast"
        },
        {
          x: -76,
          y: 0,
          radius: 26,
          type: "cabin"
        }
      ],
      weaponMount: null,
      mastHeight: 128,
      weaponPivot: null,
      hull: [
        [
          -112,
          -29.680000000000003
        ],
        [
          -98.56,
          -43.46
        ],
        [
          -61.60000000000001,
          -53
        ],
        [
          0,
          -53
        ],
        [
          44.800000000000004,
          -47.7
        ],
        [
          81.75999999999999,
          -29.680000000000003
        ],
        [
          112,
          0
        ],
        [
          81.75999999999999,
          29.680000000000003
        ],
        [
          44.800000000000004,
          47.7
        ],
        [
          0,
          53
        ],
        [
          -61.60000000000001,
          53
        ],
        [
          -98.56,
          43.46
        ],
        [
          -112,
          29.680000000000003
        ]
      ],
      deck: [
        [
          -107,
          -26.880000000000003
        ],
        [
          -94.16,
          -39.36
        ],
        [
          -58.85,
          -48
        ],
        [
          0,
          -48
        ],
        [
          42.800000000000004,
          -43.2
        ],
        [
          78.11,
          -26.880000000000003
        ],
        [
          107,
          0
        ],
        [
          78.11,
          26.880000000000003
        ],
        [
          42.800000000000004,
          43.2
        ],
        [
          0,
          48
        ],
        [
          -58.85,
          48
        ],
        [
          -94.16,
          39.36
        ],
        [
          -107,
          26.880000000000003
        ]
      ]
    },
    shipOfTheLine: {
      length: 292,
      beam: 144,
      deckHeight: 38,
      hullMass: 72e3,
      loadCapacity: 3800,
      acceleration: 24,
      turnRate: 0.148352986,
      obstacles: [
        {
          x: -53,
          y: 0,
          radius: 4,
          type: "mast"
        },
        {
          x: -10,
          y: 0,
          radius: 4,
          type: "mast"
        },
        {
          x: 76,
          y: 0,
          radius: 4,
          type: "mast"
        },
        {
          x: -126,
          y: 0,
          radius: 20,
          type: "cabin"
        }
      ],
      weaponMount: null,
      mastHeight: 150,
      mastHeights: [
        118,
        150,
        136
      ],
      mastBeamScales: [
        0.79,
        1,
        0.88
      ],
      weaponPivot: null,
      hull: [
        [
          -146,
          -40.32000000000001
        ],
        [
          -128.48,
          -59.04
        ],
        [
          -80.30000000000001,
          -72
        ],
        [
          0,
          -72
        ],
        [
          58.400000000000006,
          -64.8
        ],
        [
          106.58,
          -40.32000000000001
        ],
        [
          146,
          0
        ],
        [
          106.58,
          40.32000000000001
        ],
        [
          58.400000000000006,
          64.8
        ],
        [
          0,
          72
        ],
        [
          -80.30000000000001,
          72
        ],
        [
          -128.48,
          59.04
        ],
        [
          -146,
          40.32000000000001
        ]
      ],
      deck: [
        [
          -141,
          -37.52
        ],
        [
          -124.08,
          -54.94
        ],
        [
          -77.55000000000001,
          -67
        ],
        [
          0,
          -67
        ],
        [
          56.400000000000006,
          -60.300000000000004
        ],
        [
          102.92999999999999,
          -37.52
        ],
        [
          141,
          0
        ],
        [
          102.92999999999999,
          37.52
        ],
        [
          56.400000000000006,
          60.300000000000004
        ],
        [
          0,
          67
        ],
        [
          -77.55000000000001,
          67
        ],
        [
          -124.08,
          54.94
        ],
        [
          -141,
          37.52
        ]
      ]
    }
  }
};

// src/shared/det-math.ts
var S1 = -0.16666666666666632;
var S2 = 0.00833333333332249;
var S3 = -1984126982985795e-19;
var S4 = 27557313707070068e-22;
var S5 = -25050760253406863e-24;
var S6 = 158969099521155e-24;
var C1 = 0.0416666666666666;
var C2 = -0.001388888888887411;
var C3 = 2480158728947673e-20;
var C4 = -27557314351390663e-23;
var C5 = 2087572321298175e-24;
var C6 = -11359647557788195e-27;
var INV_PIO2 = 0.6366197723675814;
var PIO2_1 = 1.5707963267341256;
var PIO2_1T = 6077100506506192e-26;
var PIO2_2 = 6077100506303966e-26;
var PIO2_2T = 20222662487959506e-37;
var PI_4 = 0.7853981633974483;
var MAX_ARGUMENT = 823549.6;
function kernelSin(x, y, hasTail) {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (!hasTail) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}
function kernelCos(x, y) {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const u = 1 - hz;
  return u + (1 - u - hz + (z * r - x * y));
}
function reduce(x) {
  if (!(Math.abs(x) <= MAX_ARGUMENT)) throw new Error(`det-math: angle ${x} outside the supported range`);
  const n = Math.round(x * INV_PIO2);
  const first = x - n * PIO2_1;
  let w = n * PIO2_1T;
  const r = first - n * PIO2_2;
  w = n * PIO2_2T - (first - r - n * PIO2_2);
  const head = r - w;
  return { n, head, tail: r - head - w };
}
function detCos(x) {
  if (Number.isNaN(x) || !Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= PI_4) return kernelCos(x, 0);
  const { n, head, tail } = reduce(x);
  switch (n & 3) {
    case 0:
      return kernelCos(head, tail);
    case 1:
      return -kernelSin(head, tail, true);
    case 2:
      return -kernelCos(head, tail);
    default:
      return kernelSin(head, tail, true);
  }
}

// src/shared/ship-geometry.ts
var shipGeometry = ship_geometry_default.ships;
var SHIP_CAMERA = ship_geometry_default.camera;
var SHIP_KINDS = Object.keys(shipGeometry);
var SHIP_SIZE_MULTIPLIER = 1.2;
var AUTHORED_DEFAULT_SHIP_SCALE = 1.1;
var DEFAULT_SHIP_SCALE = AUTHORED_DEFAULT_SHIP_SCALE * SHIP_SIZE_MULTIPLIER;
function isShipKind(kind) {
  return kind in shipGeometry;
}

// src/client/art/scratch-canvas.ts
var factory;
function createScratchCanvas(width, height2) {
  if (factory) return factory(width, height2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height2;
  return canvas;
}

// src/client/art/raster-cache.ts
var ART_TILE_SIZE = 128;
var ART_ACTION_SIZE = 176;
var RasterCache = class {
  constructor(budget = 12 * 1024 * 1024, limit = 1024) {
    this.budget = budget;
    this.limit = limit;
  }
  budget;
  limit;
  entries = /* @__PURE__ */ new Map();
  scratch = [];
  spare = [];
  retired = [];
  depth = 0;
  leased = /* @__PURE__ */ new Set();
  epoch = 0;
  pixels = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  get(key, density, paint, tileSize = ART_TILE_SIZE) {
    if (!this.depth) this.recycleRetired();
    const id = `${key}:${density}:${tileSize}`;
    const cached = this.entries.get(id);
    if (cached) {
      this.hits++;
      this.entries.delete(id);
      this.entries.set(id, cached);
      return cached;
    }
    this.misses++;
    const origin = tileSize / 2, size = tileSize * density;
    const epoch = this.epoch, source = this.take(this.scratch, size, size);
    this.leased.add(source);
    const brush = this.reset(source, true);
    brush.scale(density, density);
    brush.translate(origin, origin);
    brush.lineJoin = brush.lineCap = "round";
    this.depth++;
    try {
      paint(brush);
      const rgba = brush.getImageData(0, 0, size, size).data;
      let left = size, top = size, right = -1, bottom = -1;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (rgba[(y * size + x) * 4 + 3]) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      if (right < left) {
        left = top = 0;
        right = bottom = 0;
      }
      left = Math.max(0, left - 2);
      top = Math.max(0, top - 2);
      right = Math.min(size - 1, right + 2);
      bottom = Math.min(size - 1, bottom + 2);
      const canvas = this.take(this.spare, right - left + 1, bottom - top + 1);
      this.reset(canvas).drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const result = { canvas, x: left / density - origin, y: top / density - origin, density };
      const cost = canvas.width * canvas.height;
      while (epoch === this.epoch && cost <= this.budget && this.entries.size && (this.entries.size >= this.limit || this.pixels + cost > this.budget)) {
        const oldest = this.entries.keys().next().value;
        const old = this.entries.get(oldest);
        this.pixels -= old.canvas.width * old.canvas.height;
        this.entries.delete(oldest);
        this.evictions++;
        this.retired.push(old.canvas);
      }
      if (epoch === this.epoch && cost <= this.budget) {
        this.entries.set(id, result);
        this.pixels += cost;
      } else this.retired.push(canvas);
      return result;
    } finally {
      this.depth--;
      this.leased.delete(source);
      if (epoch === this.epoch) this.put(this.scratch, source, 4, 4 * 1024 * 1024);
      else this.release(source);
    }
  }
  take(pool, width, height2) {
    const index = pool.findIndex((canvas) => canvas.width === width && canvas.height === height2);
    return index < 0 ? createScratchCanvas(width, height2) : pool.splice(index, 1)[0];
  }
  reset(canvas, read = false) {
    const ctx = canvas.getContext("2d", read ? { willReadFrequently: true } : void 0);
    if (typeof ctx.reset === "function") ctx.reset();
    else canvas.width = canvas.width;
    return ctx;
  }
  release(canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }
  put(pool, canvas, limit, budget) {
    const cost = canvas.width * canvas.height;
    if (cost > budget) {
      this.release(canvas);
      return;
    }
    while (pool.length && (pool.length >= limit || pool.reduce((sum, c) => sum + c.width * c.height, 0) + cost > budget)) this.release(pool.shift());
    pool.push(canvas);
  }
  recycleRetired() {
    for (const canvas of this.retired) this.put(this.spare, canvas, 8, 1024 * 1024);
    this.retired.length = 0;
  }
  stats() {
    const pixels = (canvases) => {
      let sum = 0;
      for (const canvas of canvases) sum += canvas.width * canvas.height;
      return sum;
    };
    const scratchPixels = pixels(this.scratch), sparePixels = pixels(this.spare), retiredPixels = pixels(this.retired), leasedPixels = pixels(this.leased);
    return {
      entries: this.entries.size,
      pixels: this.pixels,
      bytes: this.pixels * 4,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      scratchCanvases: this.scratch.length,
      scratchPixels,
      scratchBytes: scratchPixels * 4,
      spareCanvases: this.spare.length,
      sparePixels,
      spareBytes: sparePixels * 4,
      retiredCanvases: this.retired.length,
      retiredPixels,
      retiredBytes: retiredPixels * 4,
      leasedCanvases: this.leased.size,
      leasedPixels,
      leasedBytes: leasedPixels * 4,
      ownedCanvasBytes: (this.pixels + scratchPixels + sparePixels + retiredPixels + leasedPixels) * 4
    };
  }
  clear() {
    this.epoch++;
    for (const canvas of [...this.entries.values()].map((value) => value.canvas).concat(this.scratch, this.spare, this.retired)) this.release(canvas);
    this.entries.clear();
    this.scratch.length = this.spare.length = this.retired.length = 0;
    this.pixels = 0;
    this.hits = this.misses = this.evictions = 0;
  }
};

// src/client/art/action-direction.ts
function finiteAim(pose) {
  if (pose.mode !== "attack" && pose.mode !== "cast" || pose.frame >= 5) return 0;
  return Number.isFinite(pose.aim) ? Math.max(-6, Math.min(6, Math.round(pose.aim))) : 0;
}
function animationKey(pose) {
  const carry = carryKey(pose);
  if ((pose.mode === "attack" || pose.mode === "cast") && pose.frame >= 5) return "idle:0:0:0" + carry;
  const variant = pose.mode === "attack" ? Math.abs(Math.trunc(pose.variant ?? 0)) % 3 : 0;
  return `${pose.mode}:${pose.frame}:${variant}:${finiteAim(pose)}${carry}`;
}
function carryStrength(pose) {
  return Number.isFinite(pose.carry) ? Math.max(0, Math.min(6, Math.round(pose.carry))) : 0;
}
function carryKey(pose) {
  const carry = carryStrength(pose);
  return carry ? `:carry:${carry}:${Number.isFinite(pose.carryAim) ? Math.max(-6, Math.min(6, Math.round(pose.carryAim))) : 0}` : "";
}
function actionPaintSize(pose, kind) {
  if (carryStrength(pose) || kind === "ancientStag" || kind === "redDragon" || kind === "spiderQueen" || (pose.mode === "attack" || pose.mode === "cast") && pose.frame < 5) return ART_ACTION_SIZE;
  return ART_TILE_SIZE;
}

// src/client/art/appearance.ts
var figures = {
  thornSlinger: { role: "bow", weapon: "sling" },
  barkMender: { role: "priest" },
  gladeWitch: { role: "witch" },
  worker: { role: "worker" },
  footman: { role: "sword", armor: true },
  lancer: { role: "pike", armor: true },
  ashWarden: { role: "pike", armor: true, elite: true, ember: true },
  archer: { role: "bow" },
  horseArcher: { role: "bow", mounted: true },
  raider: { role: "sword", mounted: true },
  knight: { role: "pike", armor: true, elite: true, mounted: true },
  priest: { role: "priest" },
  summoner: { role: "mage" },
  witch: { role: "witch" },
  emberRavager: { role: "axe", armor: true, ember: true },
  cinderRunner: { role: "sword", ember: true },
  sparkArcher: { role: "bow", ember: true },
  ashHexer: { role: "witch", ember: true },
  ashChieftain: { role: "axe", armor: true, elite: true, ember: true },
  cinderRevenant: { role: "sword", armor: true, elite: true, ember: true },
  mercenary: { role: "sword", armor: true },
  contractArcher: { role: "bow" },
  fieldMedic: { role: "priest" }
};
var creatures = {
  wildling: { shape: "hound", color: "#80735a" },
  mossGnawer: { shape: "hound", color: "#666d50" },
  ancientStag: { shape: "stag", color: "#8b7657" },
  spiderling: { shape: "spider", color: "#756e61", size: 0.7 },
  venomSpider: { shape: "spider", color: "#60624c" },
  spiderQueen: { shape: "spider", color: "#59505a", size: 1.17, crown: true },
  dragonWhelp: { shape: "dragon", color: "#a17b5e", size: 0.8 },
  redDragon: { shape: "dragon", color: "#8d5445", size: 1.17, crown: true },
  golem: { shape: "stone", color: "#747b71", crown: true },
  rubbleGolem: { shape: "stone", color: "#a0957f", size: 0.8 },
  rockGolem: { shape: "stone", color: "#7d8078" },
  graniteGolem: { shape: "stone", color: "#646b70", size: 1.17, crown: true },
  stonebackBrute: { shape: "wood", color: "#707360", size: 1.12 },
  ogreWarrior: { weapon: "club", shape: "ogre", color: "#998875", size: 0.88 },
  ogreMage: { weapon: "staff", shape: "ogre", color: "#819195", size: 0.88 },
  ogreLord: { weapon: "club", shape: "ogre", color: "#8d8074", size: 1.02, crown: true },
  murlocPeon: { weapon: "pike", shape: "fish", color: "#848c70", size: 0.86 },
  murlocHunter: { weapon: "javelin", shape: "fish", color: "#72817d" },
  tidePriest: { weapon: "staff", shape: "fish", color: "#697d8a", crown: true },
  deepSnapper: { shape: "turtle", color: "#697564" },
  spirit: { shape: "spirit", color: "#c5c9b9" }
};

// src/shared/time.ts
var SIM_TICKS_PER_SECOND = 20;
function seconds(value) {
  return Math.max(1, Math.round(value * SIM_TICKS_PER_SECOND));
}

// src/client/unit-animation.ts
var IDLE_FRAME = Object.freeze({ mode: "idle", frame: 0 });
var TICK_MS = 1e3 / SIM_TICKS_PER_SECOND;
var WALK_FRAMES = 8;
var ACTION_FRAMES = 6;
var idleFrames = Array.from({ length: WALK_FRAMES }, (_, frame) => Object.freeze({ mode: "idle", frame }));
var walkFrames = Array.from({ length: WALK_FRAMES }, (_, frame) => Object.freeze({ mode: "walk", frame }));
var actionFrames = {
  cast: Array.from({ length: ACTION_FRAMES }, (_, frame) => Object.freeze({ mode: "cast", frame })),
  work: Array.from({ length: ACTION_FRAMES }, (_, frame) => Object.freeze({ mode: "work", frame })),
  attack: Array.from({ length: 3 }, (_, variant) => Array.from({ length: ACTION_FRAMES }, (_2, frame) => Object.freeze({ mode: "attack", frame, variant })))
};

// src/shared/wind-field.ts
var DEFAULT_WIND = { direction: Math.PI / 4, speed: 80 };
var WIND_CHANGE_INTERVAL_TICKS = seconds(8 * 60);

// src/shared/ship-wind.ts
var SAIL_RULES = {
  trimRate: Math.PI / 3,
  setRate: 0.8,
  billowRate: 2,
  auxiliaryShare: 0.2,
  // RTS courses deliberately sail closer than historical square-riggers.
  // Each rig retains its own no-go sector without making an upwind order
  // spend almost all its travel crossing sideways across the map.
  lateen: { noGoAngle: Math.PI * 38 / 180, maxAngle: Math.PI * 65 / 180 },
  lug: { noGoAngle: Math.PI * 43 / 180, maxAngle: Math.PI * 65 / 180 },
  square: { noGoAngle: Math.PI * 48 / 180, maxAngle: Math.PI * 50 / 180 }
};
var clamp = (value, low, high) => Math.max(low, Math.min(high, value));
var POLAR_KNOTS = {
  lateen: [[SAIL_RULES.lateen.noGoAngle, 0], [SAIL_RULES.lateen.noGoAngle + Math.PI / 15, 0.84], [Math.PI / 2, 0.96], [Math.PI * 2 / 3, 1], [Math.PI, 0.66]],
  lug: [[SAIL_RULES.lug.noGoAngle, 0], [SAIL_RULES.lug.noGoAngle + Math.PI / 15, 0.84], [Math.PI / 2, 0.96], [Math.PI * 2 / 3, 1], [Math.PI, 0.78]],
  square: [[SAIL_RULES.square.noGoAngle, 0], [SAIL_RULES.square.noGoAngle + Math.PI / 15, 0.84], [Math.PI / 2, 0.96], [Math.PI * 2 / 3, 1], [Math.PI, 0.97]]
};
function polar(rig, angle2) {
  const noGo = SAIL_RULES[rig].noGoAngle;
  if (angle2 <= noGo) return 0;
  const knots = POLAR_KNOTS[rig];
  for (let i = 1; i < knots.length; i++) {
    const [end, high] = knots[i], [start, low] = knots[i - 1];
    if (angle2 <= end) {
      const t = clamp((angle2 - start) / (end - start), 0, 1);
      return low + (high - low) * t * t * (3 - 2 * t);
    }
  }
  return knots.at(-1)[1];
}
function bestBeatAngle(rig) {
  let best = SAIL_RULES[rig].noGoAngle, bestVmg = 0;
  for (let degree = 1; degree < 90; degree++) {
    const angle2 = degree * Math.PI / 180, vmg = polar(rig, angle2) * detCos(angle2);
    if (vmg > bestVmg) {
      bestVmg = vmg;
      best = angle2;
    }
  }
  return best;
}
var BEAT_ANGLES = { lateen: bestBeatAngle("lateen"), lug: bestBeatAngle("lug"), square: bestBeatAngle("square") };

// src/shared/terrain.ts
var CELL_GROUND = {
  ".": { land: true, sea: false, pace: 1, drag: 1 },
  ",": { land: true, sea: true, pace: 0.75, drag: 1.6 },
  m: { land: true, sea: false, pace: 0.6, drag: 2 },
  "=": { land: true, sea: false, pace: 1, drag: 1 },
  T: { land: false, sea: false, pace: 0, drag: 1 },
  "#": { land: false, sea: false, pace: 0, drag: 1 },
  "~": { land: false, sea: true, pace: 0, drag: 1 }
};
var PASSABLE = {
  land: new Set(Object.keys(CELL_GROUND).filter((char) => CELL_GROUND[char].land)),
  sea: new Set(Object.keys(CELL_GROUND).filter((char) => CELL_GROUND[char].sea))
};

// src/shared/navigation-masks.ts
var angle = Math.PI / 4;

// src/shared/ship-navigation.ts
var DIRECTIONS = 8;
var ANGLE = Math.PI / 4;
function createSearchWorkspace(size) {
  return {
    costs: new Float64Array(size),
    parents: new Int32Array(size),
    stamps: new Uint32Array(size),
    trafficFits: new Int32Array(size),
    basePotentials: new Float64Array(size / DIRECTIONS),
    baseStamps: new Uint32Array(size / DIRECTIONS),
    generation: 0
  };
}
var search = createSearchWorkspace(0);
var Frontier = class {
  length = 0;
  poppedCost = 0;
  ids = new Int32Array(1024);
  costs = new Float64Array(1024);
  scores = new Float64Array(1024);
  reset() {
    this.length = 0;
    if (this.ids.length > 65536) {
      this.ids = new Int32Array(65536);
      this.costs = new Float64Array(65536);
      this.scores = new Float64Array(65536);
    }
    return this;
  }
  save() {
    return Array.from({ length: this.length }, (_, i) => ({ id: this.ids[i], cost: this.costs[i], score: this.scores[i] }));
  }
  restore(slots) {
    this.reset();
    const capacity = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(1, slots.length))));
    if (this.ids.length < capacity) {
      this.ids = new Int32Array(capacity);
      this.costs = new Float64Array(capacity);
      this.scores = new Float64Array(capacity);
    }
    this.length = slots.length;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      this.ids[i] = slot.id;
      this.costs[i] = slot.cost;
      this.scores[i] = slot.score;
    }
    return this;
  }
  push(id, cost, score) {
    if (this.length === this.ids.length) {
      const ids = new Int32Array(this.length * 2), costs = new Float64Array(this.length * 2), scores = new Float64Array(this.length * 2);
      ids.set(this.ids);
      costs.set(this.costs);
      scores.set(this.scores);
      this.ids = ids;
      this.costs = costs;
      this.scores = scores;
    }
    let i = this.length++;
    while (i) {
      const parent = i - 1 >>> 2;
      if (!this.less(score, id, this.scores[parent], this.ids[parent]))
        break;
      this.copy(parent, i);
      i = parent;
    }
    this.ids[i] = id;
    this.costs[i] = cost;
    this.scores[i] = score;
  }
  copy(from, to) {
    this.ids[to] = this.ids[from];
    this.costs[to] = this.costs[from];
    this.scores[to] = this.scores[from];
  }
  less(aScore, aId, bScore, bId) {
    return aScore < bScore || aScore === bScore && aId < bId;
  }
  pop() {
    const result = this.ids[0], last = --this.length;
    this.poppedCost = this.costs[0];
    const id = this.ids[last], cost = this.costs[last], score = this.scores[last];
    if (last) {
      let i = 0;
      while (i * 4 + 1 < last) {
        let child = i * 4 + 1;
        const end = Math.min(last, child + 4);
        for (let next = child + 1; next < end; next++)
          if (this.less(this.scores[next], this.ids[next], this.scores[child], this.ids[child]))
            child = next;
        if (!this.less(this.scores[child], this.ids[child], score, id))
          break;
        this.copy(child, i);
        i = child;
      }
      this.ids[i] = id;
      this.costs[i] = cost;
      this.scores[i] = score;
    }
    return result;
  }
};
var routeFrontier = new Frontier();
var distanceFrontier = new Frontier();

// src/shared/veteran-skills.ts
var VETERAN_ACTIVE_SKILL_IDS = ["veteranRally", "veteranHealingWave", "veteranInnerFire"];
var VETERAN_SKILLS = {
  veteranResilience: {
    id: "veteranResilience",
    name: { zh: "\u767E\u6218\u4E4B\u8EAF", en: "Battle Hardened" },
    icon: "\u25C6",
    pool: "common",
    description: { zh: "\u88AB\u52A8\uFF1A\u81EA\u8EAB\u53D7\u5230\u7684\u4F24\u5BB3\u964D\u4F4E 25%\u3002", en: "Passive: take 25% less damage." },
    effect: { type: "passive", modifiers: { damageReduction: 0.25 } }
  },
  veteranMobility: {
    id: "veteranMobility",
    name: { zh: "\u8FC5\u6377\u884C\u52A8", en: "Swift Movement" },
    icon: "\u27A4",
    pool: "common",
    description: { zh: "\u88AB\u52A8\uFF1A\u81EA\u8EAB\u79FB\u52A8\u901F\u5EA6\u63D0\u9AD8 30%\u3002", en: "Passive: gain 30% movement speed." },
    effect: { type: "passive", modifiers: { moveSpeedMultiplier: 1.3 } }
  },
  veteranCommand: {
    id: "veteranCommand",
    name: { zh: "\u534F\u540C\u4F5C\u6218", en: "Coordinated Assault" },
    icon: "\u2691",
    pool: "common",
    description: { zh: "\u5149\u73AF\uFF1A160 \u8303\u56F4\u5185\u53CB\u519B\uFF08\u542B\u81EA\u8EAB\uFF09\u653B\u51FB\u901F\u5EA6\u63D0\u9AD8 35%\uFF1B\u540C\u7C7B\u5149\u73AF\u4E0D\u53E0\u52A0\u3002", en: "Aura: allies within 160, including self, gain 35% attack speed. Identical auras do not stack." },
    effect: { type: "aura", radius: 160, modifiers: { attackSpeedMultiplier: 1.35 } }
  },
  veteranVigilance: {
    id: "veteranVigilance",
    name: { zh: "\u8B66\u6212\u4E92\u52A9", en: "Watchful Company" },
    icon: "\u25C7",
    pool: "common",
    description: { zh: "\u5149\u73AF\uFF1A160 \u8303\u56F4\u5185\u53CB\u519B\uFF08\u542B\u81EA\u8EAB\uFF09\u53D7\u5230\u7684\u4F24\u5BB3\u964D\u4F4E 18%\uFF1B\u9632\u62A4\u5149\u73AF\u53EA\u53D6\u6700\u5F3A\u3002", en: "Aura: allies within 160, including self, take 18% less damage. Only the strongest protection aura applies." },
    effect: { type: "aura", radius: 160, modifiers: { damageReduction: 0.18 } }
  },
  veteranRally: {
    id: "veteranRally",
    name: { zh: "\u6218\u6597\u53F7\u4EE4", en: "Rallying Cry" },
    icon: "\u2691",
    pool: "common",
    description: { zh: "\u4E3B\u52A8\uFF0F\u81EA\u52A8\u65BD\u653E\uFF1A160 \u8303\u56F4\u5185\u81F3\u591A 5 \u540D\u53CB\u519B\u653B\u51FB\u901F\u5EA6\u63D0\u9AD8 60%\uFF0C\u6301\u7EED 8 \u79D2\uFF1B\u51B7\u5374 24 \u79D2\u3002", en: "Active / autocast: up to 5 allies within 160 gain 60% attack speed for 8 seconds. Cooldown: 24 seconds." },
    effect: { type: "active", action: "buff", radius: 160, maxTargets: 5, cooldown: seconds(24), duration: seconds(8), modifiers: { attackSpeedMultiplier: 1.6 } }
  },
  veteranPhalanx: {
    id: "veteranPhalanx",
    name: { zh: "\u575A\u5B88\u9635\u7EBF", en: "Hold the Line" },
    icon: "\u25A3",
    pool: "specialist",
    description: { zh: "\u5149\u73AF\uFF1A130 \u8303\u56F4\u5185\u53CB\u519B\uFF08\u542B\u81EA\u8EAB\uFF09\u53D7\u5230\u7684\u4F24\u5BB3\u964D\u4F4E 25%\uFF1B\u9632\u62A4\u5149\u73AF\u53EA\u53D6\u6700\u5F3A\u3002", en: "Aura: allies within 130, including self, take 25% less damage. Only the strongest protection aura applies." },
    effect: { type: "aura", radius: 130, modifiers: { damageReduction: 0.25 } }
  },
  veteranSteadyAim: {
    id: "veteranSteadyAim",
    name: { zh: "\u6C89\u7740\u7784\u51C6", en: "Steady Aim" },
    icon: "\u25CE",
    pool: "specialist",
    description: { zh: "\u88AB\u52A8\uFF1A\u81EA\u8EAB\u7784\u51C6\u901F\u5EA6\u63D0\u9AD8 80%\uFF0C\u653B\u51FB\u901F\u5EA6\u63D0\u9AD8 20%\uFF1B\u79FB\u52A8\u4ECD\u9075\u5B88\u539F\u6709\u7784\u51C6\u9650\u5236\u3002", en: "Passive: gain 80% aiming speed and 20% attack speed. Movement retains its normal effect on aim." },
    effect: { type: "passive", modifiers: { aimSpeedMultiplier: 1.8, attackSpeedMultiplier: 1.2 } }
  },
  veteranMarch: {
    id: "veteranMarch",
    name: { zh: "\u884C\u519B\u9886\u961F", en: "March Leader" },
    icon: "\xBB",
    pool: "specialist",
    description: { zh: "\u5149\u73AF\uFF1A160 \u8303\u56F4\u5185\u53CB\u519B\uFF08\u542B\u81EA\u8EAB\uFF09\u79FB\u52A8\u901F\u5EA6\u63D0\u9AD8 25%\uFF1B\u540C\u7C7B\u5149\u73AF\u4E0D\u53E0\u52A0\u3002", en: "Aura: allies within 160, including self, gain 25% movement speed. Identical auras do not stack." },
    effect: { type: "aura", radius: 160, modifiers: { moveSpeedMultiplier: 1.25 } }
  },
  veteranHealingWave: {
    id: "veteranHealingWave",
    name: { zh: "\u7FA4\u4F53\u6062\u590D", en: "Restoring Wave" },
    icon: "\u271A",
    pool: "specialist",
    description: { zh: "\u4E3B\u52A8\uFF0F\u81EA\u52A8\u65BD\u653E\uFF1A\u6062\u590D 180 \u8303\u56F4\u5185\u81F3\u591A 5 \u540D\u53CB\u519B\u5404 90 \u70B9\u751F\u547D\uFF0C\u4F18\u5148\u4F24\u8005\uFF1B\u51B7\u5374 18 \u79D2\u3002\u4E0D\u4F5C\u7528\u4E8E\u673A\u68B0\u5355\u4F4D\u3002", en: "Active / autocast: heal up to 5 allies within 180 for 90 health each, prioritizing wounded units. Cooldown: 18 seconds. Does not affect mechanical units." },
    effect: { type: "active", action: "heal", targets: { unitClasses: ["nonMechanical"] }, radius: 180, maxTargets: 5, cooldown: seconds(18), healAmount: 90 }
  },
  veteranInnerFire: {
    id: "veteranInnerFire",
    name: { zh: "\u5FC3\u7075\u4E4B\u706B", en: "Inner Fire" },
    icon: "\u2726",
    pool: "specialist",
    description: { zh: "\u4E3B\u52A8\uFF0F\u81EA\u52A8\u65BD\u653E\uFF1A180 \u8303\u56F4\u5185\u81F3\u591A 5 \u540D\u53CB\u519B\u53D7\u5230\u7684\u4F24\u5BB3\u964D\u4F4E 35%\uFF0C\u6301\u7EED 8 \u79D2\uFF1B\u51B7\u5374 24 \u79D2\u3002\u77ED\u65F6\u9632\u62A4\u53EA\u53D6\u6700\u5F3A\u3002", en: "Active / autocast: up to 5 allies within 180 take 35% less damage for 8 seconds. Cooldown: 24 seconds. Only the strongest temporary ward applies." },
    effect: { type: "active", action: "buff", radius: 180, maxTargets: 5, cooldown: seconds(24), duration: seconds(8), modifiers: { damageReduction: 0.35 } }
  },
  veteranRenewal: {
    id: "veteranRenewal",
    name: { zh: "\u4F11\u517B\u5E87\u62A4", en: "Renewing Presence" },
    icon: "\u274B",
    pool: "specialist",
    description: { zh: "\u5149\u73AF\uFF1A150 \u8303\u56F4\u5185\u53CB\u519B\uFF08\u542B\u81EA\u8EAB\uFF09\u6BCF\u79D2\u6062\u590D 3 \u70B9\u751F\u547D\uFF1B\u540C\u7C7B\u5149\u73AF\u4E0D\u53E0\u52A0\uFF0C\u4E0D\u4F5C\u7528\u4E8E\u673A\u68B0\u5355\u4F4D\u3002", en: "Aura: allies within 150, including self, restore 3 health per second. Identical auras do not stack. Does not affect mechanical units." },
    effect: { type: "aura", targets: { unitClasses: ["nonMechanical"] }, radius: 150, modifiers: { regenPerSecond: 3 } }
  },
  veteranSiegeDrill: {
    id: "veteranSiegeDrill",
    name: { zh: "\u6D4B\u8DDD\u8BAD\u7EC3", en: "Rangefinding" },
    icon: "\u2316",
    pool: "specialist",
    description: { zh: "\u88AB\u52A8\uFF1A\u81EA\u8EAB\u653B\u51FB\u5C04\u7A0B\u63D0\u9AD8 10%\uFF1B\u6700\u5C0F\u5C04\u7A0B\u4FDD\u6301\u4E0D\u53D8\u3002", en: "Passive: gain 10% attack range. Minimum range is unchanged." },
    effect: { type: "passive", modifiers: { attackRangeMultiplier: 1.1 } }
  },
  veteranEndurance: {
    id: "veteranEndurance",
    name: { zh: "\u575A\u97E7\u6062\u590D", en: "Enduring Recovery" },
    icon: "\u2665",
    pool: "specialist",
    description: { zh: "\u88AB\u52A8\uFF1A\u975E\u673A\u68B0\u5355\u4F4D\u81EA\u8EAB\u6BCF\u79D2\u6062\u590D 6 \u70B9\u751F\u547D\u3002", en: "Passive: non-mechanical units restore 6 health per second." },
    effect: { type: "passive", targets: { unitClasses: ["nonMechanical"] }, modifiers: { regenPerSecond: 6 } }
  }
};

// src/shared/ship-equipment.ts
var SHIP_HULL_COST = { cutter: 160, transport: 240, warship: 320, bombardShip: 470, fireShip: 340, carrier: 420, shipOfTheLine: 1080 };
var SHIP_WEAPONS = {
  shipCannon: { cost: 220, mass: 160, hp: 90, damage: 20, range: 312, cooldown: seconds(2), aimSpeed: 440, weapon: { presentation: "cannon", delivery: "bolt", radius: 8, blastRadius: 48, maxHits: 1, navalMultiplier: 2, hullDamageShare: 1.25 }, art: "warship" },
  shipMortar: { cost: 330, mass: 240, hp: 100, damage: 36, range: 576, cooldown: seconds(3.6), aimSpeed: 400, weapon: { presentation: "mortar", delivery: "shell", radius: 75, minRange: 180, buildingMultiplier: 2, navalMultiplier: 1.7, hullDamageShare: 1.5 }, art: "bombardShip" },
  flameProjector: { cost: 180, mass: 120, hp: 80, damage: 10, range: 144, cooldown: seconds(1.2), aimSpeed: 480, weapon: { presentation: "flame", delivery: "cone", coneAngle: 0.85, buildingMultiplier: 0.7 }, art: "fireShip" }
};

// src/shared/unit-value.ts
var VETERANCY_GAIN_PER_STAR = 1 / 3;
function unitValue(def) {
  return def.cost > 0 ? def.cost : (def.creepFoodPower ?? 2) * 36 * (def.threat ?? 1);
}
function creepGoldBounty(foodPower, threat = 1) {
  return Math.max(20, Math.round((20 * foodPower + 1.25 * foodPower ** 2) * threat / 5) * 5);
}

// src/shared/damage-types.ts
var DAMAGE_PROFILES = {
  MELEE_CUT: { school: "physical", delivery: "melee", physicalType: "cut", origin: "unit" },
  MELEE_PIERCE: { school: "physical", delivery: "melee", physicalType: "pierce", origin: "unit" },
  MELEE_BLUNT: { school: "physical", delivery: "melee", physicalType: "blunt", origin: "unit" },
  RANGED_PIERCE: { school: "physical", delivery: "ranged", physicalType: "pierce", origin: "unit" },
  RANGED_BLUNT: { school: "physical", delivery: "ranged", physicalType: "blunt", origin: "unit" },
  FIRE_ARROW: { school: "physical", delivery: "ranged", physicalType: "pierce", element: "fire", origin: "unit" },
  MAGIC_MELEE: { school: "magic", delivery: "melee", element: "arcane", origin: "unit" },
  MAGIC_RANGED: { school: "magic", delivery: "ranged", element: "arcane", origin: "unit" },
  FIRE_RANGED: { school: "magic", delivery: "ranged", element: "fire", origin: "unit" },
  TOWER_ARROW: { school: "physical", delivery: "ranged", physicalType: "pierce", origin: "tower" },
  ARCANE: { school: "magic", delivery: "effect", element: "arcane", origin: "spell" },
  BURNING: { school: "magic", delivery: "effect", element: "fire", origin: "spell" },
  POISON: { school: "magic", delivery: "effect", element: "poison", origin: "spell" },
  LIGHTNING: { school: "magic", delivery: "ranged", element: "lightning", origin: "spell" },
  STORM: { school: "magic", delivery: "effect", element: "lightning", origin: "spell" },
  EXPLOSION: { school: "physical", delivery: "effect", physicalType: "blunt", origin: "spell" }
};
var P = DAMAGE_PROFILES;
var UNIT_DAMAGE_PROFILES = {
  worker: P.MELEE_CUT,
  footman: P.MELEE_CUT,
  archer: P.RANGED_PIERCE,
  horseArcher: P.RANGED_PIERCE,
  raider: P.MELEE_CUT,
  lancer: P.MELEE_PIERCE,
  ashWarden: P.MELEE_PIERCE,
  emberRavager: P.MELEE_CUT,
  cinderRunner: P.MELEE_CUT,
  sparkArcher: P.FIRE_ARROW,
  ashHexer: P.MAGIC_RANGED,
  knight: P.MELEE_CUT,
  priest: P.MAGIC_RANGED,
  summoner: P.MAGIC_RANGED,
  witch: P.MAGIC_RANGED,
  golem: P.MELEE_BLUNT,
  ashChieftain: P.MELEE_CUT,
  cinderRevenant: P.MELEE_CUT,
  spirit: P.MAGIC_MELEE,
  mercenary: P.MELEE_CUT,
  contractArcher: P.RANGED_PIERCE,
  fieldMedic: P.MAGIC_RANGED,
  wildling: P.MELEE_BLUNT,
  mossGnawer: P.MELEE_PIERCE,
  thornSlinger: P.RANGED_PIERCE,
  barkMender: P.MAGIC_RANGED,
  stonebackBrute: P.MELEE_BLUNT,
  gladeWitch: P.MAGIC_RANGED,
  // Bare transport/carrier hulls cannot attack; a mounted gun supplies its own profile.
  transport: P.MELEE_BLUNT,
  warship: P.RANGED_BLUNT,
  shipOfTheLine: P.RANGED_BLUNT,
  cutter: P.RANGED_PIERCE,
  bombardShip: P.RANGED_BLUNT,
  fireShip: P.FIRE_RANGED,
  carrier: P.MELEE_BLUNT,
  siegeRam: P.MELEE_BLUNT,
  ballista: P.RANGED_PIERCE,
  catapult: P.RANGED_BLUNT,
  organGun: P.RANGED_PIERCE,
  ancientStag: P.MELEE_PIERCE,
  murlocPeon: P.MELEE_PIERCE,
  murlocHunter: P.RANGED_PIERCE,
  tidePriest: P.MAGIC_RANGED,
  deepSnapper: P.MELEE_PIERCE,
  rubbleGolem: P.MELEE_BLUNT,
  rockGolem: P.MELEE_BLUNT,
  graniteGolem: P.MELEE_BLUNT,
  ogreWarrior: P.MELEE_BLUNT,
  ogreMage: P.MAGIC_RANGED,
  ogreLord: P.MELEE_BLUNT,
  spiderling: P.MELEE_PIERCE,
  venomSpider: P.MELEE_PIERCE,
  spiderQueen: P.MELEE_PIERCE,
  dragonWhelp: P.FIRE_RANGED,
  redDragon: P.FIRE_RANGED
};
var WEAPON_DAMAGE_PROFILES = {
  melee: P.MELEE_BLUNT,
  arrow: P.RANGED_PIERCE,
  spear: P.RANGED_PIERCE,
  stone: P.RANGED_BLUNT,
  magic: P.MAGIC_RANGED,
  fire: P.FIRE_RANGED,
  bolt: P.RANGED_PIERCE,
  cannon: P.RANGED_BLUNT,
  mortar: P.RANGED_BLUNT,
  flame: P.FIRE_RANGED,
  grapeshot: P.RANGED_PIERCE
};
var ITEM_DAMAGE_PROFILES = {
  greatSword: P.MELEE_CUT,
  shipCannon: P.RANGED_BLUNT,
  shipMortar: P.RANGED_BLUNT,
  flameProjector: P.FIRE_RANGED,
  flameCloak: P.BURNING,
  lightningRod: P.LIGHTNING,
  stormStaff: P.STORM,
  breachCharge: P.EXPLOSION
};
var ABILITY_DAMAGE_PROFILES = {
  curse: P.ARCANE,
  ashCurse: P.ARCANE,
  pinningBolt: P.RANGED_PIERCE,
  incendiaryFlume: P.FIRE_RANGED
};

// src/shared/damage-reduction.ts
var HEAVY_ARMOR_DAMAGE = { rangedUnit: 0.5, tower: 0.7 };
var DAMAGE_REDUCTION_RULES = {
  armor: { stacking: "highest", cap: 1 },
  equipment: { stacking: "add", cap: 0.3 },
  passive: { stacking: "highest", cap: 1 },
  aura: { stacking: "highest", cap: 1 },
  ward: { stacking: "highest", cap: 1 }
};
var GROUPS = Object.keys(DAMAGE_REDUCTION_RULES);

// src/shared/transport-role.ts
var TRANSPORT_COMBAT = {
  rangedDamageTaken: HEAVY_ARMOR_DAMAGE.tower,
  passengerDamageMultiplier: 0.5
};

// src/shared/catalog.ts
var SLOW_TICKS = seconds(3);
var POISON_TICKS = seconds(4);
var UNIT_RULES = {
  worker: { hp: 70, speed: 60, radius: 15, attackDamage: 10, attackRange: 36, attackCooldown: seconds(1.7), cost: 75, trainTime: seconds(7), supplyUsed: 1, abilities: [] },
  footman: { hp: 145, speed: 62, radius: 18, attackDamage: 16, attackRange: 48, attackCooldown: seconds(1.1), cost: 100, trainTime: seconds(8), supplyUsed: 2, abilities: [] },
  archer: { hp: 83, speed: 60, radius: 16, attackDamage: 13, attackRange: 319.2, aimSpeed: 480, attackCooldown: seconds(1.5), cost: 115, trainTime: seconds(7.75), supplyUsed: 2, abilities: [] },
  // The cavalry strikes from the saddle with a reach a little under the lancer's 74 (it had a footman's, 48 and 52).
  horseArcher: { hp: 109, speed: 90, radius: 19, attackDamage: 10, attackRange: 264, aimSpeed: 600, attackCooldown: seconds(1.5), cost: 150, trainTime: seconds(10), supplyUsed: 2, abilities: [], tier: 2, aimMoveTolerance: 72 },
  raider: { hp: 115, speed: 82, radius: 18, attackDamage: 14, attackRange: 72, attackCooldown: seconds(1), cost: 115, trainTime: seconds(8.5), supplyUsed: 2, abilities: ["charge"], tier: 2 },
  lancer: { hp: 130, speed: 68, radius: 18, attackDamage: 18, attackRange: 74, attackCooldown: seconds(1.4), cost: 110, trainTime: seconds(8.75), supplyUsed: 2, abilities: [] },
  ashWarden: { hp: 165, speed: 60, radius: 19, attackDamage: 15, attackRange: 52, attackCooldown: seconds(1.15), cost: 120, trainTime: seconds(9), supplyUsed: 2, abilities: [] },
  emberRavager: { hp: 118, speed: 76, radius: 18, attackDamage: 20, attackRange: 52, attackCooldown: seconds(1.25), cost: 120, trainTime: seconds(9), supplyUsed: 2, abilities: [] },
  cinderRunner: { hp: 96, speed: 87, radius: 17, attackDamage: 14, attackRange: 48, attackCooldown: seconds(0.95), cost: 110, trainTime: seconds(8), supplyUsed: 2, abilities: [] },
  sparkArcher: { hp: 85, speed: 63, radius: 16, attackDamage: 9, attackRange: 288, aimSpeed: 540, attackCooldown: seconds(1.35), cost: 110, trainTime: seconds(7.25), supplyUsed: 2, abilities: [] },
  ashHexer: { hp: 82, speed: 64, radius: 16, attackDamage: 7, attackRange: 240, aimSpeed: 520, attackCooldown: seconds(1.7), cost: 140, trainTime: seconds(9), supplyUsed: 2, abilities: ["ashCurse"], tier: 2 },
  knight: { hp: 220, speed: 72, radius: 22, attackDamage: 24, attackRange: 72, attackCooldown: seconds(1.3), cost: 190, trainTime: seconds(11.5), supplyUsed: 3, abilities: ["charge"], armor: "heavy", tier: 3 },
  priest: { hp: 90, speed: 60, radius: 16, attackDamage: 7, attackRange: 201.6, aimSpeed: 440, attackCooldown: seconds(1.8), cost: 135, trainTime: seconds(9.25), supplyUsed: 2, abilities: ["heal"], tier: 2 },
  summoner: { hp: 95, speed: 56, radius: 17, attackDamage: 8, attackRange: 218.4, aimSpeed: 400, attackCooldown: seconds(1.9), cost: 180, trainTime: seconds(10.5), supplyUsed: 2, abilities: ["summon"], tier: 2 },
  witch: { hp: 92, speed: 62, radius: 16, attackDamage: 8, attackRange: 252, aimSpeed: 480, attackCooldown: seconds(1.7), cost: 145, trainTime: seconds(9.75), supplyUsed: 2, abilities: ["curse"], tier: 2 },
  golem: { unitClass: "mechanical", hp: 340, speed: 42, radius: 28, attackDamage: 34, attackRange: 58, attackCooldown: seconds(2.1), cost: 230, trainTime: seconds(14), supplyUsed: 4, abilities: [], armor: "heavy", tier: 3 },
  // Ember's heavies, raised in the ashen hall and heavy-armored like the grove's knight and golem, but built for
  // other jobs. The chieftain hunts casters and what they summon (half again as much damage to both); the revenant is
  // light for an elite and burns its wounds away, back to full health in about twenty seconds.
  ashChieftain: { hp: 210, speed: 66, radius: 20, attackDamage: 22, attackRange: 52, attackCooldown: seconds(1.2), cost: 190, trainTime: seconds(11), supplyUsed: 3, abilities: [], armor: "heavy", casterSlayer: 1.5, tier: 3 },
  cinderRevenant: { hp: 150, speed: 70, radius: 19, attackDamage: 21, attackRange: 52, attackCooldown: seconds(1.15), cost: 210, trainTime: seconds(12), supplyUsed: 3, abilities: [], armor: "heavy", regenPerSecond: 7, tier: 3 },
  spirit: { hp: 85, speed: 70, radius: 15, attackDamage: 13, attackRange: 55, attackCooldown: seconds(1.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, abilities: [] },
  mercenary: { hp: 155, speed: 74, radius: 18, attackDamage: 28, attackRange: 62, attackCooldown: seconds(0.9), cost: 160, trainTime: seconds(0.05), supplyUsed: 2, abilities: [] },
  contractArcher: { hp: 93, speed: 64, radius: 16, attackDamage: 19, attackRange: 352.8, aimSpeed: 600, attackCooldown: seconds(1.35), cost: 145, trainTime: seconds(0.05), supplyUsed: 2, abilities: [] },
  fieldMedic: { hp: 105, speed: 62, radius: 16, attackDamage: 8, attackRange: 210.4, aimSpeed: 480, attackCooldown: seconds(1.7), cost: 155, trainTime: seconds(0.05), supplyUsed: 2, abilities: ["heal"] },
  wildling: { hp: 76, speed: 76, radius: 15, attackDamage: 10, attackRange: 42, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  mossGnawer: { hp: 54, speed: 84, radius: 13, attackDamage: 8, attackRange: 34, attackCooldown: seconds(1.3), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  thornSlinger: { hp: 83, speed: 68, radius: 18, attackDamage: 13, attackRange: 132, aimSpeed: 400, attackCooldown: seconds(1.7), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: [] },
  barkMender: { hp: 68, speed: 64, radius: 18, attackDamage: 7, attackRange: 88, aimSpeed: 400, attackCooldown: seconds(2.1), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: ["heal"] },
  stonebackBrute: { hp: 210, speed: 72, radius: 24, attackDamage: 28, attackRange: 48, attackCooldown: seconds(1.9), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: [] },
  gladeWitch: { hp: 110, speed: 66, radius: 22, attackDamage: 13, attackRange: 120, aimSpeed: 440, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: ["curse"] },
  // @@@ships - Both races can board every ship. Troop ferry passengers deal half damage;
  // warships have sturdier hulls and a cannon. Deck space and mass determine crew capacity.
  transport: { unitClass: "mechanical", hp: 270, speed: 64, radius: 30, attackDamage: 0, attackRange: 0, attackCooldown: seconds(1), cost: SHIP_HULL_COST.transport, trainTime: seconds(12), supplyUsed: 1, abilities: [], naval: true, ...TRANSPORT_COMBAT },
  warship: { unitClass: "mechanical", hp: 320, speed: 60, radius: 28, attackDamage: 20, attackRange: 312, aimSpeed: 440, attackCooldown: seconds(2), cost: SHIP_HULL_COST.warship + SHIP_WEAPONS.shipCannon.cost, trainTime: seconds(14), supplyUsed: 3, abilities: [], naval: true, weapon: SHIP_WEAPONS.shipCannon.weapon },
  // Four removable cannons are included in the purchase; the hull has no extra intrinsic shot.
  shipOfTheLine: { unitClass: "mechanical", hp: 740, speed: 46, radius: 48, attackDamage: 20, attackRange: 312, aimSpeed: 440, attackCooldown: seconds(2), cost: SHIP_HULL_COST.shipOfTheLine + SHIP_WEAPONS.shipCannon.cost * 4, trainTime: seconds(30), supplyUsed: 7, abilities: [], naval: true, armor: "heavy", tier: 3, weapon: SHIP_WEAPONS.shipCannon.weapon },
  cutter: { unitClass: "mechanical", hp: 110, speed: 84, radius: 24, attackDamage: 10, attackRange: 264, aimSpeed: 540, attackCooldown: seconds(1.3), cost: SHIP_HULL_COST.cutter, trainTime: seconds(9), supplyUsed: 2, abilities: [], naval: true, intrinsicAttack: true },
  bombardShip: { unitClass: "mechanical", hp: 260, speed: 44, radius: 32, attackDamage: 36, attackRange: 576, aimSpeed: 400, attackCooldown: seconds(3.6), cost: SHIP_HULL_COST.bombardShip + SHIP_WEAPONS.shipMortar.cost, trainTime: seconds(19), supplyUsed: 4, abilities: [], naval: true, tier: 2, weapon: { presentation: "mortar", delivery: "shell", radius: 75, minRange: 180, buildingMultiplier: 2 } },
  fireShip: { unitClass: "mechanical", hp: 340, speed: 70, radius: 28, attackDamage: 10, attackRange: 144, aimSpeed: 480, attackCooldown: seconds(1.2), cost: SHIP_HULL_COST.fireShip + SHIP_WEAPONS.flameProjector.cost, trainTime: seconds(15), supplyUsed: 3, abilities: ["incendiaryFlume"], naval: true, weapon: { presentation: "flame", delivery: "cone", coneAngle: 0.85, buildingMultiplier: 0.7 } },
  carrier: { unitClass: "mechanical", hp: 480, speed: 54, radius: 38, attackDamage: 0, attackRange: 0, attackCooldown: seconds(1), cost: SHIP_HULL_COST.carrier, trainTime: seconds(18), supplyUsed: 3, abilities: [], naval: true, ...TRANSPORT_COMBAT, tier: 2 },
  siegeRam: { unitClass: "mechanical", hp: 420, speed: 50, radius: 26, attackDamage: 22, attackRange: 64, attackCooldown: seconds(1.8), cost: 240, trainTime: seconds(16), supplyUsed: 3, abilities: [], armor: "heavy", tier: 2, weapon: { presentation: "melee", delivery: "ram", buildingMultiplier: 3.3 } },
  ballista: { unitClass: "mechanical", hp: 150, speed: 46, radius: 24, attackDamage: 27, attackRange: 472, aimSpeed: 420, attackCooldown: seconds(2.4), cost: 300, trainTime: seconds(15), supplyUsed: 3, abilities: ["pinningBolt"], tier: 2, weapon: { presentation: "bolt", delivery: "bolt", radius: 18, maxHits: 3, pierceShare: 0.7, buildingMultiplier: 0.75, navalMultiplier: 1.4 } },
  catapult: { unitClass: "mechanical", hp: 180, speed: 38, radius: 27, attackDamage: 38, attackRange: 608, aimSpeed: 360, attackCooldown: seconds(3.8), cost: 390, trainTime: seconds(19), supplyUsed: 4, abilities: [], tier: 2, weapon: { presentation: "stone", delivery: "shell", radius: 90, minRange: 180, buildingMultiplier: 2 } },
  organGun: { unitClass: "mechanical", hp: 190, speed: 46, radius: 25, attackDamage: 12, attackRange: 304, aimSpeed: 480, attackCooldown: seconds(2.5), cost: 350, trainTime: seconds(17), supplyUsed: 3, abilities: [], tier: 2, weapon: { presentation: "grapeshot", delivery: "cone", coneAngle: 0.42, burst: 3, buildingMultiplier: 0.45 } },
  ancientStag: { hp: 360, speed: 88, radius: 32, attackDamage: 38, attackRange: 68, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 5, abilities: [] },
  // @@@creep-families - The camp families (see shared/camps.ts), a creep's level its food power, bounty and experience by
  // level (20/35/50/68/85/100/130 gold at levels 1-8). A tier's camps are as hard as the old wildling camps of that tier:
  // health and damage were set so that a squad of two footmen to an archer sized to the tier (3, 5, 7) loses as much,
  // for the camp's level, clearing the new templates as the old ones, within a tenth on average (green 0.96, orange
  // 1.09, red 1.06); a power changes how a camp fights, not how hard it is. Each has one trait or ability at most (see
  // @@@creep-traits), and none reaches past a tower's 480, so no creep wakes from farther than today. None is wider
  // than 28: a blow's reach is measured from center to center, and a footman (radius 18, reach 48) could not strike a
  // wider one through their bodies.
  murlocPeon: { hp: 80, speed: 72, radius: 14, attackDamage: 11, attackRange: 40, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  murlocHunter: { hp: 98, speed: 72, radius: 15, attackDamage: 13, attackRange: 120, aimSpeed: 480, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: [], slowOnHit: true, threat: 1.05 },
  tidePriest: { hp: 100, speed: 64, radius: 17, attackDamage: 10, attackRange: 160, aimSpeed: 440, attackCooldown: seconds(1.9), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: ["heal"] },
  deepSnapper: { hp: 350, speed: 70, radius: 26, attackDamage: 31, attackRange: 52, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 5, abilities: [], armor: "heavy", threat: 1.25 },
  rubbleGolem: { unitClass: "mechanical", hp: 190, speed: 50, radius: 22, attackDamage: 22, attackRange: 48, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: [], armor: "heavy" },
  rockGolem: { unitClass: "mechanical", hp: 235, speed: 50, radius: 25, attackDamage: 25, attackRange: 52, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 4, abilities: [], armor: "heavy", threat: 1.3 },
  graniteGolem: { unitClass: "mechanical", hp: 390, speed: 48, radius: 28, attackDamage: 35, attackRange: 58, attackCooldown: seconds(2.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 6, abilities: ["stomp"], armor: "heavy", threat: 1.3 },
  ogreWarrior: { hp: 178, speed: 68, radius: 22, attackDamage: 22, attackRange: 52, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: [] },
  ogreMage: { hp: 145, speed: 64, radius: 22, attackDamage: 15, attackRange: 160, aimSpeed: 400, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 4, abilities: ["bloodlust"], threat: 1.15 },
  ogreLord: { hp: 380, speed: 68, radius: 28, attackDamage: 34, attackRange: 56, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 6, abilities: [], threat: 1.35 },
  spiderling: { hp: 65, speed: 88, radius: 12, attackDamage: 10, attackRange: 36, attackCooldown: seconds(1.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  venomSpider: { hp: 105, speed: 84, radius: 15, attackDamage: 13, attackRange: 44, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: [], poisonOnHit: true, threat: 1.7 },
  spiderQueen: { hp: 350, speed: 80, radius: 26, attackDamage: 33, attackRange: 52, attackCooldown: seconds(1.7), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 5, abilities: ["web"] },
  dragonWhelp: { hp: 170, speed: 84, radius: 22, attackDamage: 17, attackRange: 144, aimSpeed: 540, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 4, abilities: [] },
  redDragon: { hp: 600, speed: 80, radius: 28, attackDamage: 42, attackRange: 176, aimSpeed: 480, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 8, abilities: [], splash: true, threat: 1.3 }
};
var UNIT_DEFS = Object.fromEntries(
  Object.entries(UNIT_RULES).map(([kind, row]) => {
    const def = { unitClass: "nonMechanical", ...row, xpReward: 0 };
    def.xpReward = kind === "spirit" ? 0 : Math.round(unitValue(def) / 3);
    if (def.creepFoodPower) def.goldBounty = creepGoldBounty(def.creepFoodPower, def.threat);
    return [kind, def];
  })
);
var UNIT_KINDS = Object.keys(UNIT_DEFS);
var NAVAL_KINDS = new Set(UNIT_KINDS.filter((kind) => UNIT_DEFS[kind].naval));
function unitMover(kind) {
  return NAVAL_KINDS.has(kind) ? "sea" : "land";
}
var ABILITY_KINDS = ["heal", "summon", "curse", "ashCurse", "charge", "stomp", "bloodlust", "web", "pinningBolt", "incendiaryFlume", ...VETERAN_ACTIVE_SKILL_IDS];
var CURSE_SUMMONED_DAMAGE = 100;
var ABILITY_DEFS = {
  ...Object.fromEntries(VETERAN_ACTIVE_SKILL_IDS.map((skill) => {
    const effect = VETERAN_SKILLS[skill].effect;
    if (effect.type !== "active") throw new Error(`Veteran ability ${skill} must be active`);
    return [skill, {
      behavior: "veteran",
      skill,
      range: effect.radius,
      plannerRange: effect.radius,
      cooldown: effect.cooldown,
      effectType: effect.action === "heal" ? "heal" : effect.modifiers.damageReduction ? "guardianField" : "bloodlust",
      autocast: "on",
      ...effect.targets ? { targets: effect.targets } : {}
    }];
  })),
  pinningBolt: { behavior: "weapon", target: "enemy", weapon: { presentation: "bolt", delivery: "bolt", radius: 20, maxHits: 3, pierceShare: 0.7 }, range: 472, plannerRange: 472, cooldown: seconds(14), damage: 36, rootTicks: seconds(2), effectType: "siegeBolt", autocast: "none" },
  incendiaryFlume: { behavior: "weapon", target: "point", weapon: { presentation: "fire", delivery: "shell", radius: 85, buildingMultiplier: 0.7 }, range: 224, plannerRange: 224, cooldown: seconds(18), damage: 14, burnTicks: seconds(4), effectType: "burningGround", autocast: "none" },
  // With spells on their own cooldowns (see ability-cooldowns) a healer heals through every fight. At one heal every 6s,
  // 9 health a second, two mirrored default AIs fought for 41 minutes on verdantCrossroads (12.7 before) and never ended on
  // wildMarches. Every 12s is Warcraft III's measure: a priest's mana holds it to about a third of a footman's damage.
  heal: { behavior: "heal", targets: { unitClasses: ["nonMechanical"] }, range: 240, plannerRange: 220, cooldown: seconds(12), healAmount: 55, effectType: "heal", autocast: "on" },
  summon: { behavior: "summon", range: 260, plannerRange: 240, cooldown: seconds(40), summonKind: "spirit", summonDuration: seconds(60), effectType: "summon", autocast: "on" },
  curse: { behavior: "curse", range: 280, plannerRange: 260, cooldown: seconds(7.5), effectDuration: seconds(18), damageMultiplier: 0.4, summonedDamage: CURSE_SUMMONED_DAMAGE, statusType: "curse", effectType: "curse", autocast: "on" },
  ashCurse: { behavior: "curse", range: 280, plannerRange: 260, cooldown: seconds(7.5), effectDuration: seconds(18), damageMultiplier: 0.45, scorchedDamageMultiplier: 0.3, summonedDamage: CURSE_SUMMONED_DAMAGE, statusType: "curse", effectType: "scorch", autocast: "on" },
  // The cavalry's charge: from 180 to 300 away, a slide that would carry the rider `drive` past the unit it meets (see
  // @@@charge), and a blow of twice the weapon's.
  charge: { behavior: "charge", minRange: 180, range: 300, plannerRange: 288, cooldown: seconds(15), damageMultiplier: 2, drive: 100, effectType: "chargeTrail", autocast: "on" },
  // @@@creep-abilities - The creeps' own, cast by themselves only: a granite golem's stomp stuns every enemy unit within
  // 160 for 1.5s, every 12s; an ogre mage's bloodlust quickens a fighting ally's blows by 30% for 15s, every 20s; a spider
  // queen's web roots one enemy within 220 in place for 2s, every 10s.
  stomp: { behavior: "stomp", range: 160, plannerRange: 150, cooldown: seconds(12), effectDuration: seconds(1.5), effectType: "stomp", autocast: "on" },
  bloodlust: { behavior: "bloodlust", range: 300, plannerRange: 280, cooldown: seconds(20), effectDuration: seconds(15), attackSpeed: 1.3, effectType: "bloodlust", autocast: "on" },
  web: { behavior: "web", range: 220, plannerRange: 200, cooldown: seconds(10), effectDuration: seconds(2), effectType: "web", autocast: "on" }
};
var BUILDING_RULES = {
  townHall: { hp: 900, radius: 48, cost: 400, buildTime: seconds(28), researches: ["buildingDurability"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 8 },
  barracks: { race: "grove", hp: 620, radius: 40, cost: 170, buildTime: seconds(11), researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  archeryRange: { race: "grove", hp: 520, radius: 38, cost: 150, buildTime: seconds(10), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  stables: { race: "grove", hp: 560, radius: 42, cost: 175, buildTime: seconds(11.5), researches: ["speedTraining"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  sanctum: { race: "grove", hp: 500, radius: 38, cost: 175, buildTime: seconds(11.25), researches: ["leadership"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  workshop: { hp: 580, radius: 42, cost: 205, buildTime: seconds(12.5), researches: ["rangeTraining"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  defenseTower: { neutralDamageMultiplier: 0.5, hp: 200, radius: 30, cost: 125, buildTime: seconds(6.5), researches: [], attackDamage: 16, attackRange: 480, attackCooldown: seconds(1.5), supplyProvided: 0 },
  moonWell: { race: "grove", hp: 300, radius: 30, cost: 115, buildTime: seconds(8.5), researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  emberForge: { race: "ember", hp: 560, radius: 40, cost: 165, buildTime: seconds(10.5), researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  cinderSpire: { race: "ember", hp: 500, radius: 38, cost: 170, buildTime: seconds(10.75), researches: ["speedTraining", "rangeTraining", "leadership"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  emberShrine: { race: "ember", hp: 280, radius: 30, cost: 115, buildTime: seconds(8.5), researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  // Ember's heavy-unit hall, its stables and workshop in one: one building for both heavies, priced above either.
  ashenHall: { race: "ember", hp: 600, radius: 42, cost: 215, buildTime: seconds(13), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  // Supply is the tech (see unit-tiers), so it is dear: a farm's 6 cost 120, a hall's 8 are priced the same inside its 400.
  farm: { hp: 320, radius: 30, cost: 120, buildTime: seconds(7), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 6 },
  // Ships are built here (see @@@naval); every race builds it, as it does a tower or a farm.
  shipyard: { hp: 600, radius: 44, cost: 170, buildTime: seconds(12), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0, shore: true }
};
var BUILDABLE_BUILDING_KINDS = Object.keys(BUILDING_RULES);
var COMMON_PRODUCTION = {
  worker: { at: "townHall" },
  transport: { at: "shipyard" },
  warship: { at: "shipyard" },
  shipOfTheLine: { at: "shipyard" },
  cutter: { at: "shipyard" },
  bombardShip: { at: "shipyard" },
  fireShip: { at: "shipyard" },
  carrier: { at: "shipyard" }
};
var RACE_TECH_RULES = {
  grove: { units: {
    ...COMMON_PRODUCTION,
    footman: { at: "barracks" },
    lancer: { at: "barracks" },
    archer: { at: "archeryRange" },
    horseArcher: { at: "stables" },
    raider: { at: "stables" },
    knight: { at: "stables" },
    priest: { at: "sanctum" },
    summoner: { at: "sanctum" },
    witch: { at: "sanctum" },
    golem: { at: "workshop" },
    ballista: { at: "workshop" }
  } },
  ember: { units: {
    ...COMMON_PRODUCTION,
    ashWarden: { at: "emberForge" },
    emberRavager: { at: "emberForge" },
    cinderRunner: { at: "emberForge" },
    sparkArcher: { at: "cinderSpire" },
    priest: { at: "cinderSpire" },
    ashHexer: { at: "cinderSpire" },
    summoner: { at: "cinderSpire" },
    ashChieftain: { at: "ashenHall" },
    cinderRevenant: { at: "ashenHall" },
    siegeRam: { at: "workshop" },
    catapult: { at: "workshop" },
    organGun: { at: "workshop" }
  } }
};
var PRODUCTION = {
  grove: RACE_TECH_RULES.grove.units,
  ember: RACE_TECH_RULES.ember.units
};
function trainingBuildingFor(race, kind) {
  return PRODUCTION[race][kind]?.at;
}
function canTrainAt(race, building, kind) {
  return trainingBuildingFor(race, kind) === building;
}
var TRAINABLE_UNIT_KINDS = UNIT_KINDS.filter(
  (kind) => canTrainForAnyRace(kind)
);
function canTrainForAnyRace(kind) {
  return Object.values(PRODUCTION).some((units) => units[kind] !== void 0);
}
var TRAINING_BY_RACE = Object.fromEntries(
  Object.keys(PRODUCTION).map((race) => [race, Object.fromEntries(
    BUILDABLE_BUILDING_KINDS.map((building) => [
      building,
      Object.freeze(TRAINABLE_UNIT_KINDS.filter((kind) => canTrainAt(race, building, kind)))
    ])
  )])
);
var BUILDING_DEFS = Object.fromEntries(
  BUILDABLE_BUILDING_KINDS.map((kind) => [kind, { ...BUILDING_RULES[kind], trains: TRAINABLE_UNIT_KINDS.filter((unit) => Object.values(PRODUCTION).some((units) => units[unit]?.at === kind)) }])
);
var ORDINARY_COMBAT_UNITS = TRAINABLE_UNIT_KINDS.filter((kind) => kind !== "worker");
var UPGRADE_RULES = {
  weaponTraining: {
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 150, researchTime: seconds(34.5), attackMultiplier: 1.15 },
      { cost: 175, researchTime: seconds(46.5), attackMultiplier: 1.3 },
      { cost: 200, researchTime: seconds(60), attackMultiplier: 1.45 }
    ]
  },
  reinforcedPlating: {
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 180, researchTime: seconds(40.5), maxHpMultiplier: 1.15 },
      { cost: 210, researchTime: seconds(52.5), maxHpMultiplier: 1.3 },
      { cost: 240, researchTime: seconds(66), maxHpMultiplier: 1.45 }
    ]
  },
  buildingDurability: {
    affectedUnitKinds: [],
    levels: [
      { cost: 200, researchTime: seconds(54), buildingMaxHpMultiplier: 1.2 }
    ]
  },
  // A tenth faster a level: at a quarter a level (1.25, 1.38, 1.5) a footman at the third outran a raider untrained (4.5
  // against 82), and the riders' speed was theirs no more.
  speedTraining: {
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 185, researchTime: seconds(46), speedMultiplier: 1.1 },
      { cost: 285, researchTime: seconds(60), speedMultiplier: 1.2 },
      { cost: 420, researchTime: seconds(76), speedMultiplier: 1.3 }
    ]
  },
  rangeTraining: {
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 195, researchTime: seconds(48), attackRangeMultiplier: 1.15 },
      { cost: 305, researchTime: seconds(64), attackRangeMultiplier: 1.25 },
      { cost: 450, researchTime: seconds(82), attackRangeMultiplier: 1.35 }
    ]
  },
  leadership: {
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    // @@@leadership-by-stars - A second and a third star are worth more than the first. One star regenerates 1, 2 and 3
    // health a second by the research's level, as it always did; two stars 3, 5 and 7; three stars 6, 9 and 12. A single
    // three-star veteran repays the first level on its own: 6 a second for 200 gold, where a moon well gives 3.3 for 115.
    // Each later level adds one a second per star, for armies with many veterans. At one a second per star for 220 gold,
    // the two to four stars a gauntlet army carries at 5-13 minutes regenerated half of what a well bought for the gold.
    levels: [
      { cost: 200, researchTime: seconds(52), veteranRegenByStars: [1, 3, 6] },
      { cost: 300, researchTime: seconds(70), veteranRegenByStars: [2, 5, 9] },
      { cost: 450, researchTime: seconds(90), veteranRegenByStars: [3, 7, 12] }
    ]
  }
};
var UPGRADE_KINDS = ["weaponTraining", "reinforcedPlating", "buildingDurability", "speedTraining", "rangeTraining", "leadership"];
var UPGRADE_DEFS = Object.fromEntries(
  UPGRADE_KINDS.map((kind) => [kind, {
    ...UPGRADE_RULES[kind],
    researchBuildingKinds: BUILDABLE_BUILDING_KINDS.filter((building) => BUILDING_DEFS[building].researches.includes(kind))
  }])
);
function canResearchAt(race, building, upgrade) {
  const rules = BUILDING_DEFS[building];
  return (rules.race === void 0 || rules.race === race) && rules.researches.includes(upgrade);
}
function raceDef(id, name, note) {
  const owns = (race) => race === void 0 || race === id;
  return {
    id,
    name,
    note,
    trainableUnits: TRAINABLE_UNIT_KINDS.filter((kind) => trainingBuildingFor(id, kind) !== void 0),
    buildableBuildings: BUILDABLE_BUILDING_KINDS.filter((kind) => owns(BUILDING_DEFS[kind].race)),
    upgrades: UPGRADE_KINDS.filter((upgrade) => BUILDABLE_BUILDING_KINDS.some((building) => canResearchAt(id, building, upgrade)))
  };
}
var RACE_DEFS = {
  grove: raceDef("grove", "Grove Kin", "Durable line holders, conventional ranged units, heavy tech, and moon-well recovery."),
  ember: raceDef("ember", "Ember Pact", "Faster fragile fighters, early support casters, ashen-hall heavies, and ember-shrine recovery.")
};

// src/shared/equipment.ts
var ITEM_DEFS = {
  shipCannon: { hands: 2, mass: SHIP_WEAPONS.shipCannon.mass, span: 4, passive: true },
  shipMortar: { hands: 2, mass: SHIP_WEAPONS.shipMortar.mass, span: 4, passive: true },
  flameProjector: { hands: 2, mass: SHIP_WEAPONS.flameProjector.mass, span: 4, passive: true },
  issuedWeapon: { hands: 1, mass: 4, passive: true },
  flameCloak: { slot: "body", mass: 3, passive: true },
  speedBoots: { slot: "feet", mass: 2, passive: true },
  regenRing: { slot: "head", mass: 1, passive: true },
  leatherArmor: { slot: "body", mass: 8, protection: 0.08, passive: true },
  roundShield: { hands: 1, mass: 5, protection: 0.12, passive: true },
  greatSword: { hands: 2, mass: 6, weapon: { damage: 22, range: 48, cooldown: seconds(1.8) }, passive: true },
  lightningRod: { hands: 1, mass: 3 },
  stormStaff: { hands: 2, mass: 5 },
  guardianScroll: { hands: 1, mass: 0.3 },
  healingScroll: { hands: 1, mass: 0.3 },
  experienceBook: { hands: 1, mass: 1 },
  breachCharge: { hands: 1, mass: 6 },
  ivoryTower: { hands: 1, mass: 2 }
};

// src/client/content/units-warfare.ts
var EN = {
  cutter: "Fast scouting vessel; useful for pursuit and harassment, vulnerable to heavy ships.",
  bombard: "Lobs shells at fixed ground positions. Strong against coastal buildings, with a minimum firing range.",
  fireship: "Short range flame fan punishes clustered ships. Incendiary shells leave a burning area.",
  carrier: "A broad deck carries cavalry, siege engines and troops. Floor space and payload limit its crew; slow sailing needs escorts, and sinking loses everyone aboard.",
  lineShip: "Three-masted heavy broadside ship. Starts with two removable cannons per side; eight side mounts support a full battery. Durable but slow to accelerate and turn, and needs escorts.",
  ram: "Armored melee siege engine. Its ordinary strikes deal bonus structure damage.",
  ballista: "Bolts pierce aligned targets. Pinning bolts briefly root targets; lateral movement can dodge them.",
  mortar: "Fixed-position stone shells deal splash and bonus structure damage. Needs protection inside its dead zone.",
  organ: "Directional burst volleys suppress clustered infantry; weak against buildings."
};
var MARKS = { cutter: ["mast", "flag", "arrow"], bombard: ["mast", "cannon", "blockSeams", "flag"], fireship: ["mast", "spark", "cannon", "flag"], carrier: ["mast", "cargo", "shieldBar", "flag"], lineShip: ["mast", "cannon", "shieldBar", "flag"], ram: ["blockSeams", "towerShield", "reins"], ballista: ["blockSeams", "bow", "arrow"], mortar: ["blockSeams", "cargo", "flag"], organ: ["blockSeams", "cannon", "arrow", "spark"] };
function card(en, zh, description, model, hotkey, naval = false) {
  return {
    name: { en, zh },
    description: { en: EN[model], zh: description },
    command: { icon: naval ? "\u2693" : "\u2699", hotkey },
    glyph: { silhouette: naval ? "warship-hull" : "golem-block", marks: MARKS[model] },
    art: { tier: model === "cutter" ? "basic" : "elite", bearing: naval ? "vessel" : "construct", faction: ["ram", "mortar", "organ"].includes(model) ? "ember" : "grove" }
  };
}
var WARFARE_UNITS = {
  cutter: card("Cutter", "\u5DE1\u6D77\u5FEB\u8247", "\u8F7B\u578B\u5FEB\u901F\u8230\u8247\uFF0C\u9002\u5408\u4FA6\u5BDF\u3001\u8FFD\u51FB\u548C\u9A9A\u6270\uFF1B\u4E0D\u5B9C\u4E0E\u91CD\u8230\u6B63\u9762\u5BF9\u5C04\u3002", "cutter", "q", true),
  bombardShip: card("Bombard Ship", "\u81FC\u70AE\u8230", "\u629B\u5C04\u70AE\u5F39\u8F70\u51FB\u6D77\u5CB8\u5EFA\u7B51\uFF1B\u70AE\u5F39\u843D\u70B9\u56FA\u5B9A\uFF0C\u6709\u8FD1\u7A0B\u6B7B\u89D2\u3002", "bombard", "b", true),
  fireShip: card("Fire Ship", "\u711A\u6F6E\u8230", "\u8FD1\u8DDD\u79BB\u6247\u5F62\u55B7\u706B\uFF0C\u514B\u5236\u5BC6\u96C6\u8230\u961F\uFF1B\u71C3\u6CB9\u5F39\u5728\u843D\u70B9\u7559\u4E0B\u6301\u7EED\u71C3\u70E7\u533A\u3002", "fireship", "f", true),
  carrier: card("Heavy Transport", "\u8FDC\u6D0B\u8FD0\u5175\u8230", "\u5BBD\u9614\u7532\u677F\u53EF\u642D\u8F7D\u9A91\u5175\u3001\u5DE5\u7A0B\u6B66\u5668\u548C\u6B65\u5175\u4F5C\u6218\uFF1B\u5360\u5730\u4E0E\u8F7D\u91CD\u5171\u540C\u9650\u5236\u4EBA\u6570\u3002\u822A\u901F\u8F83\u6162\uFF0C\u9700\u62A4\u822A\uFF0C\u8239\u6C89\u65F6\u4E58\u5458\u4E00\u540C\u635F\u5931\u3002", "carrier", "c", true),
  shipOfTheLine: card("Ship of the Line", "\u91CD\u578B\u8237\u70AE\u8230", "\u4E09\u6845\u91CD\u8230\uFF0C\u51FA\u5382\u5DE6\u53F3\u5404\u914D\u4E24\u95E8\u53EF\u62C6\u5378\u706B\u70AE\uFF0C\u516B\u4E2A\u8237\u4FA7\u70AE\u4F4D\u53EF\u6269\u5145\u5B8C\u6574\u70AE\u5217\u3002\u8239\u4F53\u575A\u56FA\uFF0C\u52A0\u901F\u548C\u8F6C\u5411\u8F83\u6162\uFF0C\u9700\u62A4\u822A\u3002", "lineShip", "l", true),
  siegeRam: card("Siege Ram", "\u94C1\u7532\u51B2\u8F66", "\u91CD\u7532\u8FD1\u6218\u653B\u57CE\u5668\u68B0\uFF0C\u666E\u901A\u649E\u51FB\u5BF9\u5EFA\u7B51\u9020\u6210\u989D\u5916\u4F24\u5BB3\u3002", "ram", "q"),
  ballista: card("Ballista", "\u5E8A\u5F29", "\u5C04\u51FA\u80FD\u7A7F\u900F\u76F4\u7EBF\u76EE\u6807\u7684\u5F29\u77E2\uFF1B\u9489\u5C04\u547D\u4E2D\u540E\u77ED\u6682\u5B9A\u8EAB\u3002\u907F\u5F00\u5FEB\u901F\u4FA7\u5411\u79FB\u52A8\u7684\u76EE\u6807\u3002", "ballista", "b"),
  catapult: card("Catapult", "\u91CD\u578B\u6295\u77F3\u673A", "\u629B\u5C04\u56FA\u5B9A\u843D\u70B9\u7684\u77F3\u5F39\uFF0C\u8303\u56F4\u4F24\u5BB3\u5E76\u64C5\u957F\u62C6\u5EFA\u7B51\uFF1B\u8FD1\u7A0B\u6B7B\u89D2\u9700\u8981\u53CB\u519B\u4FDD\u62A4\u3002", "mortar", "p"),
  organGun: card("Organ Gun", "\u8FDE\u5F29\u70AE\u8F66", "\u6247\u5F62\u8FDE\u5C04\u538B\u5236\u5BC6\u96C6\u6B65\u5175\uFF0C\u5BF9\u5EFA\u7B51\u8F83\u5F31\u3002", "organ", "n")
};

// src/client/content/units-common.ts
var COMMON_UNITS = {
  priest: {
    name: { en: "Priest", zh: "\u7267\u5E08" },
    description: { en: "Support caster with a targeted heal for wounded non-mechanical allies.", zh: "\u652F\u63F4\u65BD\u6CD5\u8005\uFF0C\u53EF\u4EE5\u5BF9\u53D7\u4F24\u7684\u975E\u673A\u68B0\u53CB\u519B\u8FDB\u884C\u5B9A\u70B9\u6CBB\u7597\u3002" },
    command: { icon: "+", hotkey: "p" },
    glyph: { silhouette: "priest-medallion", marks: ["halo", "cross", "satchel"] },
    art: { tier: "advanced", bearing: "foot", faction: "common" }
  },
  summoner: {
    name: { en: "Summoner", zh: "\u53EC\u5524\u5E08" },
    description: { en: "Caster that creates a temporary spirit at a target point.", zh: "\u65BD\u6CD5\u8005\uFF0C\u53EF\u4EE5\u5728\u76EE\u6807\u70B9\u53EC\u5524\u4E34\u65F6\u7075\u4F53\u3002" },
    command: { icon: "\u25CE", hotkey: "u" },
    glyph: { silhouette: "summoner-ring", marks: ["outerRing", "innerSigil", "spark"] },
    art: { tier: "advanced", bearing: "foot", faction: "common" }
  },
  worker: {
    name: { en: "Worker", zh: "\u519C\u6C11" },
    description: { en: "Worker. Gathers gold, builds structures, repairs the economy, and can defend itself only in a pinch.", zh: "\u519C\u6C11\u3002\u91C7\u96C6\u91D1\u77FF\u3001\u5EFA\u9020\u5EFA\u7B51\u3001\u4FEE\u7406\u7ECF\u6D4E\u4F53\u7CFB\uFF0C\u7D27\u6025\u65F6\u4E5F\u80FD\u52C9\u5F3A\u81EA\u536B\u3002" },
    command: { icon: "\u2318", hotkey: "w" },
    glyph: { silhouette: "worker-apron", marks: ["pick", "satchel", "coinSlash"] },
    art: { tier: "civilian", bearing: "foot", faction: "grove" }
  },
  // Both races' ships (see @@@ships): a hull on the water, the owner's colour on the sail.
  transport: {
    name: { en: "Transport", zh: "\u8FD0\u8F93\u8239" },
    description: { en: "Open-deck ship with no built-in weapon. Crew can move, fight and cast aboard; footprint and payload limit embarkation. Unloads near shore; sinking loses its crew.", zh: "\u5F00\u653E\u7532\u677F\u8FD0\u8F93\u8239\uFF0C\u65E0\u56FA\u5B9A\u6B66\u5668\u3002\u4E58\u5458\u53EF\u5728\u8239\u4E0A\u79FB\u52A8\u3001\u6218\u6597\u548C\u65BD\u6CD5\uFF1B\u5360\u5730\u4E0E\u8F7D\u91CD\u5171\u540C\u9650\u5236\u4EBA\u6570\u3002\u9760\u5CB8\u5378\u8F7D\uFF0C\u8239\u6C89\u65F6\u4E58\u5458\u4E00\u540C\u635F\u5931\u3002" },
    command: { icon: "\u26F4", hotkey: "t" },
    glyph: { silhouette: "transport-hull", marks: ["mast", "cargo", "flag"] },
    art: { tier: "advanced", bearing: "vessel", faction: "grove" }
  },
  warship: {
    name: { en: "Warship", zh: "\u6218\u8239" },
    description: { en: "Ship. Shoots ships and anything on the shore within its range, about an archer's. A tower outranges it. Limited deck space supports embarked ranged troops or a healer.", zh: "\u8239\u3002\u653B\u51FB\u5C04\u7A0B\u5185\u7684\u8239\u548C\u5CB8\u4E0A\u76EE\u6807\uFF0C\u5C04\u7A0B\u4E0E\u5F13\u624B\u76F8\u5F53\uFF1B\u9632\u5FA1\u5854\u6BD4\u5B83\u6253\u5F97\u8FDC\u3002\u6709\u9650\u7532\u677F\u53EF\u642D\u8F7D\u5C04\u624B\u6216\u6CBB\u7597\u8005\u534F\u540C\u4F5C\u6218\u3002" },
    command: { icon: "\u2694", hotkey: "w" },
    glyph: { silhouette: "warship-hull", marks: ["mast", "cannon", "flag"] },
    art: { tier: "elite", bearing: "vessel", faction: "grove" }
  }
};

// src/client/content/units-ember.ts
var EMBER_UNITS = {
  ashWarden: {
    name: { en: "Ash Warden", zh: "\u7070\u70EC\u5B88\u536B" },
    description: { en: "Durable ember infantry that holds the line better than basic soldiers.", zh: "\u8010\u4E45\u7684\u7070\u70EC\u6B65\u5175\uFF0C\u6BD4\u57FA\u7840\u58EB\u5175\u66F4\u9002\u5408\u9876\u7EBF\u3002" },
    command: { icon: "\u25ED", hotkey: "g" },
    glyph: { silhouette: "shield-triangle", marks: ["shieldBar", "halo", "longSpear"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" }
  },
  emberRavager: {
    name: { en: "Ember Ravager", zh: "\u4F59\u70EC\u52AB\u63A0\u8005" },
    description: { en: "Aggressive ember infantry with strong close-range damage.", zh: "\u8FDB\u653B\u6027\u7684\u4F59\u70EC\u6B65\u5175\uFF0C\u8FD1\u8DDD\u79BB\u4F24\u5BB3\u5F88\u5F3A\u3002" },
    command: { icon: "\u25C6", hotkey: "v" },
    glyph: { silhouette: "ember-bruiser", marks: ["shortSword", "spark", "scar"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" }
  },
  cinderRunner: {
    name: { en: "Cinder Runner", zh: "\u4F59\u706B\u5954\u88AD\u8005" },
    description: { en: "Fast ember melee unit for chasing weak targets and forcing fights.", zh: "\u9AD8\u901F\u4F59\u70EC\u8FD1\u6218\u5355\u4F4D\uFF0C\u7528\u4E8E\u8FFD\u51FB\u5F31\u76EE\u6807\u5E76\u5F3A\u884C\u5F00\u6218\u3002" },
    command: { icon: "\u25C7", hotkey: "r" },
    glyph: { silhouette: "cinder-skirmisher", marks: ["tail", "spark", "shortSword"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" }
  },
  sparkArcher: {
    name: { en: "Spark Archer", zh: "\u706B\u82B1\u5F13\u624B" },
    description: { en: "Arrows have a 15% chance to ignite a small patch of ground for 6 seconds. Burns clustered enemies and scorches them for allied melee attacks.", zh: "\u7BAD\u77E2\u6709 15% \u6982\u7387\u70B9\u71C3\u4E00\u5C0F\u5757\u5730\u9762\uFF0C\u6301\u7EED 6 \u79D2\u3002\u514B\u5236\u5BC6\u96C6\u7AD9\u4F4D\uFF0C\u707C\u70E7\u72B6\u6001\u53EF\u914D\u5408\u53CB\u519B\u8FD1\u6218\u653B\u51FB\u3002" },
    command: { icon: "\u22CA", hotkey: "a" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "spark"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" }
  },
  ashHexer: {
    name: { en: "Ash Hexer", zh: "\u7070\u70EC\u5DEB\u5E08" },
    description: { en: "Ember debuff caster that weakens enemy damage through curse.", zh: "\u4F59\u70EC\u51CF\u76CA\u65BD\u6CD5\u8005\uFF0C\u901A\u8FC7\u8BC5\u5492\u524A\u5F31\u654C\u65B9\u4F24\u5BB3\u3002" },
    command: { icon: "\u263E", hotkey: "x" },
    glyph: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "rune"] },
    art: { tier: "advanced", bearing: "foot", faction: "ember" }
  },
  ashChieftain: {
    name: { en: "Ash Chieftain", zh: "\u7070\u70EC\u914B\u957F" },
    description: { en: "Ember war leader who hunts casters: deals extra damage to summoned units and casters.", zh: "\u730E\u6740\u6CD5\u5E08\u7684\u4F59\u70EC\u9996\u9886\uFF1A\u5BF9\u53EC\u5524\u751F\u7269\u548C\u6CD5\u5E08\u9020\u6210\u989D\u5916\u4F24\u5BB3\u3002" },
    command: { icon: "\u265B", hotkey: "h" },
    glyph: { silhouette: "ember-bruiser", marks: ["visor", "spark", "curseSlash"] },
    art: { tier: "elite", bearing: "foot", faction: "ember" }
  },
  cinderRevenant: {
    name: { en: "Cinder Revenant", zh: "\u4F59\u70EC\u590D\u751F\u8005" },
    description: { en: "Ember elite with modest health that burns its wounds away.", zh: "\u751F\u547D\u503C\u4E0D\u9AD8\u7684\u4F59\u70EC\u7CBE\u82F1\uFF0C\u4F24\u53E3\u5728\u4F59\u70EC\u4E2D\u8FC5\u901F\u6108\u5408\u3002" },
    command: { icon: "\u273A", hotkey: "n" },
    glyph: { silhouette: "ember-bruiser", marks: ["spark", "halo", "scar"] },
    art: { tier: "elite", bearing: "foot", faction: "ember" }
  }
};

// src/client/content/units-grove.ts
var GROVE_UNITS = {
  footman: {
    name: { en: "Footman", zh: "\u6B65\u5175" },
    description: { en: "Front-line melee soldier for early fights and body-blocking fragile units.", zh: "\u524D\u6392\u8FD1\u6218\u58EB\u5175\uFF0C\u7528\u4E8E\u65E9\u671F\u4EA4\u6218\u5E76\u4FDD\u62A4\u8106\u5F31\u5355\u4F4D\u3002" },
    command: { icon: "\u25B3", hotkey: "f" },
    glyph: { silhouette: "shield-triangle", marks: ["shieldBar", "shortSword", "scar"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" }
  },
  archer: {
    name: { en: "Archer", zh: "\u5F13\u7BAD\u624B" },
    description: { en: "A steady ranged firing line behind melee protection. Moving too far forces a fresh aim.", zh: "\u8FDC\u7A0B\u9635\u7EBF\u5355\u4F4D\uFF0C\u9002\u5408\u5728\u8FD1\u6218\u4FDD\u62A4\u4E0B\u6301\u7EED\u5C04\u51FB\uFF1B\u5927\u5E45\u79FB\u52A8\u540E\u9700\u8981\u91CD\u65B0\u7784\u51C6\u3002" },
    command: { icon: "\u22C9", hotkey: "a" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "satchel"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" }
  },
  horseArcher: {
    name: { en: "Horse Archer", zh: "\u9A91\u5C04\u624B" },
    description: { en: "Fast mounted skirmisher. Can keep aim while moving farther between shots, trading damage per gold for mobility.", zh: "\u9AD8\u901F\u9A91\u5C04\u5355\u4F4D\uFF0C\u53EF\u5728\u66F4\u5927\u7684\u4F4D\u79FB\u8303\u56F4\u5185\u4FDD\u7559\u7784\u51C6\uFF1B\u7528\u8F83\u4F4E\u7684\u653B\u4EF7\u6BD4\u6362\u53D6\u98CE\u7B5D\u548C\u673A\u52A8\u4F18\u52BF\u3002" },
    command: { icon: "\u22C9", hotkey: "h" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "reins"] },
    art: { tier: "advanced", bearing: "mounted", faction: "grove" }
  },
  raider: {
    name: { en: "Raider", zh: "\u63A0\u88AD\u8005" },
    description: { en: "Fast melee harasser for chasing workers and punishing isolated targets.", zh: "\u9AD8\u901F\u8FD1\u6218\u9A9A\u6270\u5355\u4F4D\uFF0C\u7528\u4E8E\u8FFD\u51FB\u519C\u6C11\u5E76\u60E9\u7F5A\u843D\u5355\u76EE\u6807\u3002" },
    command: { icon: "\u25C7", hotkey: "r" },
    glyph: { silhouette: "raider-kite", marks: ["reins", "spur", "shortSword"] },
    art: { tier: "basic", bearing: "mounted", faction: "grove" }
  },
  lancer: {
    name: { en: "Lancer", zh: "\u957F\u67AA\u5175" },
    description: { en: "Reach melee fighter with a slightly longer attack range than ordinary infantry.", zh: "\u957F\u67C4\u8FD1\u6218\u5355\u4F4D\uFF0C\u653B\u51FB\u8DDD\u79BB\u6BD4\u666E\u901A\u6B65\u5175\u7A0D\u957F\u3002" },
    command: { icon: "\u2197", hotkey: "l" },
    glyph: { silhouette: "lancer-pennant", marks: ["longSpear", "flag", "shieldBar"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" }
  },
  knight: {
    name: { en: "Knight", zh: "\u9A91\u58EB" },
    description: { en: "Heavy cavalry for decisive fights and base pressure.", zh: "\u91CD\u9A91\u5175\uFF0C\u7528\u4E8E\u51B3\u5B9A\u6027\u4F1A\u6218\u548C\u57FA\u5730\u538B\u5236\u3002" },
    command: { icon: "\u265C", hotkey: "k" },
    glyph: { silhouette: "knight-helm", marks: ["visor", "towerShield", "shortSword"] },
    art: { tier: "elite", bearing: "mounted", faction: "grove" }
  },
  witch: {
    name: { en: "Witch", zh: "\u5973\u5DEB" },
    description: { en: "Debuff caster that weakens enemy damage through curse; also damages summoned targets.", zh: "\u51CF\u76CA\u65BD\u6CD5\u8005\uFF0C\u901A\u8FC7\u8BC5\u5492\u524A\u5F31\u654C\u65B9\u4F24\u5BB3\uFF1B\u8FD8\u80FD\u76F4\u63A5\u4F24\u5BB3\u88AB\u8BC5\u5492\u7684\u53EC\u5524\u7269\u3002" },
    command: { icon: "\u263E", hotkey: "c" },
    glyph: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "spark"] },
    art: { tier: "advanced", bearing: "foot", faction: "grove" }
  },
  golem: {
    name: { en: "Golem", zh: "\u9B54\u50CF" },
    description: { en: "Slow heavy siege body with high health and strong melee damage.", zh: "\u7F13\u6162\u7684\u91CD\u578B\u653B\u575A\u5355\u4F4D\uFF0C\u751F\u547D\u503C\u9AD8\uFF0C\u8FD1\u6218\u4F24\u5BB3\u5F3A\u3002" },
    command: { icon: "\u25A3", hotkey: "g" },
    glyph: { silhouette: "golem-block", marks: ["rune", "blockSeams", "scar"] },
    art: { tier: "elite", bearing: "construct", faction: "grove" }
  }
};

// src/client/content/units-creeps.ts
var CREEP_UNITS = {
  murlocPeon: {
    name: { en: "Murloc Peon", zh: "\u9C7C\u4EBA\u82E6\u5DE5" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "shortSword"] },
    art: { tier: "basic", bearing: "foot", faction: "wild" }
  },
  murlocHunter: {
    name: { en: "Murloc Hunter", zh: "\u9C7C\u4EBA\u730E\u624B" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" }
  },
  tidePriest: {
    name: { en: "Tide Priest", zh: "\u6F6E\u6C50\u796D\u53F8" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "halo"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" }
  },
  deepSnapper: {
    name: { en: "Deep Snapper", zh: "\u6DF1\u6E0A\u5DE8\u9CCC" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "towerShield"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" }
  },
  rubbleGolem: {
    name: { en: "Rubble Golem", zh: "\u788E\u77F3\u9B54\u50CF" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "scar"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" }
  },
  rockGolem: {
    name: { en: "Rock Golem", zh: "\u5CA9\u77F3\u9B54\u50CF" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "rune"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" }
  },
  graniteGolem: {
    name: { en: "Granite Golem", zh: "\u82B1\u5C97\u5CA9\u9B54\u50CF" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "spark", "rune"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" }
  },
  ogreWarrior: {
    name: { en: "Ogre Warrior", zh: "\u98DF\u4EBA\u9B54\u6218\u58EB" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "shortSword"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" }
  },
  ogreMage: {
    name: { en: "Ogre Mage", zh: "\u98DF\u4EBA\u9B54\u6CD5\u5E08" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "crescent"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" }
  },
  ogreLord: {
    name: { en: "Ogre Lord", zh: "\u98DF\u4EBA\u9B54\u9886\u4E3B" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "flag"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" }
  },
  spiderling: {
    name: { en: "Spiderling", zh: "\u5C0F\u8718\u86DB" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "scar"] },
    art: { tier: "basic", bearing: "beast", faction: "wild" }
  },
  venomSpider: {
    name: { en: "Venom Spider", zh: "\u6BD2\u86DB" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "curseSlash"] },
    art: { tier: "advanced", bearing: "beast", faction: "wild" }
  },
  spiderQueen: {
    name: { en: "Spider Queen", zh: "\u86DB\u540E" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "outerRing"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" }
  },
  dragonWhelp: {
    name: { en: "Dragon Whelp", zh: "\u5E7C\u9F99" },
    glyph: { silhouette: "wildling-thorns", marks: ["innerSigil", "spark"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" }
  },
  redDragon: {
    name: { en: "Red Dragon", zh: "\u7EA2\u9F99" },
    glyph: { silhouette: "wildling-thorns", marks: ["innerSigil", "flag", "spark"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" }
  }
};

// src/client/content/units-neutral.ts
var NEUTRAL_UNITS = {
  spirit: {
    name: { en: "Spirit", zh: "\u7075\u4F53" },
    glyph: { silhouette: "spirit-wisp", marks: ["tail", "spark", "halo"] },
    art: { tier: "basic", bearing: "spirit", faction: "summoned" }
  },
  mercenary: {
    name: { en: "Mercenary", zh: "\u96C7\u4F63\u5175" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "shortSword", "scar"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" }
  },
  contractArcher: {
    name: { en: "Contract Archer", zh: "\u5951\u7EA6\u5F13\u624B" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "bow", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" }
  },
  fieldMedic: {
    name: { en: "Field Medic", zh: "\u6218\u5730\u533B\u5E08" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "halo", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" }
  },
  wildling: {
    name: { en: "Wildling", zh: "\u6797\u95F4\u91CE\u4EBA" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "curseSlash"] },
    art: { tier: "basic", bearing: "foot", faction: "wild" }
  },
  mossGnawer: {
    name: { en: "Moss Gnawer", zh: "\u82D4\u9F20" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "shortSword"] },
    art: { tier: "basic", bearing: "beast", faction: "wild" }
  },
  thornSlinger: {
    name: { en: "Thorn Slinger", zh: "\u8346\u523A\u5C04\u624B" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "bow", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" }
  },
  barkMender: {
    name: { en: "Bark Mender", zh: "\u6811\u76AE\u533B\u8005" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "halo", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" }
  },
  stonebackBrute: {
    name: { en: "Stoneback Brute", zh: "\u77F3\u80CC\u86EE\u517D" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "blockSeams", "shieldBar"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" }
  },
  gladeWitch: {
    name: { en: "Glade Witch", zh: "\u6797\u95F4\u5973\u5DEB" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "crescent", "curseSlash"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" }
  },
  ancientStag: {
    name: { en: "Ancient Stag", zh: "\u8FDC\u53E4\u5DE8\u9E7F" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "visor", "halo"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" }
  }
};

// src/client/content/units.ts
var TRAINED_UNIT_CARDS = { ...COMMON_UNITS, ...GROVE_UNITS, ...EMBER_UNITS, ...WARFARE_UNITS };
var UNIT_CARDS = { ...TRAINED_UNIT_CARDS, ...NEUTRAL_UNITS, ...CREEP_UNITS };

// src/client/art/motion.ts
var REST = Object.freeze({ stride: 0, lift: 0, lean: 0, reach: 0, weaponAngle: 0, offhand: 0, castGlow: 0, breathe: 0, recoil: 0, bowDraw: 0.35 });
var CONTACT = [1, 0.76, 0.48, 0.24, 0.08, 0];
var WORK_REACH = [0.05, -0.12, 0.8, 1, 0.45, 0.08];
var WORK_ANGLE = [-0.35, -0.7, 0.9, 1.2, 0.45, -0.1];
var FAMILIES = ["slash", "thrust", "bow", "staff", "work", "creature", "siege"];
var MODES = ["idle", "walk", "attack", "cast", "work"];
function keyPose(mode, frame, variant, family) {
  if (mode === "idle" && frame === 0 || (mode === "attack" || mode === "cast") && frame === 5) return REST;
  if (mode === "idle") {
    const breath = Math.sin(frame * Math.PI / 4);
    return Object.freeze({ ...REST, breathe: breath * 0.65, lean: breath * 8e-3 });
  }
  if (mode === "walk") {
    const stride = Math.sin(frame * Math.PI / 4);
    return Object.freeze({ ...REST, stride, lift: -Math.abs(stride) * 1.3, weaponAngle: stride * 0.09, offhand: -stride * 0.06 });
  }
  if (mode === "work") return Object.freeze({ ...REST, reach: WORK_REACH[frame], weaponAngle: WORK_ANGLE[frame], lean: [0.025, -0.025, 0.1, 0.14, 0.09, 0.035][frame] });
  const recovery = mode === "attack" && (family === "slash" || family === "work") ? [1, 0.65, 0.15, -0.28, -0.15, 0][frame] : mode === "attack" && family === "thrust" ? [1, 0.55, 0.12, -0.12, -0.05, 0][frame] : CONTACT[frame];
  if (mode === "cast") return Object.freeze({ ...REST, reach: recovery * 0.45, lean: -0.035 * recovery, weaponAngle: -0.48 * recovery, offhand: -0.3 * recovery, castGlow: recovery });
  switch (family) {
    case "thrust":
      return Object.freeze({ ...REST, reach: recovery * [1, 0.85, 0.92][variant], lean: recovery * 0.07, weaponAngle: recovery * [0.06, -0.12, 0.18][variant], offhand: recovery * -0.08 });
    case "bow":
      return Object.freeze({ ...REST, reach: recovery * [0.7, 0.6, 0.65][variant], lean: recovery * -0.025, weaponAngle: recovery * [0, -0.07, 0.07][variant], offhand: recovery * 0.18, recoil: recovery, bowDraw: [0, 0.25, 0.5, 0.9, 0.6, 0.35][frame] });
    case "staff":
      return Object.freeze({ ...REST, reach: recovery * 0.75, lean: recovery * 0.045, weaponAngle: recovery * [0.32, -0.18, 0.12][variant], offhand: recovery * -0.1 });
    case "siege":
      return Object.freeze({ ...REST, recoil: recovery, reach: recovery });
    case "creature":
      return Object.freeze({ ...REST, reach: recovery * [1, 0.85, 0.95][variant], lean: recovery * [0.06, -0.025, 0.035][variant], weaponAngle: recovery * [0.18, -0.16, 0.08][variant] });
    default:
      return Object.freeze({ ...REST, reach: recovery * [1, 0.88, 0.93][variant], lean: recovery * [0.075, 0.055, 0.065][variant], weaponAngle: recovery * [1.45, 0.95, 1.2][variant], offhand: recovery * -0.12 });
  }
}
var BANK = new Map(FAMILIES.map((family) => [
  family,
  MODES.map((mode) => Array.from({ length: 3 }, (_, variant) => Array.from({ length: mode === "walk" || mode === "idle" ? 8 : 6 }, (_2, frame) => keyPose(mode, frame, variant, family))))
]));
var MODE_INDEX = { idle: 0, walk: 1, attack: 2, cast: 3, work: 4 };
function sampleMotion(pose, family = "slash") {
  const frames = BANK.get(family)[MODE_INDEX[pose.mode]][Math.abs(Math.trunc(pose.variant ?? 0)) % 3];
  return frames[Math.max(0, Math.min(frames.length - 1, Math.trunc(pose.frame)))] ?? REST;
}
var DIRECTION_BANK = Array.from({ length: 13 }, (_, index) => {
  const bin = index - 6, source = bin <= -2 ? -1 : bin >= 2 ? 1 : 0;
  const angle2 = bin * Math.PI / 12, sourceAngle = source * Math.PI / 3;
  return Object.freeze({ bin, source, angle: angle2, sourceAngle, correction: angle2 - sourceAngle });
});
function actionDirection(pose) {
  return DIRECTION_BANK[finiteAim(pose) + 6];
}

// src/client/art/rig.ts
var WORK_POSES = [
  { lean: 0.025, wrist: [10, -24], tool: -0.35 },
  { lean: -0.025, wrist: [10, -29], tool: -0.7 },
  { lean: 0.1, wrist: [16, -14], tool: 0.9 },
  { lean: 0.14, wrist: [16, -12], tool: 1.2 },
  { lean: 0.09, wrist: [14, -16], tool: 0.45 },
  { lean: 0.035, wrist: [11, -20], tool: -0.1 }
];
function defaultEquipment(f) {
  if (f.weapon) return f.weapon;
  return f.role === "sword" ? "sword" : f.role === "axe" ? "axe" : f.role === "pike" ? "pike" : f.role === "bow" ? "bow" : f.role === "worker" ? "pick" : f.role === "priest" ? "crozier" : "staff";
}
function equipmentForKind(kind) {
  const figure = figures[kind];
  return figure ? defaultEquipment(figure) : creatures[kind]?.weapon;
}
function equipmentFamily(weapon2) {
  return weapon2 === "pike" || weapon2 === "pitchfork" || weapon2 === "javelin" || weapon2 === "sling" ? "thrust" : weapon2 === "bow" ? "bow" : weapon2 === "staff" || weapon2 === "crozier" ? "staff" : weapon2 === "pick" ? "work" : "slash";
}
function socketPoint(grip, angle2, x, y) {
  return [grip[0] + Math.cos(angle2) * x - Math.sin(angle2) * y, grip[1] + Math.sin(angle2) * x + Math.cos(angle2) * y];
}
var mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
var blend = (a, b, t) => ({
  wrist: mix(a.wrist, b.wrist, t),
  elbow: mix(a.elbow, b.elbow, t),
  angle: a.angle + (b.angle - a.angle) * t
});
var hand = (wrist, elbow, angle2) => ({ wrist, elbow, angle: angle2 });
function bladeDrawing(weapon2, source, variant, thrust) {
  const ready = hand([12, -12], [10, -17], weapon2 === "axe" ? 0.15 : weapon2 === "pick" ? 0.24 : 0.32);
  const contacts = [hand([17, -27], [10, -21], 0.52), hand([19, -17], [10, -18], ready.angle + 1.45), hand([14, -24], [10, -20], 2.65)];
  const contact = contacts[source + 1];
  if (thrust) {
    contact.wrist[0] += 3;
    contact.elbow[0] += 2;
    contact.angle -= 0.15;
  }
  if (variant === 1) {
    contact.wrist[1] -= 2;
    contact.angle -= 0.2;
  }
  if (variant === 2) {
    contact.wrist[0] -= 2;
    contact.elbow[1] += 1;
    contact.angle += 0.12;
  }
  return { ready, contact };
}
function shaftDrawing(mounted, source) {
  const ready = mounted ? hand([9, -16], [7, -17], -0.2) : hand([8, -19], [7, -17], -0.95);
  const contact = (mounted ? [hand([18, -25], [11, -22], -Math.PI / 3), hand([12, -16], [8, -17], -0.04), hand([19, -15], [11, -18], Math.PI / 3)] : [hand([18, -25], [10, -22], -Math.PI / 3), hand([13, -19], [8, -17], -0.04), hand([19, -15], [10, -18], Math.PI / 3)])[source + 1];
  return { ready, contact };
}
function bowDrawing(source) {
  return { ready: hand([18, -21], [10, -21], 0), contact: [
    hand([16, -30], [10, -25], -Math.PI / 3),
    hand([18, -21], [10, -21], 0),
    hand([17, -13], [10, -17], Math.PI / 3)
  ][source + 1] };
}
function staffDrawing(source, casting) {
  return { ready: hand([12, -12], [10, -17], 0), contact: [
    hand([13, -20], [10, -22], 0.12),
    hand([14, -15], [10, -19], 0.08),
    hand([14, -12], [10, -17], -0.12)
  ][source + 1], strength: casting ? 1 : 0.65 };
}
function guardDrawing(weapon2, aim) {
  const index = aim.source + 1;
  if (weapon2 === "pike" || weapon2 === "pitchfork") return hand(
    [[7, -16], [4, -19], [9, -24]][index],
    [[6, -19], [5, -19], [6, -20]][index],
    aim.angle
  );
  if (weapon2 === "bow") return hand(
    [[12, -24], [13, -20], [14, -15]][index],
    [[8, -22], [8, -20], [9, -18]][index],
    aim.angle
  );
  if (weapon2 === "staff" || weapon2 === "crozier") return hand(
    [[11, -15], [11, -12], [12, -10]][index],
    [9, -18],
    0.04
  );
  return hand(
    [[10, -18], [9, -21], [10, -25]][index],
    [[7, -18], [7, -20], [7, -21]][index],
    (weapon2 === "javelin" ? [-0.1, 0.6, 1.2] : [-0.2, 0.55, 1.2])[index] + aim.correction * 0.5
  );
}
function sampleFigurePose(f, pose, options = {}) {
  const weapon2 = options.weapon ?? defaultEquipment(f), family = equipmentFamily(weapon2), requested = options.motion;
  const compatible = requested === family || (family === "slash" || family === "thrust") && (requested === "slash" || requested === "thrust");
  const motion = sampleMotion(pose, compatible ? requested : family), direction = actionDirection(pose);
  const working = weapon2 === "pick" && pose.mode === "work", work = working ? WORK_POSES[pose.frame] : void 0;
  const impact = pose.mode === "attack" ? motion.reach : 0, cast = pose.mode === "cast" ? motion.castGlow : 0;
  const shaft = weapon2 === "pike" || weapon2 === "pitchfork", staff = weapon2 === "staff" || weapon2 === "crozier";
  const shield2 = weapon2 !== "greatSword" && weapon2 !== "bow" && weapon2 !== "pick" && (options.shield ?? (weapon2 === "sword" || shaft && (!!f.mounted || !!f.elite)));
  const supported = weapon2 === "bow" || weapon2 === "greatSword" || weapon2 === "pick" || shaft && !shield2;
  const variant = Math.abs(Math.trunc(pose.variant ?? 0)) % 3;
  let drawing, readyDrawing;
  let angleReturn;
  let weight = pose.mode === "attack" ? motion.reach : 0;
  const source = direction.source;
  if (staff) {
    const authored = staffDrawing(source, cast > 0);
    weight = (cast || impact) * authored.strength;
    readyDrawing = authored.ready;
    drawing = blend(authored.ready, authored.contact, weight);
    drawing.angle += (pose.mode === "attack" ? [0, -0.08, 0.09][variant] : 0) * weight;
  } else if (weapon2 === "bow") {
    const authored = bowDrawing(source);
    weight = pose.mode === "attack" ? [1, 0.76, 0.48, 0.24, 0.08, 0][pose.frame] ?? 0 : 0;
    readyDrawing = authored.ready;
    drawing = blend(authored.ready, authored.contact, weight);
    drawing.angle += direction.correction * weight;
  } else if (shaft) {
    const authored = shaftDrawing(!!f.mounted, source);
    drawing = blend(authored.ready, authored.contact, weight);
    readyDrawing = authored.ready;
    const turn = pose.mode === "attack" ? [1, 1, 0.82, 0.46, 0.16, 0][pose.frame] ?? 0 : 0;
    angleReturn = 1 - turn;
    drawing.angle = authored.ready.angle + (authored.contact.angle + direction.correction - authored.ready.angle) * turn;
  } else if (weapon2 === "none" || weapon2 === "sling" || weapon2 === "javelin") {
    const ready = hand(weapon2 === "none" ? [8, -3] : [12, -12], [7, -14], weapon2 === "javelin" ? 0.45 : 0);
    readyDrawing = ready;
    const contact = [hand([13, -34], [8, -25], -0.4), hand([24, -20], [13, -20], 1.4), hand([17, -9], [9, -15], 2.2)][source + 1];
    drawing = blend(ready, contact, weight);
  } else {
    const authored = bladeDrawing(weapon2, source, variant, requested === "thrust");
    readyDrawing = authored.ready;
    drawing = blend(authored.ready, authored.contact, weight);
    drawing.angle += direction.correction * weight;
  }
  const carry = carryStrength(pose) / 6;
  const guarding = carry > 0 && (pose.mode === "idle" || pose.mode === "walk" || pose.mode === "attack");
  if (guarding && weapon2 !== "none" && weapon2 !== "sling") {
    const aim = actionDirection({ mode: "attack", frame: 0, aim: pose.carryAim ?? 0 });
    const guard = guardDrawing(weapon2, aim);
    const amount = carry * (pose.mode === "attack" ? pose.frame === 0 ? 0 : 1 - weight : 1);
    const rotation = carry * (pose.mode === "attack" ? pose.frame === 0 ? 0 : angleReturn ?? 1 - weight : 1);
    drawing = {
      wrist: [drawing.wrist[0] + (guard.wrist[0] - readyDrawing.wrist[0]) * amount, drawing.wrist[1] + (guard.wrist[1] - readyDrawing.wrist[1]) * amount],
      elbow: [drawing.elbow[0] + (guard.elbow[0] - readyDrawing.elbow[0]) * amount, drawing.elbow[1] + (guard.elbow[1] - readyDrawing.elbow[1]) * amount],
      angle: drawing.angle + (guard.angle - readyDrawing.angle) * rotation
    };
  }
  if (work) drawing = hand(work.wrist, [7, -22], work.tool);
  if (cast && shield2) {
    drawing.wrist = mix(drawing.wrist, [[12, -27], [16, -21], [14, -15]][source + 1], cast);
    drawing.elbow = mix(drawing.elbow, [[8, -22], [10, -20], [9, -17]][source + 1], cast);
    drawing.angle -= 0.18 * cast;
  }
  const action = Math.max(0, cast || weight);
  const lean = work?.lean ?? source * action * (shaft ? 0.075 : weapon2 === "bow" ? 0.065 : staff ? 0.045 : 0.04);
  const bodyDrop = source > 0 ? action * (shaft ? 1.2 : 0.65) : 0;
  if (shaft || weapon2 === "bow") drawing.angle -= lean;
  const freeReady = shield2 ? [-9, -10] : staff ? [-13, -12] : [-9, -8];
  const freeElbow = [-10, -15];
  const spellHands = [[12, -34], [16, -22], [14, -8]];
  const spellElbows = [[0, -25], [-3, -20], [-1, -15]];
  const gesture = shield2 ? 0 : cast || (staff ? Math.max(0, impact) * 0.55 : 0);
  let support = mix(freeReady, spellHands[source + 1], gesture);
  let supportElbow = mix(freeElbow, spellElbows[source + 1], gesture);
  const { wrist, elbow, angle: angle2 } = drawing;
  if (supported) {
    const sx = weapon2 === "bow" ? -3 - motion.bowDraw * 9 : weapon2 === "greatSword" || weapon2 === "pick" ? 0 : -9;
    const sy = weapon2 === "greatSword" ? 5 : weapon2 === "pick" ? -4 : 0;
    support = socketPoint(wrist, angle2, sx, sy);
    const readyElbow = weapon2 === "bow" ? [-0.4, -18] : shaft ? [-3, -15] : [0, -16];
    const contactElbows = weapon2 === "bow" ? [[-1, -26], [1, -18], [-1, -13]] : shaft ? [[0, -20], [-2, -16], [0, -14]] : [[-2, -24], [2, -17], [-2, -20]];
    supportElbow = mix(readyElbow, contactElbows[source + 1], weight);
    if (guarding) {
      const guardElbow = shaft ? [-4, (pose.carryAim ?? 0) > 0 ? -20 : -16] : [-2, (pose.carryAim ?? 0) < 0 ? -22 : (pose.carryAim ?? 0) > 0 ? -14 : -17];
      const amount = carry * (pose.mode === "attack" ? pose.frame === 0 ? 0 : 1 - weight : 1);
      supportElbow = [supportElbow[0] + (guardElbow[0] - readyElbow[0]) * amount, supportElbow[1] + (guardElbow[1] - readyElbow[1]) * amount];
    }
    if (cast) {
      support = mix(support, spellHands[source + 1], cast);
      supportElbow = mix(supportElbow, spellElbows[source + 1], cast);
    }
  }
  const release = socketPoint(wrist, angle2, shaft ? 48 : weapon2 === "bow" ? 16 : 0, staff ? -23 : shaft || weapon2 === "bow" ? 0 : -31);
  return {
    weapon: weapon2,
    shieldStyle: options.shieldStyle ?? "kite",
    shield: shield2,
    motion,
    impact,
    cast,
    working,
    wrist,
    angle: angle2,
    lean,
    bodyDrop,
    shoulder: [5, -23],
    elbow,
    support,
    supportShoulder: [-5, -23],
    supportElbow,
    twoHanded: supported && !cast,
    release,
    direction,
    // Independent layering: a hidden upper arm must not hide the held weapon.
    primaryLayer: shaft || weapon2 === "bow" ? "front" : "back",
    equipmentLayer: "front"
  };
}

// src/client/art/unit-appearance.ts
var DEFAULT = Object.freeze({});
var EMBER_PRIEST = Object.freeze({ appearance: Object.freeze({ ember: true }), cloth: "#a78265" });
var EMBER_SUMMONER = Object.freeze({ appearance: Object.freeze({ ember: true }), cloth: "#704b3e" });
var EMBER_REMAINS = Object.freeze({ robe: true, cloth: "#928174" });
var DEFAULT_REMAINS = Object.freeze({});
var DETAIL_IDS = /* @__PURE__ */ new WeakMap();
var nextDetailId = 1;
function appearanceKey(presentation = DEFAULT) {
  const appearance = presentation.appearance;
  let detail = 0;
  if (presentation.detail) {
    detail = DETAIL_IDS.get(presentation.detail) ?? nextDetailId++;
    DETAIL_IDS.set(presentation.detail, detail);
  }
  return `${presentation.weapon ?? ""}:${presentation.shieldStyle ?? ""}:${presentation.shield === void 0 ? "" : Number(presentation.shield)}:${presentation.motion ?? ""}:${presentation.cloth ?? ""}:${presentation.headwear ?? ""}:${appearance?.role ?? ""}:${appearance?.weapon ?? ""}:${appearance?.armor ?? ""}:${appearance?.elite ?? ""}:${appearance?.mounted ?? ""}:${appearance?.ember ?? ""}:${detail}`;
}

// src/client/art/kit.ts
var INK = "#293c35";
function polygon(c, points, fill, stroke2 = INK, width = 1.4) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (width) {
    c.strokeStyle = stroke2;
    c.lineWidth = width;
    c.stroke();
  }
}
function ellipse(c, x, y, rx, ry, fill, stroke2) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (stroke2) {
    c.strokeStyle = stroke2;
    c.lineWidth = 1.2;
    c.stroke();
  }
}
function line(c, points, color = INK, width = 1.4) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function mix2(hex, target, amount) {
  if (!/^#[0-9a-f]{6}/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const channel = (shift) => Math.round((n >> shift & 255) * (1 - amount) + target * amount);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
var darker = (hex, amount = 0.3) => mix2(hex, 0, amount);
var lighter = (hex, amount = 0.35) => mix2(hex, 255, amount);

// src/client/art/environment.ts
function paintTree(c, x, y, size, tone = 0) {
  tree(c, x, y, size, tone);
}
function tree(c, x, y, size, tone = 0) {
  c.save();
  c.translate(x, y);
  c.scale(size, size);
  const shade = tone % 3;
  const dark = ["#394940", "#424d40", "#3b4947"][shade < 0 ? 0 : shade];
  polygon(c, [[-8, 3], [6, -2], [23, 7], [12, 10]], "#29372d20", "transparent", 0);
  line(c, [[0, 5], [-1, -53]], "#625a44", 2.7);
  line(c, [[-1, 3], [-1, -47]], "#a19068", 0.65);
  for (let tier = 5; tier >= 0; tier--) {
    const y2 = -59 + tier * 9, span = 3 + tier * 4.6;
    const sway = Math.sin(tone * 2.1 + tier) * 1.5;
    polygon(c, [[sway, y2 - 10], [-span * 0.38, y2 - 1], [-span * 0.75, y2 + 1], [-span * 0.55, y2 + 2], [-span, y2 + 5], [-span * 0.62, y2 + 5], [-span * 0.91, y2 + 8], [-span * 0.25, y2 + 6], [sway, y2 + 8], [span * 0.43, y2 + 6], [span, y2 + 7], [span * 0.75, y2 + 3], [span * 0.95, y2 + 4], [span * 0.45, y2 - 1]], dark, "#2d3b342b", 0.5);
    polygon(c, [[sway, y2 - 8], [-span * 0.33, y2], [-span * 0.62, y2 + 2], [-span * 0.44, y2 + 3], [-span * 0.82, y2 + 5], [-span * 0.27, y2 + 4], [sway + 1, y2 + 6], [sway - 1, y2]], tier % 2 ? "#6c7557" : "#77806a", "transparent", 0);
    line(c, [[-span * 0.5, y2 + 3], [-span * 0.22, y2 + 2], [sway, y2 - 2]], "#a5a27a55", 0.65);
    line(c, [[span * 0.25, y2 + 3], [span * 0.68, y2 + 5]], "#88907855", 0.6);
  }
  c.restore();
}
function paintLandmark(c, landmark, point) {
  c.save();
  c.translate(point.x, point.y);
  c.lineCap = c.lineJoin = "round";
  const size = landmark.size;
  if (landmark.kind === "grove") {
    ellipse(c, 0, 0, size * 0.46, size * 0.26, "#78966b14");
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4 + landmark.rotation;
      const r = Math.sqrt((i + 1) / 11);
      tree(c, Math.cos(a) * size * 0.32 * r, -size * 0.17 + i * size * 0.032, 0.65 + i % 3 * 0.15, i);
    }
  } else if (landmark.kind === "ridge") {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * size * 0.17;
      const y = Math.sin(i * 2.7) * 15;
      polygon(c, [[x - 28, y + 13], [x - 10, y - 18], [x + 7, y - 27], [x + 32, y + 9], [x + 10, y + 20]], "#a5ad91", "#88967d", 1);
      polygon(c, [[x - 28, y + 13], [x + 7, y - 27], [x + 1, y + 9]], "#c7c9ab", "transparent", 0);
      line(c, [[x + 7, y - 24], [x + 12, y - 4], [x + 26, y + 8]], "#7e8f78", 1);
    }
  } else if (landmark.kind === "ruin") {
    ellipse(c, 0, 9, size * 0.3, size * 0.13, "#7a8b6820");
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 20, y = i % 2 * 18, h = 16 + i % 3 * 9;
      polygon(c, [[x, y], [x, y - h], [x + 11, y - h - 4], [x + 19, y - h], [x + 19, y], [x + 10, y + 5]], "#b3b69a", "#7f8c74");
      polygon(c, [[x, y - h], [x + 10, y - h + 4], [x + 10, y + 5], [x, y]], "#d4d0b0", "#8f9c7f", 0.5);
    }
  } else if (landmark.kind === "road" || landmark.kind === "ditch") {
    c.rotate(landmark.rotation);
    const river = landmark.kind === "ditch";
    c.beginPath();
    c.moveTo(-size / 2, 0);
    if (landmark.straight) c.lineTo(size / 2, 0);
    else c.bezierCurveTo(-size / 4, river ? 42 : -20, size / 4, river ? -42 : -20, size / 2, 0);
    c.lineWidth = river ? 17 : 13;
    c.strokeStyle = river ? "#799c912c" : "#ac99772a";
    c.stroke();
    c.lineWidth = river ? 9 : 7;
    c.strokeStyle = river ? "#7caca169" : "#d0be9970";
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = river ? "#e0e4c9a6" : "#a7967433";
    c.stroke();
  } else if (landmark.kind === "mineScar") {
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * 14;
      polygon(c, [[x, 8], [x + 5, -8 - i % 3 * 5], [x + 12, 5]], "#c3b78c", "#a79f7d", 0.7);
    }
  } else if (isDecor(landmark.kind)) {
    drawDecor(c, landmark.kind, size, landmark.rotation);
  } else {
    ellipse(c, 0, 0, size * 0.26, size * 0.12, "#a18b5c12", "#9d987d55");
    line(c, [[-9, 4], [0, -9], [9, 4]], "#8b8b6c66", 1);
  }
  c.restore();
}
var DECOR_KINDS = ["flowers", "bush", "stump", "log", "mushrooms", "pebbles", "bones", "reeds", "lilies", "wreck", "campfire", "signpost", "pillar"];
function isDecor(kind) {
  return DECOR_KINDS.includes(kind);
}
function drawDecor(c, kind, size, rotation) {
  const s = size;
  const spot = (i, reach) => [Math.cos(i * 2.4 + rotation) * s * reach * Math.sqrt((i + 1) / 7), Math.sin(i * 2.4 + rotation) * s * reach * 0.6 * Math.sqrt((i + 1) / 7)];
  if (kind === "flowers") {
    for (let i = 0; i < 7; i++) {
      const [x, y] = spot(i, 0.42);
      line(c, [[x, y + s * 0.06], [x, y]], "#6f8a5a", 1);
      ellipse(c, x, y, s * 0.05, s * 0.04, ["#e8a6b4", "#f2d27a", "#f4f0e2", "#c9a6e0"][i % 4], "#9a8a6a80");
    }
  } else if (kind === "bush") {
    for (let i = 0; i < 3; i++) ellipse(c, (i - 1) * s * 0.16, -Math.abs(i - 1) * s * 0.04 - s * 0.06, s * 0.17, s * 0.13, i === 1 ? "#6f8f62" : "#5f7f55", "#4c6a45");
  } else if (kind === "stump") {
    polygon(c, [[-s * 0.13, 0], [-s * 0.12, -s * 0.12], [s * 0.12, -s * 0.12], [s * 0.13, 0]], "#8a6a46", "#5e4630", 1);
    ellipse(c, 0, -s * 0.12, s * 0.12, s * 0.055, "#c9a878", "#5e4630");
    ellipse(c, 0, -s * 0.12, s * 0.05, s * 0.022, "transparent", "#8a6a4680");
  } else if (kind === "log") {
    c.rotate(rotation);
    polygon(c, [[-s * 0.32, -s * 0.06], [s * 0.3, -s * 0.07], [s * 0.3, s * 0.06], [-s * 0.32, s * 0.07]], "#8a6a46", "#5e4630", 1);
    ellipse(c, s * 0.3, 0, s * 0.045, s * 0.065, "#c9a878", "#5e4630");
    line(c, [[-s * 0.2, -s * 0.02], [s * 0.15, -s * 0.03]], "#5e463080", 1);
  } else if (kind === "mushrooms") {
    for (let i = 0; i < 4; i++) {
      const [x, y] = spot(i, 0.25);
      line(c, [[x, y], [x, y - s * 0.07]], "#efe6cf", 2);
      polygon(c, [[x - s * 0.06, y - s * 0.06], [x, y - s * 0.12], [x + s * 0.06, y - s * 0.06]], i % 2 ? "#b8573f" : "#9b7a4c", "#5e3a2a", 0.8);
    }
  } else if (kind === "pebbles") {
    for (let i = 0; i < 6; i++) {
      const [x, y] = spot(i, 0.36);
      ellipse(c, x, y, s * (0.035 + i % 3 * 0.015), s * (0.025 + i % 2 * 0.01), i % 2 ? "#b9b6a0" : "#a3a08b", "#7d7a6680");
    }
  } else if (kind === "bones") {
    c.rotate(rotation);
    for (const turn of [0.5, -0.5]) {
      const dx = Math.cos(turn) * s * 0.18;
      const dy = Math.sin(turn) * s * 0.18;
      line(c, [[-dx, -dy], [dx, dy]], "#ece5cf", 3);
      for (const end of [-1, 1]) ellipse(c, end * dx, end * dy, s * 0.03, s * 0.03, "#ece5cf", "#a49c84");
    }
  } else if (kind === "reeds") {
    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * s * 0.06 + Math.sin(i * 3.1) * s * 0.02;
      const h = s * (0.18 + i % 3 * 0.06);
      line(c, [[x, 0], [x + Math.sin(i + rotation) * s * 0.03, -h]], "#6f8a5a", 1.2);
      if (i % 3 === 0) ellipse(c, x + Math.sin(i + rotation) * s * 0.03, -h, s * 0.015, s * 0.04, "#7a5a3a");
    }
  } else if (kind === "lilies") {
    for (let i = 0; i < 4; i++) {
      const [x, y] = spot(i, 0.35);
      polygon(c, [[x, y], [x + s * 0.07, y - s * 0.02], [x + s * 0.05, y + s * 0.04], [x - s * 0.05, y + s * 0.04], [x - s * 0.07, y - s * 0.02]], "#7fa36a", "#5f7f55", 0.6);
    }
    ellipse(c, 0, -s * 0.01, s * 0.03, s * 0.025, "#f0b8c8", "#c08a9a");
  } else if (kind === "wreck") {
    c.rotate(rotation);
    polygon(c, [[-s * 0.32, -s * 0.02], [-s * 0.18, s * 0.09], [s * 0.24, s * 0.08], [s * 0.34, -s * 0.05], [s * 0.1, -s * 0.02], [-s * 0.05, -s * 0.09]], "#7d5c3c", "#4f3a26", 1);
    for (const x of [-0.15, 0, 0.15]) line(c, [[x * s, -s * 0.06], [x * s + s * 0.02, s * 0.07]], "#4f3a2690", 1);
    line(c, [[s * 0.02, -s * 0.04], [-s * 0.08, -s * 0.3]], "#5e4630", 2);
  } else if (kind === "campfire") {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      ellipse(c, Math.cos(a) * s * 0.1, Math.sin(a) * s * 0.06, s * 0.03, s * 0.022, "#a3a08b", "#6f6c5a");
    }
    polygon(c, [[-s * 0.05, 0], [-s * 0.02, -s * 0.12], [0, -s * 0.06], [s * 0.025, -s * 0.15], [s * 0.05, 0]], "#e8873a", "#b4562a", 0.8);
    polygon(c, [[-s * 0.02, 0], [0, -s * 0.07], [s * 0.02, 0]], "#f6d36a", "transparent", 0);
  } else if (kind === "signpost") {
    line(c, [[0, 0], [0, -s * 0.32]], "#6e5236", 2.4);
    polygon(c, [[0, -s * 0.3], [s * 0.2, -s * 0.3], [s * 0.25, -s * 0.26], [s * 0.2, -s * 0.22], [0, -s * 0.22]], "#b88e5c", "#6e5236", 1);
    polygon(c, [[0, -s * 0.18], [-s * 0.18, -s * 0.18], [-s * 0.23, -s * 0.14], [-s * 0.18, -s * 0.1], [0, -s * 0.1]], "#a87e4e", "#6e5236", 1);
  } else {
    const broken = Math.sin(rotation * 7) > 0;
    const top = broken ? -s * 0.24 : -s * 0.38;
    ellipse(c, 0, 0, s * 0.11, s * 0.04, "#7a8b6830");
    polygon(c, [[-s * 0.07, 0], [-s * 0.07, top], [s * 0.07, broken ? top + s * 0.04 : top], [s * 0.07, 0]], "#c9c7ac", "#8a8d74", 1);
    if (!broken) polygon(c, [[-s * 0.1, top], [-s * 0.1, top - s * 0.04], [s * 0.1, top - s * 0.04], [s * 0.1, top]], "#d8d5ba", "#8a8d74", 1);
    line(c, [[-s * 0.02, -s * 0.03], [-s * 0.02, top + s * 0.03]], "#8a8d7470", 1);
  }
}
function paintMine(b) {
  ellipse(b, 4, 22, 42, 12, "#38302920");
  ellipse(b, 1, 22, 32, 7, "#38302935");
  const rock = (p, color) => {
    polygon(b, p, color, "#55554d", 0.65);
    line(b, p.slice(0, 3), "#c5bfab", 0.75);
  };
  rock([[-40, 16], [-34, -5], [-21, -23], [-7, -19], [0, 7], [-14, 25]], "#8f9083");
  rock([[-25, -7], [-16, -31], [4, -36], [16, -20], [7, 7]], "#a3a293");
  rock([[4, -27], [21, -34], [38, -12], [42, 17], [24, 25], [12, 7]], "#85897f");
  rock([[21, -34], [35, -22], [38, -12], [21, -16]], "#b9b4a0");
  polygon(b, [[-13, 22], [-12, -8], [0, -15], [14, -8], [16, 22]], "#242825", "#57564a", 0.8);
  for (const x of [-15, 15]) {
    line(b, [[x, 23], [x, -10]], "#554735", 5);
    line(b, [[x - 1, 21], [x - 1, -10]], "#ad936c", 1.2);
  }
  line(b, [[-19, -11], [18, -11]], "#766047", 6);
  line(b, [[-19, -13], [18, -13]], "#b09a74", 1);
  line(b, [[-15, -3], [-5, -11]], "#8c7656", 2);
  line(b, [[15, -3], [5, -11]], "#8c7656", 2);
  for (let i = 0; i < 5; i++) line(b, [[-10 - i * 1.8, 22 + i * 3], [12 + i, 22 + i * 3]], "#6c5c47", 2);
  line(b, [[-4, 14], [-13, 39]], "#8d9490", 1.5);
  line(b, [[7, 14], [12, 39]], "#8d9490", 1.5);
  polygon(b, [[21, 17], [34, 17], [32, 28], [22, 28]], "#655846", "#3e3a32", 0.7);
  for (const x of [23, 30]) ellipse(b, x, 29, 2.8, 2.8, "#373a37", "#9a9787");
  for (const [x, y] of [[-29, 8], [-20, 20], [30, 15], [24, 16], [28, 16]]) rock([[x - 3, y], [x, y - 4], [x + 4, y - 1], [x + 2, y + 2]], "#bdab73");
  line(b, [[20, -10], [27, -10], [27, 1]], "#61513e", 1.3);
  polygon(b, [[24, -1], [30, -1], [30, 5], [24, 5]], "#d9b777", "#4e4536", 0.6);
}
function paintObstacle(c, obstacle, point) {
  c.save();
  c.translate(point.x, point.y);
  c.lineCap = c.lineJoin = "round";
  const r = obstacle.radius;
  const across = { x: -obstacle.along.y, y: obstacle.along.x };
  const at = (t, lift = 0) => ({ x: across.x * r * t, y: across.y * r * t - lift });
  const cracked = obstacle.hp < obstacle.maxHp / 2;
  c.save();
  c.rotate(Math.atan2(across.y, across.x));
  ellipse(c, 0, r * 0.08, r * 1.2, r * 0.5, "#35493726");
  c.restore();
  if (obstacle.kind === "rocks") {
    const stones = [[-0.98, 0.44], [-0.55, 0.58], [-0.08, 0.64], [0.4, 0.58], [0.94, 0.46], [-0.76, 0.38], [0.16, 0.42], [0.68, 0.36]];
    const placed = stones.map(([t, size], index) => ({ ...at(t), size: r * size, index, back: index >= 5 }));
    for (const stone2 of placed.sort((a, b) => Number(b.back) - Number(a.back) || a.y - b.y)) {
      const { x, size, index } = stone2;
      const y = stone2.y - (stone2.back ? size * 0.55 : 0);
      const corners = Array.from({ length: 7 }, (_, k) => {
        const angle2 = k / 7 * Math.PI * 2 + index;
        const reach = size * (0.8 + 0.2 * Math.sin(index * 3 + k * 2.1));
        return [x + Math.cos(angle2) * reach, y + Math.sin(angle2) * reach * 0.78];
      });
      polygon(c, corners, index % 2 ? "#a9ac91" : "#b9b6a0", "#6e806d", 1.2);
      polygon(c, [[x - size * 0.55, y - size * 0.1], [x - size * 0.2, y - size * 0.62], [x + size * 0.25, y - size * 0.5], [x - size * 0.05, y - size * 0.05]], "#d4d2b8", "transparent", 0);
      if (cracked && index % 3 === 0) line(c, [[x - size * 0.2, y - size * 0.5], [x, y - size * 0.1], [x - size * 0.1, y + size * 0.3]], "#55604f", 1.2);
    }
  } else {
    const high = r * 0.8;
    const ends = [at(-0.86), at(0.86)];
    polygon(c, [[ends[0].x, ends[0].y], [ends[1].x, ends[1].y], [ends[1].x, ends[1].y - high], [ends[0].x, ends[0].y - high]], "#7a5c3c", "#3f3024", 1.4);
    for (let plank = -2; plank <= 2; plank += 1) {
      if (cracked && plank === 1) continue;
      const foot = at(plank * 0.29);
      line(c, [[foot.x, foot.y], [foot.x, foot.y - high]], "#4f3a28", 1.4);
    }
    for (const lift of [high * 0.28, high * 0.72]) {
      const [from, to] = [at(-0.86, lift), at(0.86, lift)];
      line(c, [[from.x, from.y], [to.x, to.y]], "#3f3024", 2.6);
    }
    if (cracked) {
      const [from, to] = [at(0.05, high * 0.95), at(0.5, high * 0.1)];
      line(c, [[from.x, from.y], [(from.x + to.x) / 2 + r * 0.08, (from.y + to.y) / 2], [to.x, to.y]], "#24190f", 1.6);
    }
    for (const pillar of [at(-1), at(1)].sort((a, b) => a.y - b.y)) {
      const w = r * 0.2;
      const top = pillar.y - r * 1.05;
      polygon(c, [[pillar.x - w, pillar.y + 4], [pillar.x - w, top], [pillar.x + w, top], [pillar.x + w, pillar.y + 4]], "#c9c7ac", "#7d7a66", 1.2);
      polygon(c, [[pillar.x - w * 1.3, top], [pillar.x - w * 1.3, top - r * 0.12], [pillar.x + w * 1.3, top - r * 0.12], [pillar.x + w * 1.3, top]], "#d8d5ba", "#7d7a66", 1.2);
      line(c, [[pillar.x - w * 0.4, pillar.y], [pillar.x - w * 0.4, top + r * 0.1]], "#8a8d7470", 1);
      if (cracked) line(c, [[pillar.x + w * 0.5, top + r * 0.15], [pillar.x - w * 0.1, top + r * 0.45], [pillar.x + w * 0.3, top + r * 0.7]], "#55604f", 1.2);
    }
  }
  c.restore();
}
function obstacleArtTop(obstacle) {
  return obstacle.radius * (Math.abs(obstacle.along.x) + (obstacle.kind === "gate" ? 1.2 : 0.75));
}

// src/client/model-portraits.ts
var provider;
function drawModelPortrait(ctx, key, x, y, size, color) {
  const current = provider, image = current?.(key, color);
  if (!image) return false;
  current?.retain?.(image);
  try {
    ctx.drawImage(image, x, y, size, size);
    return true;
  } finally {
    current?.release?.(image);
  }
}

// canvas-route-proof:portrait-before
var FittedPortraitCache = class {
  constructor(budget = 12 * 1024 * 1024, limit = 96) {
    this.budget = budget;
    this.limit = limit;
  }
  budget;
  limit;
  cache = /* @__PURE__ */ new Map();
  work = [];
  leased = /* @__PURE__ */ new Map();
  retired = /* @__PURE__ */ new Set();
  epoch = 0;
  retire(canvas) {
    if (this.leased.has(canvas)) this.retired.add(canvas);
    else canvas.width = canvas.height = 1;
  }
  lease(canvas) {
    this.leased.set(canvas, (this.leased.get(canvas) ?? 0) + 1);
  }
  release(canvas) {
    const count = this.leased.get(canvas) ?? 0;
    if (count > 1) {
      this.leased.set(canvas, count - 1);
      return;
    }
    this.leased.delete(canvas);
    if (this.retired.delete(canvas)) this.retire(canvas);
  }
  draw(ctx, key, paint, x, y, width, height2, bust = false, domain = 128) {
    const workSize = domain * 4;
    let art = this.cache.get(key), source;
    const epoch = this.epoch;
    try {
      if (!art) {
        const reusable = this.work.findIndex((canvas) => canvas.width === workSize);
        source = reusable < 0 ? createScratchCanvas(workSize, workSize) : this.work.splice(reusable, 1)[0];
        this.lease(source);
        const brush = source.getContext("2d");
        if (typeof brush.reset === "function") brush.reset();
        else source.width = workSize;
        brush.translate(workSize / 2, workSize / 2);
        brush.scale(4, 4);
        paint(brush);
        const data = brush.getImageData(0, 0, workSize, workSize).data;
        const bounds = (limit = workSize) => {
          let left = workSize, top = workSize, right = 0, bottom = 0;
          for (let py = 0; py < limit; py++) for (let px = 0; px < workSize; px++) if (data[(py * workSize + px) * 4 + 3] > 8) {
            left = Math.min(left, px);
            right = Math.max(right, px);
            top = Math.min(top, py);
            bottom = Math.max(bottom, py);
          }
          return { x: left, y: top, width: Math.max(1, right - left + 1), height: Math.max(1, bottom - top + 1) };
        };
        let box = bounds();
        if (bust) box = bounds(Math.round(box.y + box.height * 0.65));
        const cropped = createScratchCanvas(box.width, box.height);
        this.lease(cropped);
        art = { canvas: cropped, x: 0, y: 0, width: box.width, height: box.height };
        cropped.getContext("2d").drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
        const prior = this.cache.get(key);
        if (epoch === this.epoch && prior) {
          this.cache.delete(key);
          this.retire(prior.canvas);
        }
        let pixels = [...this.cache.values()].reduce((sum, value) => sum + value.width * value.height, 0);
        const cost = box.width * box.height;
        while (epoch === this.epoch && this.cache.size && (this.cache.size >= this.limit || pixels + cost > this.budget)) {
          const oldest = this.cache.keys().next().value, value = this.cache.get(oldest);
          pixels -= value.width * value.height;
          this.cache.delete(oldest);
          this.retire(value.canvas);
        }
        if (epoch === this.epoch && cost <= this.budget && this.limit > 0) this.cache.set(key, art);
        else this.retire(cropped);
      } else this.lease(art.canvas);
      const scale = Math.min(width / art.width, height2 / art.height) * 0.94, w = art.width * scale, h = art.height * scale;
      ctx.drawImage(art.canvas, art.x, art.y, art.width, art.height, x + (width - w) / 2, y + (height2 - h) / 2, w, h);
    } finally {
      if (art) {
        if (this.cache.get(key) !== art) this.retire(art.canvas);
        this.release(art.canvas);
      }
      if (source) {
        this.release(source);
        if (epoch === this.epoch && this.work.length < 4) this.work.push(source);
        else this.retire(source);
      }
    }
  }
  clear() {
    this.epoch++;
    for (const art of this.cache.values()) this.retire(art.canvas);
    for (const canvas of this.work) this.retire(canvas);
    this.cache.clear();
    this.work.length = 0;
  }
  stats() {
    const cached = new Set([...this.cache.values()].map((art) => art.canvas));
    const owned = /* @__PURE__ */ new Set([...cached, ...this.work, ...this.leased.keys(), ...this.retired]);
    const bytes = (canvases) => {
      let n = 0;
      for (const canvas of canvases) n += canvas.width * canvas.height * 4;
      return n;
    };
    return { entries: this.cache.size, cacheBytes: bytes(cached), workCanvases: this.work.length, workBytes: bytes(this.work), leasedCanvases: this.leased.size, leasedBytes: bytes(this.leased.keys()), retiredCanvases: this.retired.size, retiredBytes: bytes(this.retired), ownedCanvasBytes: bytes(owned) };
  }
};
var portraits = new FittedPortraitCache();
var drawFittedPortrait = portraits.draw.bind(portraits);
var clearFittedPortraits = () => portraits.clear();
var fittedPortraitStats = () => portraits.stats();

// src/client/art/materials.ts
var INK2 = "#292b29";
var STEEL = "#8d9897";
var EDGE = "#d0cbbc";
var SHADE = "#525e60";
var SKIN = "#ba9575";
var HIDE = "#665342";
var BOOT = "#373631";
var LINEN = "#c9bda0";
function paintedPlane(b, p, fill, edge = INK2, w = 0.55, surface = "cloth-metal") {
  polygon(b, p, fill, edge, w);
  if (fill === "transparent") return;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of p) {
    x = Math.min(x, point[0]);
    y = Math.min(y, point[1]);
    right = Math.max(right, point[0]);
    bottom = Math.max(bottom, point[1]);
  }
  const ww = right - x, hh = bottom - y, organic = surface === "hide-stone";
  if (!organic && (ww <= 3 || hh <= 5)) return;
  b.save();
  b.clip();
  const glaze = b.createLinearGradient(x, y, right, bottom);
  glaze.addColorStop(0, organic ? "#e4d3ac26" : "#f4dfb53a");
  glaze.addColorStop(organic ? 0.45 : 0.38, organic ? "#e4d3ac00" : "#f4dfb500");
  glaze.addColorStop(1, organic ? "#1d29312d" : "#182c3a48");
  if (!organic && (fill === STEEL || fill === EDGE)) {
    glaze.addColorStop(0.16, "#fff0ce55");
    glaze.addColorStop(0.23, "#fff0ce00");
  }
  b.fillStyle = glaze;
  b.fillRect(x, y, ww, hh);
  const count = Math.min(organic ? 40 : 22, ww * hh / (organic ? 10 : 8));
  for (let tone = 0; tone < 2; tone++) {
    b.beginPath();
    for (let i = 0; i < count; i++) {
      if (Number(i % (organic ? 2 : 3) !== 0) !== tone) continue;
      const a = Math.sin(i * 12.31 + (organic ? x : x * 9.13 + y * 3.27)) * 43758.5453;
      const d = organic ? Math.sin(i * 7.7 + y) * 43758.5453 : Math.sin(i * 7.71 + y * 8.1) * 19283.11;
      const px = x + (a - Math.floor(a)) * ww, py = y + (d - Math.floor(d)) * hh;
      b.moveTo(px, py);
      b.lineTo(px + (organic ? 1 : 0.5), py + (organic ? 0.7 : 1.3));
    }
    b.strokeStyle = organic ? tone ? "#e5dac024" : "#252d2924" : tone ? "#e5d5b026" : "#232b2826";
    b.lineWidth = organic ? 0.45 : 0.4;
    b.stroke();
  }
  b.restore();
  if (organic) line(b, [p[0], p[1], p[2]], lighter(fill, 0.25), 0.8);
}
var segment = (b, a, z, width, color, lit) => {
  line(b, [a, z], INK2, width + 1.1);
  line(b, [a, z], color, width);
  if (lit) line(b, [[a[0] - 0.65, a[1]], [z[0] - 0.65, z[1] - 0.7]], lighter(color, 0.22), Math.max(0.55, width * 0.22));
};
var ITEM_MATERIAL = Object.freeze({ ink: "#303738", paper: "#d9c9a7", gold: "#b7a274", steel: "#a8b3ad", leather: "#80644c" });
var REMAINS_MATERIAL = Object.freeze({ ink: "#555247", wash: "#929082", light: "#aaa594", dark: "#6b6c60" });

// src/client/art/creature-poses.ts
var curves = {
  stone: [1, 0.9, 0.55, 0.2, 0.04, 0],
  wood: [1, 0.8, 0.4, 0.1, -0.04, 0],
  ogre: [1, 0.62, 0.12, -0.16, -0.07, 0],
  hound: [1, 0.55, 0.18, -0.1, -0.04, 0],
  stag: [1, 0.7, 0.3, -0.12, -0.05, 0],
  dragon: [1, 0.82, 0.45, 0.12, 0.02, 0],
  fish: [1, 0.65, 0.32, 0.1, 0.03, 0],
  spider: [1, 0.68, 0.2, -0.06, -0.02, 0],
  turtle: [1, 0.72, 0.28, 0.05, -0.03, 0],
  spirit: [1, 0.8, 0.48, 0.2, 0.06, 0]
};
var mix3 = (a, z, t) => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t];
function creatureDrawing(shape, weapon2, frame) {
  const motion = sampleMotion(frame, "creature"), aim = actionDirection(frame);
  const variant = Math.abs(Math.trunc(frame.variant ?? 0)) % 3;
  const strike = frame.mode === "attack" ? (curves[shape][frame.frame] ?? 0) * [1, 0.88, 0.96][variant] : 0;
  const casting = frame.mode === "cast" ? motion.castGlow : 0, action = Math.max(0, strike, casting);
  const dx = Math.cos(aim.angle) * action, dy = Math.sin(aim.angle) * action;
  const staff = weapon2 === "staff";
  const ready = shape === "fish" ? [22, -5] : [24, -2];
  const contact = (shape === "fish" ? [[18, -28], [31, -15], [29, 3]] : shape === "stone" || shape === "wood" ? [[25, -34], [36, -16], [29, 9]] : [[24, -30], [34, -16], [30, 2]])[aim.source + 1];
  let hand3 = staff ? mix3(ready, [26, -12], casting || Math.max(0, strike) * 0.5) : mix3(ready, contact, strike);
  const readyElbow = shape === "fish" ? [14, -8] : [23, -14];
  let elbow = mix3(readyElbow, (shape === "fish" ? [[12, -18], [18, -12], [17, -6]] : [[20, -26], [24, -19], [24, -8]])[aim.source + 1], staff ? casting * 0.4 : strike);
  const free = mix3(shape === "fish" ? [-12, 0] : [-25, -1], [[0, -33], [15, -18], [7, 2]][aim.source + 1], casting);
  let angle2 = staff ? 0.04 + casting * 0.06 : weapon2 === "javelin" ? 0.45 + (aim.angle + 1.2 - 0.45) * strike : 0.18 + (aim.angle + 1.4 - 0.18) * strike;
  const carry = carryStrength(frame) / 6;
  if (weapon2 && carry && (frame.mode === "idle" || frame.mode === "walk" || frame.mode === "attack")) {
    const direction = actionDirection({ mode: "attack", frame: 0, aim: frame.carryAim ?? 0 });
    const amount = carry * (frame.mode === "attack" ? frame.frame === 0 ? 0 : 1 - strike : 1);
    const guard = (staff ? [[23, -6], [24, -4], [24, -2]] : shape === "fish" ? [[14, -8], [19, -10], [19, -13]] : [[22, -10], [23, -6], [22, -14]])[direction.source + 1];
    const guardElbow = shape === "fish" ? [13, -10] : [20, -15];
    hand3 = [hand3[0] + (guard[0] - ready[0]) * amount, hand3[1] + (guard[1] - ready[1]) * amount];
    elbow = [elbow[0] + (guardElbow[0] - readyElbow[0]) * amount, elbow[1] + (guardElbow[1] - readyElbow[1]) * amount];
    const guardAngle = staff ? 0.04 : weapon2 === "pike" ? direction.angle + Math.PI / 2 : [-0.2, 0.35, 0.85][direction.source + 1] + direction.correction * 0.5;
    angle2 += (guardAngle - (staff ? 0.04 : weapon2 === "javelin" ? 0.45 : 0.18)) * amount;
  }
  const headX = (shape === "stag" ? 25 : shape === "turtle" ? 27 : shape === "dragon" ? 35 : 27) + dx * (shape === "turtle" ? 12 : 6) + strike * 2;
  const headY = (shape === "stag" ? -39 : shape === "turtle" ? -8 : shape === "dragon" ? -24 : -18) + dy * 11 + strike * (shape === "stag" ? 9 : 2);
  const mouth = [headX + (shape === "stag" ? 12 : 14), headY + 4];
  const bob = motion.breathe * (shape === "spirit" ? 1.8 : shape === "stone" ? 0.35 : 0.6);
  let release = mouth;
  if (shape === "ogre" || shape === "fish") release = weapon2 === "javelin" ? hand3 : socketPoint(hand3, angle2, 0, staff ? -25 : weapon2 === "pike" ? -32 : -34);
  else if (shape === "stone" || shape === "wood") release = casting ? free : hand3;
  else if (shape === "spider") release = [23 + dx * 7, 3 + dy * 9];
  else if (shape === "spirit") release = [12 + dx * 12, -26 + dy * 16];
  return { motion, strike, casting, action, dx, dy, hand: hand3, elbow, free, angle: angle2, headX, headY, mouth, bob, release, walk: motion.stride, stepLift: frame.mode === "walk" ? Math.cos(frame.frame * Math.PI / 4) : 0, variant, aim };
}

// src/client/art/body-parts.ts
function hand2(b, p) {
  paintedPlane(b, [[p[0] - 1.5, p[1] - 1.5], [p[0] + 1, p[1] - 1.7], [p[0] + 1.7, p[1] + 1], [p[0] - 0.6, p[1] + 2]], SKIN);
}
function arm(b, shoulder, elbow, wrist, color, armor, lit) {
  segment(b, shoulder, elbow, 4.1, color, lit);
  segment(b, elbow, wrist, 3.1, armor ? STEEL : color, lit);
  hand2(b, wrist);
}
function boot(b, x, y) {
  paintedPlane(b, [[x - 2, y - 4], [x + 1.4, y - 4], [x + 2.1, y - 1], [x + 4, y], [x + 3.5, y + 1.1], [x - 2.5, y + 0.8]], BOOT);
  line(b, [[x - 1.7, y - 2], [x + 1, y - 1.6]], "#777164", 0.65);
}
function leg(b, hip, knee, foot, armor, lit) {
  segment(b, hip, knee, 4.9, armor ? SHADE : "#60584a", lit);
  segment(b, knee, [foot[0], foot[1] - 3], 3.7, armor ? STEEL : BOOT, lit);
  if (armor) ellipse(b, knee[0], knee[1], 2.4, 2, lit ? EDGE : STEEL);
  boot(b, foot[0], foot[1]);
}

// src/client/art/equipment.ts
function shield(b, x, y, team, elite, facing, round = false) {
  if (round) {
    ellipse(b, x, y, 9, 11, ITEM_MATERIAL.leather, ITEM_MATERIAL.steel);
    line(b, [[x - 6, y - 7], [x - 6, y + 6]], "#a18b68", 1);
    line(b, [[x + 3, y - 8], [x + 3, y + 8]], "#443b32", 0.8);
    ellipse(b, x, y, 3, 3.5, ITEM_MATERIAL.steel, INK2);
    line(b, [[x - 7, y - 5], [x + 7, y - 5]], EDGE, 0.8);
    return;
  }
  const w = elite ? 8 : 7, h = elite ? 15 : 12;
  const points = [[x - w, y - h], [x + 2, y - h - 1], [x + w, y - h + 2], [x + w - 1, y + 5], [x, y + h], [x - w, y + 4]];
  paintedPlane(b, points, "#aaa58f", INK2, 0.85);
  paintedPlane(b, points.map(([a, z]) => [x + (a - x) * 0.83, y + (z - y) * 0.88]), darker(team, 0.18));
  paintedPlane(b, [[x, y - h + 1], [x + w - 1, y - h + 3], [x + w - 2, y + 5], [x, y + h - 2]], facing === 1 ? darker(team, 0.4) : lighter(team, 0.1), "transparent", 0);
  line(b, [[x - 3, y - h + 3], [x - 3, y + 5]], "#d7c6a0", 1.25);
  line(b, [[x - w + 2, y - h + 3], [x - w + 2, y + 3], [x, y + h - 2]], "#c5bba2", 0.7);
  ellipse(b, x, y - 2, 2.2, 2.5, "#b4aa8c", INK2);
  for (const z of [-6, 3]) line(b, [[x + 2, z + y], [x + 4, z + y - 1]], "#8a9890", 0.65);
}
function sword(b, wrist, angle2, axe, great = false) {
  b.save();
  b.translate(...wrist);
  b.rotate(angle2);
  if (great) b.scale(1.15, 1.15);
  segment(b, [0, great ? 8 : 3], [0, -4], 2.2, HIDE, false);
  if (axe) {
    segment(b, [0, 3], [0, -26], 2.3, "#8b7454", true);
    paintedPlane(b, [[-1, -25], [6, -29], [12, -27], [13, -18], [6, -16], [2, -20]], STEEL);
    line(b, [[11, -27], [12, -19], [7, -17]], EDGE, 1.25);
  } else {
    paintedPlane(b, [[-2, -5], [-2, -25], [0, -31], [2, -25], [2, -5]], STEEL);
    paintedPlane(b, [[0, -29], [0, -5], [2, -5], [2, -25]], SHADE, "transparent", 0);
    line(b, [[-1.8, -23], [-1.8, -6]], EDGE, 0.8);
    line(b, [[-5, -4], [5, -4]], "#a4997d", 1.6);
  }
  b.restore();
}
function paintEquipment(b, f, team, facing, rig, cloth, layer = "front") {
  const { wrist } = rig, armor = !!f.armor;
  if (layer === "back" && rig.weapon === "bow") {
    paintedPlane(b, [[-11, -26], [-7, -27], [-4, -12], [-8, -11]], HIDE);
    for (const x of [-10, -8]) line(b, [[x, -25], [x - 2, -34]], "#c8bba0", 0.8);
  }
  if (layer === rig.primaryLayer) {
    arm(b, rig.shoulder, rig.elbow, wrist, cloth, armor, layer === "front");
  }
  if (layer === rig.equipmentLayer) {
    paintEquipmentAsset(b, f, rig);
    hand2(b, wrist);
  }
  if (layer === "front") {
    arm(b, rig.supportShoulder, rig.supportElbow, rig.support, cloth, armor, true);
    if (rig.shield) shield(b, rig.support[0], rig.support[1], team, !!f.elite, facing, rig.shieldStyle === "round");
    else hand2(b, rig.support);
    if (rig.weapon === "pick") paintedPlane(b, [[-6, -9], [-1, -9], [-1, -3], [-7, -2]], HIDE);
  }
}
function paintEquipmentAsset(b, f, rig) {
  const { wrist, impact, cast } = rig;
  if (rig.weapon === "bow") {
    const pull = rig.motion.bowDraw;
    b.save();
    b.translate(...wrist);
    b.rotate(rig.angle);
    b.beginPath();
    b.moveTo(0, -18);
    b.bezierCurveTo(12, -10, 11, 11, 0, 18);
    b.strokeStyle = "#463d31";
    b.lineWidth = 2.1;
    b.stroke();
    b.beginPath();
    b.moveTo(0, -17);
    b.bezierCurveTo(10, -8, 10, 10, 0, 17);
    b.strokeStyle = "#b7a078";
    b.lineWidth = 0.8;
    b.stroke();
    line(b, [[0, -18], [-3 - pull * 9, 0], [0, 18]], "#c8c0a8", 0.6);
    if (rig.motion.recoil < 0.5) {
      line(b, [[-12, 0], [12, 0]], "#b9ae91", 0.8);
      paintedPlane(b, [[12, -2], [16, 0], [12, 2]], EDGE);
    }
    b.restore();
  } else if (rig.weapon === "staff" || rig.weapon === "crozier") {
    b.save();
    b.translate(...wrist);
    b.rotate(rig.angle);
    const top = [0, -23];
    segment(b, [0, 26], top, 1.8, "#897151", true);
    if (rig.weapon === "crozier") {
      line(b, [[-4, -19], [4, -19]], "#c0ac79", 1.5);
      paintedPlane(b, [[0, -26], [2.5, -22], [0, -18], [-2.5, -22]], "#ded0a0");
    } else {
      ellipse(b, 0, -23, 4, 5, "#333b3b", "#a99873");
      ellipse(b, -0.5, -24, 2, 3, f.ember ? "#cf8b4f" : "#a1beb5");
    }
    if (cast) {
      b.save();
      b.globalAlpha *= cast * 0.65;
      ellipse(b, ...top, 6 + cast * 4, 7 + cast * 4, f.ember ? "#e9a85435" : "#c0d6bf35");
      line(b, [[-6, -23], [6, -23]], "#ede4bf", 0.8);
      line(b, [[0, -31], [0, -15]], "#ede4bf", 0.8);
      b.restore();
    }
    b.restore();
  } else if (rig.weapon === "pike" || rig.weapon === "pitchfork") {
    b.save();
    b.translate(...wrist);
    b.rotate(rig.angle);
    segment(b, [-23, 0], [40, 0], f.mounted ? 2.2 : 1.8, "#877052", true);
    if (rig.weapon === "pitchfork") {
      line(b, [[36, -5], [36, 5]], STEEL, 1.6);
      for (const y of [-5, 0, 5]) line(b, [[36, y], [45, y]], EDGE, 1.4);
    } else {
      paintedPlane(b, [[39, -2], [48, 0], [39, 2], [36, 0]], STEEL);
      line(b, [[39, -1.5], [47, 0]], EDGE, 0.7);
    }
    line(b, [[-3, 0], [2, 0]], HIDE, 3);
    if (f.mounted) paintedPlane(b, [[3, -3.5], [5, -2], [5, 2], [3, 3.5]], "#a49d88");
    b.restore();
  } else if (rig.weapon === "pick") {
    b.save();
    b.translate(...wrist);
    b.rotate(rig.angle);
    segment(b, [0, 7], [0, -22], 1.9, "#9a8058", true);
    paintedPlane(b, [[-9, -18], [-4, -23], [3, -23], [10, -18], [3, -20], [-3, -20]], STEEL);
    b.restore();
  } else if (rig.weapon === "sling") {
    b.save();
    b.translate(...wrist);
    b.rotate(rig.angle);
    line(b, [[-1, 0], [-2, 17], [2, 17], [1, 0]], "#9d8d6b", 0.85);
    paintedPlane(b, [[-2, 16], [2, 16], [3, 20], [-3, 20]], HIDE);
    if (impact < 0.7) ellipse(b, 0, 17.5, 1.6, 1.4, "#a5a593");
    b.restore();
  } else if (rig.weapon === "javelin") {
    if (impact < 0.7) paintRigidEquipment(b, "javelin", wrist, rig.angle);
  } else if (rig.weapon === "club") paintRigidEquipment(b, "club", wrist, rig.angle);
  else if (rig.weapon !== "none") sword(b, wrist, rig.angle, rig.weapon === "axe", rig.weapon === "greatSword");
}
function paintRigidEquipment(b, weapon2, grip, angle2, cast = 0) {
  b.save();
  b.translate(...grip);
  b.rotate(angle2);
  if (weapon2 === "club") {
    segment(b, [0, 5], [0, -31], 2.8, "#706149", true);
    paintedPlane(b, [[-5, -29], [-3, -38], [5, -37], [7, -26], [2, -22], [-4, -24]], "#697170");
    line(b, [[-3, -35], [-3, -27]], EDGE, 0.9);
  } else if (weapon2 === "pike" || weapon2 === "javelin") {
    const top = weapon2 === "javelin" ? -16 : -22;
    segment(b, [0, weapon2 === "javelin" ? 14 : 25], [0, top], 1.8, "#958572", true);
    paintedPlane(b, [[-3, top], [0, top - 10], [3, top]], STEEL);
    line(b, [[-1, top - 1], [0, top - 8]], EDGE, 0.7);
  } else {
    segment(b, [0, 25], [0, -24], 2, "#897151", true);
    ellipse(b, 0, -25, 4, 5, "#394b50", "#a99873");
    ellipse(b, -1, -26, 1.5, 2.5, "#b8c7b5");
    if (cast) {
      b.globalAlpha *= cast;
      ellipse(b, 0, -25, 9, 10, "#dae3bd55");
    }
  }
  line(b, [[0, -2], [0, 2]], HIDE, 3);
  b.restore();
}

// src/client/art/creature-painters.ts
var INK3 = "#343730";
var BONE = "#c1b49a";
function mass(b, points, color, edge = INK3) {
  b.beginPath();
  points.forEach((p, i) => {
    if (!i) b.moveTo(p[0], p[1]);
    else if (p.length === 6) b.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
    else b.lineTo(p[0], p[1]);
  });
  b.closePath();
  b.fillStyle = color;
  b.fill();
  b.save();
  b.clip();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) for (let i = 0; i < p.length; i += 2) {
    left = Math.min(left, p[i]);
    right = Math.max(right, p[i]);
    top = Math.min(top, p[i + 1]);
    bottom = Math.max(bottom, p[i + 1]);
  }
  const wash = b.createLinearGradient(left, top, right, bottom);
  wash.addColorStop(0, "#eedbb538");
  wash.addColorStop(0.46, "#d0c8aa00");
  wash.addColorStop(1, "#182b3544");
  b.fillStyle = wash;
  b.fillRect(left, top, right - left, bottom - top);
  const count = Math.min(18, Math.floor((right - left) * (bottom - top) / 22));
  for (let tone = 0; tone < 2; tone++) {
    b.beginPath();
    for (let i = tone; i < count; i += 2) {
      const a = Math.sin(i * 13.7 + left * 3.1 + top) * 4721.31, d = Math.sin(i * 9.3 + top * 4.7) * 6931.7;
      const x = left + (a - Math.floor(a)) * (right - left), y = top + (d - Math.floor(d)) * (bottom - top);
      b.moveTo(x, y);
      b.lineTo(x + 0.45, y + 1.2);
    }
    b.strokeStyle = tone ? "#e2d1ad35" : "#30372e32";
    b.lineWidth = 0.45;
    b.stroke();
  }
  b.restore();
  b.beginPath();
  points.forEach((p, i) => {
    if (!i) b.moveTo(p[0], p[1]);
    else if (p.length === 6) b.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
    else b.lineTo(p[0], p[1]);
  });
  b.closePath();
  b.strokeStyle = edge;
  b.lineWidth = 0.55;
  b.stroke();
}
function stroke(b, p, color, width = 0.8) {
  b.beginPath();
  p.forEach((q, i) => {
    if (!i) b.moveTo(q[0], q[1]);
    else if (q.length === 6) b.bezierCurveTo(q[0], q[1], q[2], q[3], q[4], q[5]);
    else b.lineTo(q[0], q[1]);
  });
  b.strokeStyle = color;
  b.lineWidth = width;
  b.stroke();
}
function flesh(b, a, k, z, width, color) {
  const dx = z[0] - a[0], dy = z[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  const at = (p, w) => [p[0] + nx * w, p[1] + ny * w];
  const a1 = at(a, width * 0.56), a2 = at(a, -width * 0.56), k1 = at(k, width * 0.48), k2 = at(k, -width * 0.48), z1 = at(z, width * 0.3), z2 = at(z, -width * 0.3);
  mass(b, [a1, [k1[0], k1[1], k1[0], k1[1], ...z1], z2, [k2[0], k2[1], k2[0], k2[1], ...a2]], color);
  stroke(b, [at(a, width * 0.26), [k1[0], k1[1], k[0], k[1], ...at(z, width * 0.12)]], lighter(color, 0.16), 0.7);
}
function stone(b, x, y, w, h, color, cut = 0) {
  const uneven = Math.sin(x * 1.7 + y * 0.9) * 0.09;
  mass(b, [[x - w * 0.4, y - h * (0.4 + uneven)], [x - w * 0.14, y - h * 0.52], [x + w * 0.2, y - h * 0.43], [x + w * 0.48, y - h * 0.12], [x + w * 0.37, y + h * (0.35 - uneven)], [x - w * 0.03, y + h * 0.46], [x - w * 0.43, y + h * 0.25], [x - w * 0.5, y - h * 0.04]], color);
  line(b, [[x - w * 0.14, y - h * 0.42], [x - w * 0.05, y - h * 0.13], [x + w * 0.13, y + h * 0.05], [x + w * 0.02, y + h * 0.27]], darker(color, 0.23), 0.65);
  line(b, [[x - w * 0.4, y - h * 0.42], [x + w * 0.12, y - h * 0.55], [x + w * 0.35, y - h * 0.3]], lighter(color, 0.28), 0.8);
  if (cut) line(b, [[x - 2, y - h * 0.28], [x + 1, y], [x - 2, y + h * 0.22]], "#b6ad8970", 0.65);
}
function fist(b, p, color) {
  mass(b, [[p[0] - 4, p[1] - 3], [p[0] + 2, p[1] - 4], [p[0] + 5, p[1] - 1], [p[0] + 4, p[1] + 4], [p[0] - 2, p[1] + 4], [p[0] - 5, p[1] + 1]], color);
  for (const x of [-1, 1.5]) line(b, [[p[0] + x, p[1]], [p[0] + x + 1, p[1] + 2.5]], darker(color, 0.3), 0.65);
}
function stoneBody(b, l, p) {
  const c = l.color, granite = l.kind === "graniteGolem", rubble = l.kind === "rubbleGolem";
  for (const side of [-1, 1]) {
    const x = side * 11, s = p.walk * side * 3, lift = Math.max(0, p.stepLift * side) * 3;
    stone(b, x, 7, 13, 19, darker(c, 0.12));
    stone(b, x + s, 19 - lift, 17, 9, c);
  }
  b.translate(0, p.bob);
  const far = p.casting ? p.free : [-26 + p.strike * 3, -1 + p.dy * 4];
  flesh(b, [-16, -24], [-23, -14], far, 11, darker(c, 0.24));
  stone(b, -22, -14, 13, 18, darker(c, 0.12));
  stone(b, ...far, 13, 11, c);
  flesh(b, [16, -23], p.elbow, p.hand, 12, darker(c, 0.3));
  stone(b, p.elbow[0], p.elbow[1], 13, 17, c);
  stone(b, ...p.hand, 16, 13, c);
  mass(b, [[-18, -27], [-7, -36], [12, -33], [20, -22], [15, -6], [8, 2], [-13, 0], [-21, -14]], c);
  stone(b, -9, -20, 22, 22, lighter(c, 0.08), 1);
  stone(b, 9, -20, 19, 25, darker(c, 0.05), 1);
  stone(b, 0, -4, 22, 12, darker(c, 0.13));
  stone(b, -18, -28, rubble ? 17 : 24, granite ? 18 : 20, c, 1);
  stone(b, 17, -27, 21, 18, c);
  mass(b, [[-10, -42], [3, -46], [11, -38], [8, -28], [-7, -28], [-12, -35]], c);
  mass(b, [[3, -44], [11, -38], [8, -28], [2, -29]], darker(c, 0.2));
  line(b, [[-7, -40], [2, -43], [7, -38]], lighter(c, 0.26), 0.85);
  line(b, [[-3, -35], [7, -35]], "#303a34", 1.6);
  line(b, [[-2, -34], [6, -34]], "#b9b08b", 0.55);
  if (l.kind === "golem") {
    line(b, [[-4, -24], [1, -27], [5, -23], [0, -17], [-4, -21], [3, -21]], "#b2a580", 1);
    line(b, [[-2, -18], [1, -13]], "#b2a580", 0.7);
  }
  if (granite) {
    for (const [x, y] of [[-20, -29], [15, -28], [-9, -18], [8, -8]]) line(b, [[x - 3, y - 4], [x, y], [x + 5, y + 2]], "#a9b1a2", 0.85);
  } else for (const [x, y] of [[-17, -30], [-10, -9], [12, -23], [6, 2]]) {
    mass(b, [[x - 4, y], [x - 1, y - 2], [x + 4, y], [x + 1, y + 3]], "#677359");
    line(b, [[x - 2, y], [x + 2, y + 1]], "#99a076", 0.55);
  }
  if (rubble) for (const [x, y] of [[-22, -31], [17, -26], [-11, 3]]) stone(b, x, y, 8, 6, lighter(c, 0.1));
}
function woodBody(b, l, p) {
  const c = l.color;
  for (const side of [-1, 1]) {
    const x = side * 11 + p.walk * side * 2;
    b.save();
    b.translate(0, -Math.max(0, p.stepLift * side) * 3);
    mass(b, [[side * 7, -4], [x - 5, 9], [x - 9, 20], [x - 5, 23], [x + 1, 18], [x + 7, 22], [x + 10, 20], [x + 3, 9], [side * 12, -5]], darker(c, 0.1));
    line(b, [[side * 9, 0], [x, 13], [x - 3, 20]], "#b09c76", 0.8);
    b.restore();
  }
  b.translate(0, p.bob);
  const far = p.casting ? p.free : [-28 + p.strike * 5, 5];
  flesh(b, [-15, -24], [-26, -11], far, 10, darker(c, 0.2));
  flesh(b, [16, -26], p.elbow, p.hand, 10, c);
  for (const [x, y] of [p.hand, far]) for (const i of [-1, 0, 1]) stroke(b, [[x + i * 2, y], [x + i * 4, y + 5], [x + i * 5, y + 8]], "#66563e", 2);
  mass(b, [[-15, 2], [-20, -15], [-16, -32], [-7, -42], [7, -41], [17, -30], [15, -10], [20, 0], [7, 5], [1, -4], [-5, 3]], c);
  for (const i of [-12, -5, 3, 10]) stroke(b, [[i, 0], [i - 5, -12, i + 5, -23, i, -37]], darker(c, 0.3), 1.15);
  for (const i of [-10, -1, 8]) stroke(b, [[i, 0], [i - 4, -14, i + 5, -25, i + 1, -38]], "#b3a47c", 0.65);
  mass(b, [[-10, -42], [2, -47], [11, -39], [8, -28], [-6, -27], [-12, -34]], c);
  mass(b, [[2, -44], [10, -38], [7, -29], [2, -30]], darker(c, 0.2));
  line(b, [[-4, -35], [6, -35]], "#343d31", 1.65);
  line(b, [[-3, -35], [5, -35]], "#b5b58a", 0.55);
  stroke(b, [[-6, -42], [-4, -39], [-5, -31]], "#a69b70", 0.8);
  stroke(b, [[1, -42], [2, -38], [0, -30]], darker(c, 0.3), 0.65);
  for (const [x, y, w, h] of [[-17, -27, 17, 14], [13, -26, 18, 14], [-8, -17, 12, 13]]) stone(b, x, y, w, h, "#85877b", 1);
  for (const [x, y] of [[-22, -30], [-13, -37], [15, -31], [11, -40]]) {
    stroke(b, [[x, y + 7], [x - 2, y - 1], [x + 4, y - 7]], "#665b43", 1.8);
    for (const off of [-2, 3]) mass(b, [[x, y], [x + off - 5, y - 4], [x + off, y - 8], [x + off + 2, y - 3]], "#73805a");
  }
}
function ogreBody(b, l, p) {
  const c = l.color;
  for (const side of [-1, 1]) {
    const x = side * 11, s = p.walk * side * 4, lift = Math.max(0, p.stepLift * side) * 4;
    flesh(b, [side * 9, -2], [x, 10 - lift * 0.4], [x + s, 20 - lift], 10, darker(c, 0.12));
    mass(b, [[x + s - 6, 17 - lift], [x + s + 4, 17 - lift], [x + s + 8, 22 - lift], [x + s - 6, 23 - lift]], "#5a5147");
  }
  b.translate(0, p.bob);
  flesh(b, [-15, -25], [-23, -13], p.free, 12, darker(c, 0.12));
  fist(b, p.free, darker(c, 0.06));
  mass(b, [[-22, -24], [-18, -34, -8, -37, 2, -34], [17, -34, 24, -24, 21, -15], [18, -5, 12, 3, -1, 4], [-15, 3, -22, -7, -22, -24]], c);
  mass(b, [[-13, -24], [-5, -28, 5, -26, 12, -23], [7, -17, 1, -16, -3, -17], [-8, -13, -13, -17, -13, -24]], lighter(c, 0.07));
  stroke(b, [[-14, -19], [-6, -20, 0, -14, 9, -19]], darker(c, 0.22), 0.9);
  stroke(b, [[0, -13], [-2, -7, 2, -3, 0, 1]], darker(c, 0.25), 0.8);
  mass(b, [[-11, -2], [13, -2], [18, 10], [7, 12], [0, 9], [-9, 12], [-17, 9]], "#625247");
  line(b, [[-13, 0], [12, 0]], "#3f3932", 2);
  mass(b, [[0, -2], [4, -2], [4, 2], [0, 2]], "#a7946b");
  mass(b, [[-9, -43], [3, -47], [11, -39], [8, -28], [-6, -27], [-12, -35]], c);
  mass(b, [[3, -45], [10, -39], [8, -29], [3, -28], [2, -34]], darker(c, 0.16));
  line(b, [[-4, -36], [1, -37], [7, -36]], "#423d34", 1.45);
  line(b, [[-2, -35], [0, -35]], "#d5c8a3", 0.55);
  mass(b, [[-1, -35], [3, -34], [5, -30], [1, -28], [-3, -30]], lighter(c, 0.08));
  line(b, [[-5, -29], [6, -29]], "#4b4138", 0.85);
  for (const x of [-5, 5]) mass(b, [[x - 1, -27], [x, -33], [x + 2, -27]], BONE);
  line(b, [[-7, -41], [1, -44], [6, -40]], lighter(c, 0.18), 0.7);
  flesh(b, [16, -26], p.elbow, p.hand, 12, c);
  paintRigidEquipment(b, l.weapon === "staff" ? "staff" : "club", p.hand, p.angle, p.casting);
  fist(b, p.hand, c);
  if (l.weapon === "staff") {
    mass(b, [[-16, -27], [-9, -30], [-5, -18], [-12, -13], [-17, -16]], "#4c6669");
    line(b, [[-13, -26], [-8, -18]], "#b6a576", 1);
    for (const x of [-8, -3, 3, 8]) ellipse(b, x, -25, 1.3, 1.1, BONE);
  } else {
    mass(b, [[-21, -29], [-13, -32], [-9, -24], [-14, -16], [-21, -21]], l.crown ? "#5d6461" : "#76654e");
    line(b, [[-18, -28], [-12, -24], [-16, -19]], "#a99b7c", 1);
    mass(b, [[8, -28], [12, -27], [0, 1], [-4, 0]], "#564637");
  }
  if (l.crown) {
    mass(b, [[-4, -41], [1, -46], [8, -43], [10, -39], [4, -39]], "#61594e");
    line(b, [[-2, -42], [3, -44], [8, -41]], "#bba884", 0.65);
  }
  for (const [x, y] of [[-10, -17], [-5, -9], [10, -12], [17, -21]]) {
    line(b, [[x, y], [x + 3, y + 1]], darker(c, 0.2), 0.55);
    line(b, [[x, y + 2], [x + 2, y + 3]], lighter(c, 0.12), 0.45);
  }
}
function fishBody(b, l, p) {
  const c = l.color;
  const farLift = Math.max(0, -p.stepLift) * 3, nearLift = Math.max(0, p.stepLift) * 3;
  flesh(b, [-5, 0], [-13, 8 - farLift * 0.4], [-16 - p.walk * 3, 16 - farLift], 6, darker(c, 0.15));
  flesh(b, [7, 0], [16, 7 - nearLift * 0.4], [20 + p.walk * 3, 15 - nearLift], 6, c);
  for (const [x, lift] of [[-16 - p.walk * 3, farLift], [20 + p.walk * 3, nearLift]]) mass(b, [[x - 3, 13 - lift], [x + 2, 14 - lift], [x + 7, 17 - lift], [x + 1, 17 - lift], [x - 4, 18 - lift]], c);
  b.translate(0, p.bob);
  mass(b, [[-10, -17], [-19, -32], [-16, -9], [-24, -1], [-9, 3]], darker(c, 0.24));
  for (const [x, y] of [[-19, -32], [-16, -9], [-24, -1]]) line(b, [[-8, -14], [x, y]], lighter(c, 0.12), 0.6);
  mass(b, [[-10, 4], [-16, -5, -14, -21, -5, -26], [5, -30, 15, -24, 15, -13], [15, -4, 11, 6, 0, 7], [-6, 6, -9, 5, -10, 4]], c);
  mass(b, [[3, -22], [12, -20], [13, -7], [6, 4], [-1, 3]], lighter(c, 0.13));
  mass(b, [[-10, -23], [-7, -35], [4, -29], [16, -25], [25, -18], [22, -13], [8, -14], [-2, -18]], c);
  mass(b, [[8, -25], [17, -23], [25, -18], [22, -15], [10, -16]], lighter(c, 0.12));
  mass(b, [[9, -15], [24, -17], [21, -12], [10, -12]], darker(c, 0.15));
  line(b, [[11, -15], [24, -17]], "#34443a", 0.85);
  ellipse(b, 14, -25, 1.4, 1.3, "#c8b68d");
  ellipse(b, 14.4, -25, 0.5, 0.8, "#303a31");
  line(b, [[10, -27], [16, -27]], darker(c, 0.32), 0.65);
  for (const y of [-20, -17, -14]) stroke(b, [[4, y], [1, y + 1, 1, y + 3, 4, y + 4]], darker(c, 0.22), 0.6);
  flesh(b, [-6, -13], [-11, -6], p.free, 3.4, darker(c, 0.12));
  flesh(b, [9, -13], p.elbow, p.hand, 4, c);
  if (l.weapon !== "javelin" || p.strike < 0.7) paintRigidEquipment(b, l.weapon === "staff" ? "staff" : l.weapon === "javelin" ? "javelin" : "pike", p.hand, p.angle, p.casting);
  ellipse(b, p.hand[0], p.hand[1], 2.3, 1.7, c, INK3);
  mass(b, [[-8, -1], [8, 0], [12, 7], [0, 9], [-11, 6]], "#655f48");
  line(b, [[-8, 1], [8, 2]], "#b6a27b", 0.7);
  if (l.crown) {
    mass(b, [[-8, -27], [-9, -42], [-2, -35], [2, -44], [8, -31]], "#747d76");
    for (const x of [-5, 0, 5]) line(b, [[x, -29], [x - 2, -37]], "#b9ae8d", 0.65);
  } else if (l.weapon === "javelin") for (const y of [-12, -8, -4]) line(b, [[-9, y], [-4, y - 2]], "#b6b491", 0.65);
}
function beastLeg(b, x, front, near, c, p, slender = false) {
  const phase = (front ? 1 : -1) * (near ? 1 : -1), stride = p.walk * phase * 4;
  const lift = Math.max(0, p.stepLift * phase) * (slender ? 3 : 4);
  const knee = [x + (front ? 2 : -5) + stride * 0.5, (slender ? 6 : 8) - lift * 0.4];
  const foot = [x + stride + (front ? 2 : -2), 18 - lift];
  flesh(b, [x, slender ? -10 : -2], knee, foot, slender ? 3.4 : front ? 4 : 6, near ? c : darker(c, 0.2));
  mass(b, [[foot[0] - 2, foot[1] - 3], [foot[0] + 2, foot[1] - 3], [foot[0] + 5, foot[1]], [foot[0] - 3, foot[1]]], slender ? "#48483e" : darker(c, 0.12));
}
function houndBody(b, l, p) {
  const c = l.color, moss = l.kind === "mossGnawer";
  beastLeg(b, -17, false, false, c, p);
  beastLeg(b, 15, true, false, c, p);
  b.translate(0, p.bob);
  mass(b, [[-23, -6], [-32, -8, -34, -1, -48, 1], [-40, 6, -32, 7, -21, 2]], darker(c, 0.12));
  mass(b, [[-26, -10], [-25, -19, -11, -22, 1, -19], [12, -24, 24, -17, 23, -7], [22, 1, 15, 5, 8, 2], [-2, -2, -5, 2, -15, 3], [-24, 4, -29, -2, -26, -10]], c);
  mass(b, [[-23, -8], [-15, -5, 0, -8, 11, -9], [20, -9, 19, -2, 13, 2], [4, 3, 0, -1, -6, 1], [-17, 4, -23, 1, -23, -8]], darker(c, 0.15));
  mass(b, [[8, -20], [16, -25], [22, -21], [21, -11], [25, -5], [18, -4], [15, 4], [10, -1], [7, -9]], moss ? "#4f5a45" : darker(c, 0.08));
  const x = p.headX, y = p.headY;
  mass(b, [[14, -7], [x - 8, y - 5], [x + 1, y - 8], [x + 8, y - 2], [x + 15, y + 4], [x + 9, y + 7], [x - 2, y + 10], [18, 2]], c);
  mass(b, [[x - 7, y - 4], [x - 6, y - 13], [x, y - 7]], darker(c, 0.12));
  mass(b, [[x, y - 7], [x + 3, y - 13], [x + 5, y - 3]], c);
  mass(b, [[x + 1, y + 5], [x + 14, y + 4], [x + 10, y + 8 + Math.max(0, p.strike) * 3], [x - 1, y + 9]], darker(c, 0.18));
  line(b, [[x + 2, y + 5], [x + 14, y + 4]], INK3, 0.85);
  mass(b, [[x + 12, y + 2], [x + 15, y + 4], [x + 12, y + 5]], "#33372f");
  line(b, [[x - 1, y - 3], [x + 4, y - 1]], darker(c, 0.4), 0.95);
  ellipse(b, x + 2, y - 1, 0.85, 0.75, "#c6b88c");
  line(b, [[x - 5, y + 2], [x - 2, y + 5], [x - 4, y + 8]], lighter(c, 0.16), 0.7);
  if (p.strike > 0.4) mass(b, [[x + 9, y + 5], [x + 10, y + 8], [x + 11, y + 5]], BONE);
  for (const [fx, fy] of [[-18, -15], [-9, -17], [3, -17], [12, -18], [18, -12]]) stroke(b, [[fx - 3, fy - 1], [fx, fy + 2], [fx + 1, fy + 5]], moss ? "#9aa078" : "#b2a181", 0.65);
  b.translate(0, -p.bob);
  beastLeg(b, -14, false, true, c, p);
  beastLeg(b, 17, true, true, c, p);
  b.translate(0, p.bob);
  if (moss) for (const [fx, fy] of [[-20, -18], [-12, -21], [-2, -19]]) mass(b, [[fx - 4, fy], [fx - 4, fy - 4, fx + 2, fy - 5, fx + 4, fy - 1], [fx + 1, fy + 2]], "#727a50");
}
function stagBody(b, l, p) {
  const c = l.color;
  beastLeg(b, -15, false, false, c, p, true);
  beastLeg(b, 16, true, false, c, p, true);
  b.translate(0, p.bob);
  mass(b, [[-25, -19], [-17, -28, 6, -28, 18, -23], [22, -20, 23, -11, 17, -7], [7, -7, 0, -9, -11, -5], [-20, -5, -28, -10, -25, -19]], c);
  mass(b, [[-18, -8], [-7, -12, 5, -14, 17, -12], [12, -5, 2, -7, -7, -4], [-16, -2, -20, -5, -18, -8]], lighter(c, 0.1));
  const x = p.headX, y = p.headY;
  mass(b, [[12, -9], [20, -17, 18, y + 1, x - 6, y - 6], [x + 1, y - 9], [x + 9, y], [x + 12, y + 4], [x + 3, y + 7], [x - 3, y + 4, 22, -6, 15, -5]], c);
  mass(b, [[x + 3, y + 3], [x + 12, y + 4], [x + 3, y + 7], [x - 2, y + 5]], darker(c, 0.15));
  mass(b, [[x - 4, y - 5], [x - 13, y - 12], [x - 5, y - 13], [x, y - 7]], lighter(c, 0.1));
  ellipse(b, x + 2, y - 1, 0.8, 0.8, "#d1bf94");
  line(b, [[x + 10, y + 3], [x + 12, y + 4]], "#413f34", 0.8);
  for (const side of [-1, 1]) {
    const root = [x - 2 + side * 3, y - 7], mid = [x - 6 + side * 9, y - 22], tip = [x - 10 + side * 13, y - 34];
    stroke(b, [root, [mid[0], mid[1], mid[0] + 3, mid[1] - 2, ...tip]], "#76694f", 2.2);
    stroke(b, [root, [mid[0], mid[1], mid[0] + 3, mid[1] - 2, ...tip]], BONE, 1.1);
    for (const t of [0.35, 0.65]) {
      const bx = root[0] + (tip[0] - root[0]) * t, by = root[1] + (tip[1] - root[1]) * t;
      stroke(b, [[bx, by], [bx + side * 7, by - 4], [bx + side * 9, by - 11]], BONE, 1.1);
    }
  }
  stroke(b, [[-24, -15], [-29, -13, -29, -9, -26, -7]], "#695d48", 2.5);
  for (const x2 of [-17, -8, 1, 10]) line(b, [[x2, -22], [x2 + 2, -20]], "#c1af88", 0.7);
  b.translate(0, -p.bob);
  beastLeg(b, -12, false, true, c, p, true);
  beastLeg(b, 18, true, true, c, p, true);
  b.translate(0, p.bob);
}
function turtleBody(b, l, p) {
  const c = l.color;
  for (const side of [-1, 1]) flesh(b, [side * 16, 0], [side * 24, 4], [side * 30 + p.walk * side * 2, 13 - Math.max(0, p.stepLift * side) * 2], 6, darker(c, 0.18));
  b.translate(0, p.bob);
  mass(b, [[-24, 0], [-30, -11, -20, -26, -4, -27], [12, -29, 27, -18, 27, -4], [24, 5, 4, 9, -16, 5], [-24, 4, -26, 2, -24, 0]], "#626d59");
  mass(b, [[-26, -2], [-22, -13, -12, -21, -1, -23], [11, -24, 23, -14, 24, -4], [16, -4, 4, 2, -9, 3], [-17, 3, -24, 2, -26, -2]], "#7c8167");
  for (const [x2, y2, w, h] of [[-15, -7, 15, 14], [-3, -14, 17, 15], [11, -11, 15, 16], [-1, 0, 16, 10]]) {
    mass(b, [[x2 - w * 0.5, y2], [x2 - w * 0.2, y2 - h * 0.5], [x2 + w * 0.35, y2 - h * 0.4], [x2 + w * 0.5, y2 + h * 0.3], [x2, y2 + h * 0.5]], "#778067");
    line(b, [[x2 - 4, y2], [x2, y2 - 4], [x2 + 4, y2]], "#a3a487", 0.65);
  }
  const x = p.headX, y = p.headY;
  flesh(b, [18, -2], [x - 6, y + 4], [x + 4, y + 4], 10, c);
  mass(b, [[x - 6, y + 3], [x - 3, y - 5], [x + 4, y - 7], [x + 11, y - 1], [x + 15, y + 4], [x + 7, y + 9], [x - 2, y + 8]], c);
  mass(b, [[x + 3, y + 5], [x + 15, y + 4], [x + 10, y + 8], [x + 1, y + 9]], darker(c, 0.16));
  line(b, [[x + 4, y + 5], [x + 14, y + 4]], INK3, 0.85);
  ellipse(b, x + 5, y - 1, 1, 0.85, "#c2b284");
  line(b, [[x + 1, y - 3], [x + 6, y - 3]], darker(c, 0.3), 0.65);
  stroke(b, [[-24, 2], [-33, 5, -37, 10, -42, 12]], c, 3);
  b.translate(0, -p.bob);
  for (const side of [-1, 1]) {
    const x2 = side * 17, foot = [side * 31 - p.walk * side * 3, 18 - Math.max(0, -p.stepLift * side) * 2];
    flesh(b, [x2, 0], [side * 26, 7], foot, 7, c);
    for (const i of [-1, 0, 1]) line(b, [[foot[0] + i * 2, foot[1] - 3], [foot[0] + i * 3 + 3, foot[1]]], BONE, 0.85);
  }
  b.translate(0, p.bob);
}
function spiderBody(b, l, p) {
  const c = l.color, queen = l.crown;
  for (const near of [false, true]) for (let i = 0; i < 4; i++) {
    const phase = (i % 2 ? 1 : -1) * (near ? 1 : -1), step = p.walk * phase * 2;
    const lift = Math.max(0, p.stepLift * phase) * 2.3;
    const root = [-8 + i * 5, -3 + i], knee = [[-34, -23, 18, 31][i] + (near ? 0 : 5), [-14, -9, -7, -13][i] + (near ? 0 : -3)];
    const tip = [[-45, -31, 27, 46][i] + (near ? 0 : 5) + step, (near ? 18 : 14) - lift];
    flesh(b, root, [(root[0] + knee[0]) / 2, (root[1] + knee[1]) / 2], knee, 2.4, near ? c : darker(c, 0.22));
    flesh(b, knee, [(knee[0] + tip[0]) / 2, (knee[1] + tip[1]) / 2], tip, 1.5, near ? c : darker(c, 0.22));
  }
  b.translate(0, p.bob);
  mass(b, [[-25, -4], [-30, -20, -17, -29, -6, -22], [4, -20, 8, -9, 2, -1], [-6, 6, -19, 7, -25, -4]], c);
  mass(b, [[-22, -12], [-23, -22, -9, -25, -4, -16], [-2, -8, -9, -3, -17, -5]], darker(c, 0.12));
  for (const i of [-1, 0, 1]) stroke(b, [[-16 + i * 5, -22], [-20 + i * 7, -11], [-15 + i * 5, 0]], queen ? "#a58e85" : "#a49e7c", 0.8);
  const hx = 9 + p.dx * 5, hy = -4 + p.dy * 4;
  ellipse(b, hx, hy + 1, 10, 8.5, lighter(c, 0.02), INK3);
  for (const [x, y, r] of [[5, -2, 1], [7, 1, 1], [2, -4, 0.55], [4, 4, 0.55]]) ellipse(b, hx + x, hy + y, r, r, "#c2b58c");
  for (const side of [-1, 1]) {
    const tip = [p.release[0], p.release[1] + side * 2];
    mass(b, [[hx + 7, hy + 3 + side * 2], [hx + 16, hy + 2 + side * 6], [tip[0] + 1, tip[1] + 4], [tip[0] - 3, tip[1]], [hx + 10, hy + 4]], "#a9a08b");
  }
  if (queen) {
    for (const [x, y] of [[-20, -18], [-13, -23], [-5, -17]]) mass(b, [[x - 3, y], [x - 1, y - 5], [x + 3, y - 2], [x + 2, y + 2]], "#91867e");
  }
}
function dragonWing(b, x, y, flare, near) {
  const shadow = near ? "#725247" : "#535653", membrane = near ? "#97745d" : "#6b6759";
  b.save();
  b.translate(x, y);
  mass(b, [[1, 1], [-7, -13, -13, -27 - flare, -19, -34 - flare], [-31, -34, -45, -23, -52, -12], [-44, -15, -37, -12, -35, -6], [-29, -11, -22, -4, -22, 3], [-16, -3, -6, -1, 1, 1]], shadow);
  mass(b, [[-19, -33 - flare], [-29, -31, -39, -23, -48, -14], [-40, -15, -36, -10, -35, -7], [-30, -11, -26, -6, -24, 0], [-23, -11, -23, -24, -19, -33 - flare]], membrane);
  for (const tip of [[-50, -13], [-35, -7], [-23, 2]]) stroke(b, [[-19, -34 - flare], [-23, -24, -25, -16, ...tip]], near ? "#b89b7e" : "#8e8975", 0.6);
  stroke(b, [[1, 1], [-7, -12, -13, -27 - flare, -19, -34 - flare], [-31, -32, -42, -23, -51, -13]], near ? "#c4a78c" : "#8e8c7a", 1.4);
  b.restore();
}
function dragonBody(b, l, p) {
  const c = l.color;
  beastLeg(b, -13, false, false, c, p);
  beastLeg(b, 15, true, false, c, p);
  b.translate(0, p.bob);
  mass(b, [[-19, -9], [-34, -14, -43, 2, -64, -5], [-55, 7, -36, 7, -18, 1]], darker(c, 0.08));
  stroke(b, [[-20, -7], [-36, -8, -45, 5, -61, -4]], lighter(c, 0.2), 0.7);
  dragonWing(b, 7, -16, Math.max(0, p.strike) * 5 + p.walk * 2, false);
  mass(b, [[-25, -12], [-23, -24, -4, -27, 10, -21], [23, -20, 27, -10, 20, -1], [11, 7, -3, 4, -17, 3], [-24, 1, -28, -4, -25, -12]], c);
  mass(b, [[-18, -4], [-8, -10, 5, -9, 19, -4], [16, 4, 4, 6, -11, 2]], "#a28a6b");
  for (const y2 of [-3, 0, 3]) stroke(b, [[-12, y2], [1, y2 - 3, 9, y2 - 2, 16, y2]], "#695a47", 0.65);
  const x = p.headX, y = p.headY;
  mass(b, [[13, -2], [22, -12, 17, y - 6, x - 6, y - 7], [x + 2, y - 10], [x + 10, y - 3], [x + 15, y + 4], [x + 4, y + 9], [x - 5, y + 5, 22, 6, 15, 4]], c);
  mass(b, [[21, 1], [25, -10, x - 5, y + 1, x + 3, y + 3], [x + 9, y + 8, x + 7, y + 10, x, y + 9], [x - 6, y + 9, 24, 8, 21, 1]], "#b29b79");
  mass(b, [[x + 1, y + 5], [x + 14, y + 4], [x + 10, y + 8 + Math.max(0, p.strike) * 3], [x + 1, y + 10]], darker(c, 0.18));
  line(b, [[x + 2, y + 5], [x + 14, y + 4]], "#352d28", 1);
  line(b, [[x - 1, y - 2], [x + 5, y - 2]], "#45362d", 1.8);
  line(b, [[x, y - 2], [x + 5, y - 2]], "#d5b06b", 0.9);
  line(b, [[x + 11, y + 1], [x + 13, y + 2]], "#45362d", 0.7);
  for (const side of [-1, 1]) mass(b, [[x - 4 + side * 3, y - 6], [x - 11 + side * 4, y - 15], [x - 5 + side * 3, y - 12], [x + side * 3, y - 6]], BONE);
  if (l.crown) stroke(b, [[x - 7, y - 3], [x - 4, y + 1], [x - 3, y + 6]], "#c3a983", 0.85);
  for (const i of [0, 1, 2, 3, 4]) {
    const sx = -20 + i * 7, sy = -18 + (i < 2 ? 0 : 2);
    mass(b, [[sx - 2, sy], [sx - 4, sy - 7], [sx + 2, sy - 3], [sx + 4, sy + 1]], "#88785e");
  }
  for (const [sx, sy] of [[-15, -16], [-5, -18], [7, -17], [18, -10], [p.headX - 4, p.headY - 3]]) for (let i = 0; i < 3; i++) stroke(b, [[sx + i * 2, sy], [sx + i * 2 + 1, sy + 2], [sx + i * 2 + 3, sy + 1]], darker(c, 0.24), 0.55);
  dragonWing(b, -1, -16, Math.max(0, p.strike) * 6 - p.walk * 2, true);
  b.translate(0, -p.bob);
  beastLeg(b, -11, false, true, c, p);
  beastLeg(b, 17, true, true, c, p);
  for (const side of [-1, 1]) {
    const x2 = side < 0 ? -13 - p.walk * 4 : 19 + p.walk * 4, lift = Math.max(0, p.stepLift * side) * 4;
    for (const i of [-1, 0, 1]) line(b, [[x2 + i * 1.5, 16 - lift], [x2 + i * 2 + 3, 18 - lift]], BONE, 0.7);
  }
  b.translate(0, p.bob);
}
function spiritBody(b, l, p) {
  b.translate(0, p.bob);
  const sway = p.walk * 2 + p.dx * 3;
  b.save();
  b.globalAlpha *= 0.72;
  mass(b, [[-7, -33], [-14, -24, -5, -14, -11, 1], [-13, 10, -8, 15, -17, 19], [-2, 17, 7, 8, 5, -1], [12, -14, 10, -29, 3, -35]], "#a8b6ad", "#7e91867a");
  mass(b, [[-3, -29], [-7, -15, 4, -8, sway + 2, 5], [sway + 6, 12, sway + 3, 15, sway - 1, 18], [sway + 13, 10, 10, -3, 6, -16], [9, -29, 2, -34, -3, -29]], "#d1d0b8", "#aab2a180");
  stroke(b, [[-4, -17], [-17, -7, -13, 8, -23, 13]], "#a9b7a8", 1.3);
  stroke(b, [[4, -22], [15, -19, 14, p.release[1] + 3, ...p.release]], "#d5d5bc", 2);
  mass(b, [[-6, -30], [-5, -39, 2, -41, 7, -34], [9, -29, 3, -25, -2, -26]], "#bcc6b7", "#8b9c9080");
  line(b, [[-1, -32], [3, -32]], "#e9e2c9", 0.8);
  b.restore();
}
function paintCreatureBody(b, look, p) {
  b.lineCap = "round";
  b.lineJoin = "round";
  switch (look.shape) {
    case "stone":
      stoneBody(b, look, p);
      break;
    case "wood":
      woodBody(b, look, p);
      break;
    case "ogre":
      ogreBody(b, look, p);
      break;
    case "fish":
      fishBody(b, look, p);
      break;
    case "hound":
      houndBody(b, look, p);
      break;
    case "stag":
      stagBody(b, look, p);
      break;
    case "turtle":
      turtleBody(b, look, p);
      break;
    case "spider":
      spiderBody(b, look, p);
      break;
    case "dragon":
      dragonBody(b, look, p);
      break;
    case "spirit":
      spiritBody(b, look, p);
      break;
  }
  if (p.casting) {
    b.save();
    b.globalAlpha *= p.casting;
    ellipse(b, p.release[0], p.release[1], 6, 7, "#d4d3b42b");
    stroke(b, [[p.release[0] - 5, p.release[1]], [p.release[0] + 5, p.release[1]]], "#ded4af", 0.8);
    b.restore();
  }
}

// src/client/art/painted-creatures.ts
function creatureAnatomy(kind) {
  const shape = creatures[kind]?.shape;
  return shape === void 0 ? void 0 : shape === "stone" ? "construct" : shape === "wood" ? "wood" : shape === "ogre" || shape === "fish" ? "foot" : shape === "spirit" ? "spirit" : "beast";
}
function creatureShadow(kind) {
  const def = creatures[kind];
  if (!def || def.shape === "spirit") return void 0;
  const rx = def.shape === "ogre" || def.shape === "stone" || def.shape === "wood" ? 22 : def.shape === "fish" ? 18 : def.shape === "spider" ? 29 : 31;
  return { rx: rx * (def.size ?? 1), ry: (def.shape === "ogre" ? 5.5 : 5) * (def.size ?? 1), y: def.shape === "ogre" ? 18 : (def.shape === "stone" || def.shape === "wood" ? 23 : 18) * (def.size ?? 1) };
}
function paintCreature(b, kind, team, frame, presentation = {}) {
  const def = creatures[kind];
  if (!def) return false;
  const size = presentation.size ?? def.size ?? 1, drawing = creatureDrawing(def.shape, def.weapon, frame);
  b.save();
  if (def.shape === "ogre") b.translate(0, 18 - 23 * size);
  b.scale(size, size);
  paintCreatureBody(b, { kind, shape: def.shape, color: presentation.color ?? def.color, team, crown: presentation.crown ?? !!def.crown, weapon: def.weapon }, drawing);
  presentation.detail?.(b, { ...drawing.motion, reach: drawing.strike }, drawing);
  b.restore();
  return true;
}

// src/client/art/painted-mercenaries.ts
function hasMercenaryModel(kind) {
  return kind === "mercenary" || kind === "contractArcher" || kind === "fieldMedic";
}
var IRON = "#737c76";
var IRON_SHADOW = "#444e4c";
var LEATHER = "#756044";
var LINEN2 = "#c5b89a";
var LINEN_SHADOW = "#908a76";
var HAIR = "#55483a";
function companyShield(b, grip, team, facing) {
  const [x, y] = grip;
  paintedPlane(b, [[x - 8, y - 11], [x - 4, y - 13], [x + 4, y - 12], [x + 8, y - 8], [x + 7, y + 6], [x, y + 12], [x - 7, y + 7]], "#918366", INK2, 0.8);
  paintedPlane(b, [[x - 6, y - 9], [x - 3, y - 11], [x + 3, y - 10], [x + 6, y - 7], [x + 5, y + 5], [x, y + 10], [x - 5, y + 6]], darker(team, 0.23));
  paintedPlane(b, [[x - 6, y - 2], [x + 5, y - 7], [x + 6, y - 2], [x - 5, y + 4]], "#c9b994", "transparent", 0);
  line(b, [[x - 6, y - 8], [x - 6, y + 5], [x, y + 10]], facing === 1 ? "#c4bca4" : "#6c6855", 0.9);
  line(b, [[x - 3, y + 5], [x + 2, y + 3]], "#41463d", 0.8);
  ellipse(b, x, y, 1.9, 2.2, IRON, INK2);
  for (const [a, z] of [[-5, -8], [5, -6], [-4, 5], [3, 5]]) ellipse(b, x + a, y + z, 0.45, 0.5, "#d0c5a6");
}
function equipment(b, kind, f, team, facing, rig, cloth, layer) {
  const sleeve = kind === "mercenary" ? darker(cloth, 0.15) : cloth;
  if (layer === rig.primaryLayer) arm(b, rig.shoulder, rig.elbow, rig.wrist, sleeve, !!f.armor, layer === "front");
  if (layer === rig.equipmentLayer) {
    paintEquipmentAsset(b, f, rig);
    hand2(b, rig.wrist);
  }
  if (layer === "front") {
    arm(b, rig.supportShoulder, rig.supportElbow, rig.support, sleeve, !!f.armor, true);
    if (rig.shield) {
      if (rig.shieldStyle === "round") shield(b, ...rig.support, team, false, facing, true);
      else companyShield(b, rig.support, team, facing);
    } else hand2(b, rig.support);
  }
}
function legs(b, kind, stride, drop, facing) {
  const near = kind === "mercenary" ? "#726954" : kind === "contractArcher" ? "#7a7459" : "#645d50";
  const far = darker(near, 0.23);
  for (const [side, hip, knee, foot] of [
    [-1, [-3, -4 + drop], [-4 - stride * 3, 5 + drop * 0.4], [-5 - stride * 5, 16 - Math.max(0, stride) * 2.2]],
    [1, [3, -4 + drop], [5 + stride * 2, 5 + drop * 0.4], [6 + stride * 5, 16 - Math.max(0, -stride) * 2.2]]
  ]) {
    const lit = side === facing, color = lit ? near : far;
    segment(b, [...hip], [...knee], 4.7, color, lit);
    segment(b, [...knee], [foot[0], foot[1] - 3], 3.8, kind === "mercenary" ? IRON_SHADOW : "#4d4b3f", lit);
    if (kind === "mercenary") {
      paintedPlane(b, [[knee[0] - 2.2, knee[1] - 1.3], [knee[0] + 1.6, knee[1] - 2], [knee[0] + 2.1, knee[1] + 2.2], [knee[0] - 1.8, knee[1] + 3]], lit ? IRON : IRON_SHADOW);
      line(b, [[knee[0] - 1.5, knee[1] + 4], [foot[0] - 0.7, foot[1] - 4]], "#a69f83", 0.65);
    } else {
      for (const y of [1, 3.3, 5.5]) {
        const t = y / 7, x = knee[0] + (foot[0] - knee[0]) * t;
        line(b, [[x - 1.8, knee[1] + y], [x + 1.5, knee[1] + y - 0.5]], kind === "fieldMedic" ? "#999078" : "#afa383", 0.65);
      }
    }
    boot(b, ...foot);
  }
}
function face(b, kind, facing, headwear) {
  paintedPlane(b, [[-3.2, -36], [-1.3, -39.1], [1.8, -38.5], [3.3, -35.3], [4.9, -34.3], [3.5, -33.3], [3.1, -30.4], [0.3, -29.1], [-2.8, -31.1]], SKIN);
  paintedPlane(b, [[1.2, -37], [3.2, -35.2], [4.9, -34.3], [3.5, -33.3], [3.1, -30.4], [0.5, -29.8]], facing === 1 ? "#987259" : "#7d614f", "transparent", 0);
  line(b, [[2, -35.5], [3.5, -35.2]], "#35322d", 0.55);
  line(b, [[1.2, -31.7], [3.1, -31.2]], "#725744", 0.45);
  if (kind === "mercenary") {
    paintedPlane(b, [[-2, -31.9], [0.3, -30.4], [3, -31], [2.7, -28.9], [0.1, -28.3], [-2, -30]], "#665543", "transparent", 0);
    if (headwear) {
      paintedPlane(b, [[-5.4, -33.7], [-4.6, -39.2], [-1.6, -42], [2.5, -41.2], [4.2, -38.3], [4.9, -35.8], [1.7, -36.1], [-0.9, -34.8]], IRON);
      paintedPlane(b, [[-4.1, -38.7], [-1.5, -40.7], [0.2, -39.7], [-0.5, -36], [-4.7, -34.6]], facing === 1 ? "#a7aea0" : IRON_SHADOW, "transparent", 0);
      paintedPlane(b, [[-5.3, -34.8], [-1.8, -33.7], [-2.3, -29.5], [-4.3, -30.4]], IRON_SHADOW);
      line(b, [[-4, -39], [-0.9, -41], [2.2, -40.4]], "#c7c4af", 0.7);
      line(b, [[1, -39], [2.9, -38.1]], "#444d48", 0.6);
    }
  } else {
    paintedPlane(b, [[-4, -33.1], [-4.2, -38], [-2, -40.2], [1.3, -40.1], [3.1, -38], [0.2, -38.3], [-1.4, -34.6], [-1.4, -31.6]], HAIR);
    if (headwear && kind === "contractArcher") {
      paintedPlane(b, [[-6.8, -37.7], [-4.6, -42], [-0.3, -43.1], [3.7, -40.3], [3.8, -37.5]], "#686951");
      paintedPlane(b, [[-8, -36.8], [-5.1, -38.8], [3.6, -38.8], [7.2, -36.9], [3.8, -35.6], [-2.5, -36.1]], "#919077");
      line(b, [[-4.5, -41.7], [0.2, -42.1], [3, -40.3]], "#b4aa87", 0.65);
      line(b, [[-4, -38.8], [3.4, -38.4]], "#484d40", 1);
      paintedPlane(b, [[-5, -39], [-5, -42.5], [-7.8, -44.2], [-7.1, -39.6]], "#b6ab8b");
    } else if (headwear) {
      paintedPlane(b, [[-4.5, -37.1], [-2.6, -40.3], [0.3, -41.1], [3.3, -38.9], [3.3, -36.7]], LINEN2);
      line(b, [[-3.9, -37.3], [3.3, -36.9]], "#ded0ae", 1.2);
      paintedPlane(b, [[-4.2, -37.4], [-5.7, -36.1], [-7.7, -30.6], [-5.1, -31.5], [-3.7, -35.9]], LINEN_SHADOW);
    }
  }
}
function swordsmanBody(b, team, cloth, flutter) {
  paintedPlane(b, [[-8, -26], [-3, -29], [4, -27], [1, -14], [-8 + flutter, 3], [-16 + flutter, 1], [-13, -13]], darker(team, 0.33));
  line(b, [[-10, -22], [-12, -4], [-9 + flutter, 1]], lighter(team, 0.06), 0.8);
  paintedPlane(b, [[-7, -25], [-2, -28], [4, -27], [7, -23], [5, -10], [-5, -9], [-7, -17]], LEATHER);
  paintedPlane(b, [[0.5, -26], [6, -23], [5, -12], [0.8, -11]], "#514b3b", "transparent", 0);
  for (const [x, y, w] of [[-5, -23, 4.5], [0.6, -23, 4.4], [-4.5, -18, 4.5], [0.7, -18, 4.1]]) {
    paintedPlane(b, [[x, y], [x + w, y + 0.6], [x + w - 0.2, y + 3.8], [x - 0.3, y + 3.2]], IRON);
    line(b, [[x + 0.4, y + 0.3], [x + w - 0.5, y + 0.6]], "#abb0a0", 0.55);
    ellipse(b, x + 0.8, y + 1.6, 0.35, 0.4, "#c0b594");
  }
  paintedPlane(b, [[-9, -27], [-5, -28.5], [-1, -26], [-2, -22], [-8, -23]], cloth);
  line(b, [[-8, -26], [-3, -25]], "#c3b393", 0.9);
  paintedPlane(b, [[-6, -10], [5, -10], [7, -1], [2, 1], [-5, 0], [-8, -2]], "#7b6950");
  for (const x of [-5, -1, 3]) line(b, [[x, -8], [x + 1, -1]], "#c0ad88", 0.7);
  line(b, [[-6, -10], [5, -10]], "#423c30", 2.3);
  paintedPlane(b, [[0, -11], [2, -11], [2, -9], [0, -9]], "#b5a071");
  paintedPlane(b, [[5, -12], [8, -11], [8, -4], [5, -3]], HIDE);
  line(b, [[5.7, -11], [7.5, -10]], "#bb9b75", 0.6);
}
function archerBody(b, team, cloth, flutter) {
  paintedPlane(b, [[-10, -26], [-5, -29], [4, -28], [6, -21], [-3, -20], [-9, -13], [-14, -15]], darker(team, 0.3));
  line(b, [[-10, -24], [-5, -26], [1, -25]], lighter(team, 0.1), 0.8);
  paintedPlane(b, [[-6, -22], [4, -23], [6, -11], [8 + flutter, 9], [2 + flutter * 0.4, 10], [0, -4], [-4, 11], [-10 + flutter, 9], [-7, -6]], LEATHER);
  paintedPlane(b, [[1, -20], [4, -21], [5, -8], [7 + flutter, 8], [3, 8], [0.2, -3]], "#534d3b", "transparent", 0);
  paintedPlane(b, [[-7, -25], [-2, -28], [4, -27], [7, -23], [5, -10], [-5, -9], [-7, -17]], cloth);
  paintedPlane(b, [[1, -26], [6, -23], [5, -11], [1, -10]], darker(cloth, 0.23), "transparent", 0);
  line(b, [[-5, -23], [-1, -25], [2, -24]], lighter(cloth, 0.25), 0.8);
  paintedPlane(b, [[-5, -27], [-2, -28], [5, -12], [2, -11]], "#514535");
  line(b, [[-3.8, -26], [3, -12]], "#b3a17b", 0.8);
  line(b, [[-6, -10], [5, -10]], "#423c30", 2);
  paintedPlane(b, [[3, -9], [10, -8], [10, -2], [7, 1], [3, -1]], "#8c7654");
  paintedPlane(b, [[3, -9], [10, -8], [9, -5], [4, -5]], "#a39168");
  ellipse(b, 7, -5.5, 0.5, 0.55, "#d4be89");
}
function medicBody(b, team, cloth, flutter) {
  paintedPlane(b, [[-9, -25], [-4, -28], [4, -27], [4, -14], [-2, 4], [-12 + flutter, 3], [-12, -15]], darker(team, 0.36));
  paintedPlane(b, [[-7, -25], [-2, -28], [4, -27], [7, -23], [5, -13], [8 + flutter, 8], [3, 10], [0, -3], [-3, 10], [-9 + flutter, 8], [-6, -9]], cloth);
  paintedPlane(b, [[1, -26], [6, -23], [4, -9], [7 + flutter, 7], [3, 8], [0.8, -4]], darker(cloth, 0.25), "transparent", 0);
  line(b, [[-5, -24], [-3, -26], [-1, -23], [-1, -13]], "#e3d4b1", 0.9);
  paintedPlane(b, [[-4, -12], [4, -12], [5, 5], [1, 7], [-5, 5]], "#80745d");
  line(b, [[-3, -10], [-3, 4], [1, 5]], "#b3a389", 0.75);
  line(b, [[-6, -12], [5, -12]], "#514737", 1.8);
  paintedPlane(b, [[-5, -26], [-3, -27], [6, -12], [4, -11]], HIDE);
  line(b, [[-4, -25], [5, -12]], "#b5a181", 0.7);
  paintedPlane(b, [[4, -11], [11, -10], [12, -4], [9, 0], [4, -2]], "#73533e");
  paintedPlane(b, [[4, -11], [11, -10], [11, -7], [5, -7]], "#967354");
  line(b, [[6, -8], [9, -8]], "#d1b995", 0.8);
  line(b, [[7.5, -9.5], [7.5, -6.5]], "#d1b995", 0.8);
  for (const [x, y] of [[-6, -8], [-3, -7]]) {
    paintedPlane(b, [[x - 0.8, y - 1], [x + 0.6, y - 1], [x + 1.2, y + 3], [x - 0.9, y + 3]], "#a7aea1");
    line(b, [[x - 0.6, y - 1.5], [x + 0.6, y - 1.5]], "#6c5540", 1.2);
  }
}
function paintMercenary(b, kind, team, pose, facing, presentation = {}) {
  const base = figures[kind], f = presentation.appearance ? { ...base, ...presentation.appearance } : base;
  const rig = sampleFigurePose(f, pose, presentation), stride = rig.motion.stride;
  const cloth = presentation.cloth ?? (kind === "fieldMedic" ? LINEN2 : kind === "contractArcher" ? "#827a60" : darker(team, 0.25));
  b.save();
  b.lineJoin = "round";
  b.lineCap = "round";
  legs(b, kind, stride, rig.bodyDrop, facing);
  b.translate(rig.impact * 2, rig.motion.lift + rig.motion.breathe + rig.bodyDrop);
  b.translate(0, -4);
  b.rotate(rig.lean);
  b.translate(0, 4);
  const flutter = stride * 1.4 + rig.impact * 2;
  if (kind === "contractArcher") {
    paintedPlane(b, [[-12, -28], [-7, -29], [-5, -13], [-10, -11]], "#574b36");
    paintedPlane(b, [[-12, -27], [-8, -28], [-7, -22], [-11, -21]], "#9b8660");
    for (const [x, y] of [[-11, -32], [-8, -34], [-6, -31]]) {
      line(b, [[x, y], [x + 3, -16]], "#bcae89", 0.65);
      paintedPlane(b, [[x - 1.1, y - 2], [x + 0.5, y - 4], [x + 1, y + 2]], "#c7bb97", INK2, 0.35);
    }
  }
  equipment(b, kind, f, team, facing, rig, cloth, "back");
  paintedPlane(b, [[-2.2, -31], [2, -31], [2.5, -26], [-2.5, -26]], SKIN);
  if (kind === "mercenary") swordsmanBody(b, team, cloth, flutter);
  else if (kind === "contractArcher") archerBody(b, team, cloth, flutter);
  else medicBody(b, team, cloth, flutter);
  presentation.detail?.(b, rig, "body");
  face(b, kind, facing, presentation.headwear !== false);
  presentation.detail?.(b, rig, "head");
  equipment(b, kind, f, team, facing, rig, cloth, "front");
  presentation.detail?.(b, rig, "equipment");
  b.restore();
  return true;
}
function paintMercenaryRemains(b, kind, options) {
  const ink2 = "#555247", wash = options.cloth ?? (kind === "fieldMedic" ? "#a29a84" : kind === "contractArcher" ? "#8b866f" : "#85816f");
  const patch = (points, fill = wash) => {
    polygon(b, points, fill, ink2, 0.65);
    line(b, [points[1], points[2]], "#c0b8a466", 0.55);
  };
  const limb2 = (points, width = 3) => {
    line(b, points, ink2, width + 0.8);
    line(b, points, "#929082", width);
  };
  limb2([[-7, -1], [-13, 2], [-15, 7]], 2.5);
  patch([[-9, -5], [-2, -7], [9, -2], [11, 4], [4, 7], [-8, 2]]);
  if (kind === "mercenary") {
    patch([[-7, -5], [-1, -6], [6, -3], [5, 3], [-2, 3]], "#777d72");
    for (const x of [-4, 0, 3]) line(b, [[x, -4], [x + 1, 1]], "#b1ae97", 0.55);
    patch([[2, 4], [11, 3], [16, 7], [7, 9]], "#77715e");
  } else {
    patch([[0, -5], [12, -2], [16, 4], [12, 9], [7, 7], [5, 3]], wash);
    patch([[8, -1], [14, 0], [16, 4], [12, 5], [8, 3]], kind === "fieldMedic" ? "#826f58" : "#817358");
  }
  limb2([[8, 4], [16, 5], [24, 3]], 3.4);
  limb2([[7, 6], [14, 10], [22, 10]], 3);
  patch([[-9, -4], [-11, -7], [-16, -7], [-19, -4], [-17, 0], [-12, 1]], "#aaa594");
  if (options.headwear !== false) {
    if (kind === "mercenary") patch([[-20, -5], [-17, -10], [-12, -9], [-10, -6], [-15, -4]], "#8b9186");
    else if (kind === "contractArcher") {
      patch([[-20, -6], [-18, -10], [-14, -11], [-11, -8], [-12, -5]], "#858570");
      patch([[-22, -4], [-19, -6], [-12, -6], [-8, -3], [-15, -2]], "#a39c81");
    } else {
      line(b, [[-19, -6], [-16, -8], [-12, -7]], "#c0b8a2", 2);
      patch([[-18, -6], [-23, -1], [-21, 1], [-17, -3]], "#a69f89");
    }
  }
  limb2([[-5, -3], [1, 0], [-1, 6]], 2.5);
  const visibleShield = options.shield ?? kind === "mercenary";
  if (visibleShield) {
    if (options.shieldStyle === "round") {
      ellipse(b, -3, 11, 7, 4.5, "#6b6c60", ink2);
      ellipse(b, -3, 11, 2, 1.4, "#aaa594", ink2);
    } else {
      patch([[-11, 7], [-6, 5], [2, 8], [3, 12], [-3, 16], [-10, 13]], "#7e806c");
      line(b, [[-9, 11], [1, 8]], "#b5ad91", 1.6);
      ellipse(b, -4, 10, 1.5, 1.1, "#929082", ink2);
    }
  }
  if (kind === "contractArcher") for (const x of [12, 15]) line(b, [[x, -2], [x + 6, 7]], "#b6ae94", 0.55);
  if (kind === "fieldMedic") {
    ellipse(b, 14, 6, 1.2, 2, "#a4ad9a", ink2);
    line(b, [[13.4, 4], [14.6, 4]], "#76634c", 0.8);
  }
}

// src/client/art/corpses.ts
var { ink: INK4, wash: WASH, light: LIGHT, dark: DARK } = REMAINS_MATERIAL;
var corpseDetails = /* @__PURE__ */ new WeakMap();
var nextCorpseDetail = 1;
function corpseAppearanceKey(p = {}) {
  let detail = 0;
  if (p.detail) {
    detail = corpseDetails.get(p.detail) ?? nextCorpseDetail++;
    corpseDetails.set(p.detail, detail);
  }
  return `${p.anatomy ?? ""}:${p.weapon ?? ""}:${p.shieldStyle ?? ""}:${p.shield ?? ""}:${p.headwear ?? ""}:${p.robe ?? ""}:${p.cloth ?? ""}:${p.size ?? ""}:${detail}`;
}
var loadout = equipmentForKind;
var isStaff = (equipment2) => equipment2 === "staff" || equipment2 === "crozier";
function sketch(b, p, fill = WASH) {
  polygon(b, p, fill, INK4, 0.65);
  b.save();
  b.clip();
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]), lo = Math.min(...xs), hi = Math.max(...xs), y = Math.min(...ys), bottom = Math.max(...ys);
  for (let x = lo - 10; x < hi + 12; x += 3.1) line(b, [[x, y], [x - 7, bottom]], "#4c50433d", 0.45);
  b.restore();
  if (p.length > 3) line(b, [p[1], p[2]], "#c0b8a466", 0.55);
}
function limb(b, p, width = 3) {
  line(b, p, INK4, width + 0.8);
  line(b, p, WASH, width);
}
function weapon(b, equipment2) {
  if (!equipment2 || equipment2 === "none") return;
  if (equipment2 === "sling") {
    line(b, [[4, 12], [11, 15], [16, 12], [25, 14]], INK4, 0.8);
    line(b, [[4, 13], [10, 16], [16, 14], [25, 14]], INK4, 0.6);
    sketch(b, [[12, 12], [16, 11], [19, 13], [16, 15]], DARK);
    ellipse(b, 22, 10, 1.7, 1.2, LIGHT, INK4);
  } else if (equipment2 === "bow") {
    b.beginPath();
    b.moveTo(-19, 8);
    b.quadraticCurveTo(0, 20, 13, 10);
    b.strokeStyle = INK4;
    b.lineWidth = 1;
    b.stroke();
    line(b, [[-19, 8], [13, 10]], "#777365", 0.55);
    line(b, [[4, 13], [24, 16]], INK4, 0.65);
  } else if (equipment2 === "javelin") {
    line(b, [[-13, 10], [20, 15]], INK4, 1.2);
    sketch(b, [[19, 13], [26, 16], [19, 17]], LIGHT);
  } else if (isStaff(equipment2) || equipment2 === "pike" || equipment2 === "pitchfork") {
    line(b, [[-25, 9], [25, 16]], INK4, 1.3);
    line(b, [[-23, 8.5], [24, 15.5]], LIGHT, 0.5);
    if (equipment2 === "pitchfork") {
      line(b, [[23, 12], [22, 19]], INK4, 1);
      for (const y of [12, 15.5, 19]) line(b, [[22, y], [30, y + 1]], INK4, 0.9);
    } else if (equipment2 === "pike") sketch(b, [[24, 14], [32, 17], [24, 18]], LIGHT);
    else ellipse(b, 26, 16, 2.6, 1.7, "transparent", INK4);
  } else if (equipment2 === "club") {
    line(b, [[5, 13], [28, 8]], INK4, 2.4);
    sketch(b, [[21, 4], [30, 2], [34, 9], [23, 12]], DARK);
  } else if (equipment2 === "pick") {
    line(b, [[5, 12], [26, 7]], INK4, 1.6);
    sketch(b, [[22, 3], [27, 5], [30, 11], [25, 7]], DARK);
  } else if (equipment2 === "greatSword") {
    line(b, [[1, 14], [13, 11]], INK4, 2);
    line(b, [[10, 8], [13, 16]], INK4, 1.4);
    sketch(b, [[13, 10], [35, 4], [40, 5], [36, 8], [14, 13]], LIGHT);
  } else {
    const axe = equipment2 === "axe";
    line(b, [[6, 13], [26, 10]], INK4, 1.5);
    if (axe) sketch(b, [[21, 9], [22, 4], [29, 5], [30, 12], [25, 13]], DARK);
    else sketch(b, [[13, 11], [29, 8], [27, 11], [13, 13]], LIGHT);
  }
}
function fallenPerson(b, kind, options, wild = false) {
  const equipment2 = options.weapon ?? loadout(kind);
  if (hasMercenaryModel(kind)) {
    paintMercenaryRemains(b, kind, options);
    weapon(b, equipment2);
    return;
  }
  const robe = options.robe ?? isStaff(loadout(kind)), heavy = kind.startsWith("ogre");
  b.save();
  if (heavy) b.scale(1.2, 1.15);
  limb(b, [[-6, -2], [-13, 1], [-17, 6]], 2.7);
  sketch(b, [[-9, -5], [-2, -7], [9, -2], [11, 4], [4, 7], [-8, 2]], options.cloth ?? (wild ? "#858976" : WASH));
  if (robe) sketch(b, [[1, -5], [18, -2], [24, 5], [9, 8], [4, 4]], options.cloth ?? "#89877c");
  else {
    limb(b, [[8, 2], [16, 4], [24, 2]], 3.6);
    limb(b, [[7, 4], [13, 9], [22, 10]], 3.3);
  }
  sketch(b, [[-9, -4], [-11, -7], [-16, -7], [-19, -4], [-17, 0], [-12, 1]], wild ? "#94927b" : LIGHT);
  limb(b, [[-5, -3], [1, 0], [-1, 6]], 2.5);
  if (kind === "worker" && options.headwear !== false) sketch(b, [[-24, 3], [-18, 1], [-14, 3], [-13, 5], [-21, 6]], "#a29577");
  if (options.shield ?? (figures[kind] ? sampleFigurePose(figures[kind], IDLE_FRAME).shield : false)) {
    if (options.shieldStyle === "round") {
      ellipse(b, -3, 11, 7, 4.5, DARK, INK4);
      ellipse(b, -3, 11, 2, 1.4, LIGHT, INK4);
    } else {
      sketch(b, [[-9, 8], [-4, 6], [3, 9], [1, 15], [-6, 14]], DARK);
      line(b, [[-7, 9], [-4, 12], [0, 10]], LIGHT, 0.65);
    }
  }
  if (wild && kind.startsWith("murloc")) sketch(b, [[9, 1], [23, -4], [19, 2], [13, 5]], DARK);
  if (wild && kind === "wildling") for (const x of [-7, -1, 5]) line(b, [[x, -5], [x - 3, -10]], INK4, 1);
  weapon(b, equipment2);
  b.restore();
}
function paintCorpse(b, kind, options = {}) {
  const card2 = UNIT_CARDS[kind], bearing = options.anatomy ?? creatureAnatomy(kind) ?? card2.art.bearing;
  b.save();
  b.lineJoin = "round";
  b.lineCap = "round";
  if (options.size !== void 0) b.scale(options.size, options.size);
  if (bearing === "vessel") {
    ellipse(b, 0, 2, 33, 9, "#7b817729");
    sketch(b, [[-31, -3], [-23, -7], [-14, -3], [-4, -6], [6, -2], [20, -5], [30, 0], [19, 8], [-18, 9]], DARK);
    for (let i = 0; i < 5; i++) line(b, [[-20 + i * 9, -2], [-24 + i * 9, 7]], LIGHT, 0.7);
    line(b, [[-19, 9], [20, -10]], INK4, 2);
    sketch(b, [[2, 0], [20, -10], [14, 0], [7, 5]], LIGHT);
    if (kind === "warship") sketch(b, [[-6, 2], [-2, -1], [5, 1], [4, 6], [-5, 6]], INK4);
  } else if (bearing === "spirit") {
    for (let i = 0; i < 5; i++) line(b, [[-17 + i * 6, 2 + i % 2], [-10 + i * 5, -3], [-6 + i * 5, 0]], "#8b8c7980", 0.7);
    ellipse(b, 0, 1, 17, 4, "#a1a59024");
  } else if (bearing === "wood") {
    sketch(b, [[-24, -5], [-14, -9], [13, -4], [24, 3], [12, 8], [-16, 5]], options.cloth ?? "#898574");
    for (const y of [-3, 1, 4]) line(b, [[-18, y], [14, y + 2]], "#625e50", 0.75);
    for (const side of [-1, 1]) {
      limb(b, [[side * 12, 3], [side * 20, 9], [side * 29, 7]], 2.5);
      limb(b, [[side * 20, 9], [side * 25, 12]], 1.7);
    }
    for (const [x, y, r] of [[-21, -7, 6], [-10, -9, 7], [-28, -3, 4]]) ellipse(b, x, y, r, r * 0.6, "#858975", INK4);
  } else if (bearing === "construct") {
    const pieces = [[-18, -3, 8], [-5, -5, 10], [9, 0, 9], [21, 5, 6], [-12, 7, 5], [2, 10, 5]];
    for (const [x, y, r] of pieces) sketch(b, [[x - r, y], [x - r * 0.4, y - r * 0.6], [x + r * 0.6, y - r * 0.35], [x + r, y + 2], [x, y + r * 0.6]], WASH);
    line(b, [[-7, -6], [-4, -2], [-8, 1]], "#b7af9666", 0.7);
  } else if (bearing === "mounted") {
    sketch(b, [[-26, -5], [-18, -10], [4, -8], [15, -3], [14, 5], [-5, 9], [-23, 6]], DARK);
    for (const x of [-18, -8, 6, 12]) limb(b, [[x, 4], [x + 7, 10], [x + 13, 9]], 2);
    sketch(b, [[10, -4], [20, -9], [26, -7], [32, -4], [29, 0], [22, 0], [15, 5]], WASH);
    line(b, [[-26, -1], [-31, 3], [-35, 2]], INK4, 1.4);
    b.save();
    b.translate(-5, -4);
    b.scale(0.72, 0.72);
    fallenPerson(b, kind, options);
    b.restore();
  } else if (bearing === "beast") {
    const shape = creatures[kind]?.shape, spider = shape === "spider", dragon = shape === "dragon";
    sketch(b, [[-19, -2], [-12, -8], [4, -7], [15, -1], [11, 6], [-5, 8], [-17, 4]], options.cloth ?? DARK);
    if (spider) {
      for (const side of [-1, 1]) for (let i = 0; i < 4; i++) limb(b, [[-11 + i * 7, side * 3], [-17 + i * 9, side * 9], [-8 + i * 6, side * 6]], 1.1);
    } else {
      sketch(b, [[12, -3], [21, -5], [26, -1], [23, 3], [13, 4]], WASH);
      for (const x of [-12, 4]) limb(b, [[x, 4], [x + 6, 10], [x + 11, 9]], 2);
      if (dragon) {
        sketch(b, [[-14, -2], [-28, -17], [-22, -16], [-11, -10], [-7, -14], [0, -9], [7, -12], [12, 1]], "#95927e");
        for (const tip of [[-22, -16], [-7, -14], [7, -12]]) line(b, [[-14, -2], tip], LIGHT, 0.6);
        sketch(b, [[-16, 3], [-29, 2], [-38, 6], [-48, 4], [-39, 9], [-26, 8], [-15, 6]], DARK);
        sketch(b, [[20, -3], [18, -8], [23, -4]], LIGHT);
      }
      if (kind === "ancientStag") for (const d of [0, 4]) line(b, [[20, -4], [16 + d, -12], [13 + d, -15], [18 + d, -13], [21 + d, -15]], INK4, 0.9);
      if (shape === "turtle") {
        sketch(b, [[-19, -2], [-12, -9], [3, -8], [13, -2], [5, 4], [-10, 5]], "#9c9985");
        line(b, [[-12, -5], [-4, -2], [-2, 3]], INK4, 0.55);
        line(b, [[-4, -2], [4, -6]], INK4, 0.55);
      }
    }
  } else fallenPerson(b, kind, options, card2.art.faction === "wild");
  options.detail?.(b);
  b.restore();
}

// src/client/art/building-models.ts
var STONE = "#dfd3b7";
var CUT = "#b8b5a0";
var WOOD = "#8b7054";
var SLATE = "#71928f";
var IRON2 = "#86948f";
var project = ([x, y, z]) => [x * 0.82 - y * 0.57, x * 0.28 + y * 0.4 - z + 19];
function tint(hex, light) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${[16, 8, 0].map((s, i) => Math.max(0, Math.min(255, Math.round((n >> s & 255) * light + (light < 0.9 ? [0, 4, 9][i] : [8, 5, 0][i]))))).join(",")})`;
}
var Construction = class {
  faces = [];
  face(p, color, normal, grain = 1) {
    this.faces.push({ p, color, normal, grain });
  }
  box(x, y, z, w, d, h, color, grain = 1) {
    const a = x - w / 2, aa = x + w / 2, bb = y + d / 2, q = y - d / 2, top = z + h;
    this.face([[a, bb, z], [aa, bb, z], [aa, bb, top], [a, bb, top]], color, [0, 1, 0], grain);
    this.face([[aa, q, z], [aa, bb, z], [aa, bb, top], [aa, q, top]], color, [1, 0, 0], grain);
    this.face([[a, q, top], [aa, q, top], [aa, bb, top], [a, bb, top]], color, [0, 0, 1], grain);
    this.face([[a, q, z], [a, q, top], [aa, q, top], [aa, q, z]], color, [0, -1, 0], grain);
    this.face([[a, q, z], [a, bb, z], [a, bb, top], [a, q, top]], color, [-1, 0, 0], grain);
    this.face([[a, q, z], [aa, q, z], [aa, bb, z], [a, bb, z]], color, [0, 0, -1], 0);
  }
  roof(x, y, z, w, d, h, color = SLATE) {
    const a = x - w / 2, aa = x + w / 2, q = y - d / 2, bb = y + d / 2;
    this.face([[a, q, z], [aa, q, z], [aa, y, z + h], [a, y, z + h]], color, [0, -0.75, 0.66]);
    this.face([[a, y, z + h], [aa, y, z + h], [aa, bb, z], [a, bb, z]], color, [0, 0.75, 0.66]);
    this.face([[aa, q, z], [aa, bb, z], [aa, y, z + h]], STONE, [1, 0, 0]);
    this.face([[a, q, z], [a, y, z + h], [a, bb, z]], STONE, [-1, 0, 0]);
    this.face([[a, q, z], [a, bb, z], [aa, bb, z], [aa, q, z]], color, [0, 0, -1]);
    for (let row = 1; row < 5; row++) {
      const t = row / 5, yy = y + d / 2 * t, zz = z + h * (1 - t) + 0.18;
      this.face([[a, yy, zz], [aa, yy, zz], [aa, yy + 0.35, zz - 0.15], [a, yy + 0.35, zz - 0.15]], "#9a9c8b", [0, 0.75, 0.66], 0);
      for (let k = 0; k < 5; k++) {
        const xx = a + (k + row % 2 * 0.5) * w / 5;
        this.face([[xx, yy, zz + 0.03], [xx + 0.35, yy, zz + 0.03], [xx + 0.35, yy + d / 10, zz - h / 5], [xx, yy + d / 10, zz - h / 5]], "#39494b", [0, 0.75, 0.66], 0);
      }
    }
    this.box(x, y, z + h - 0.5, w + 1, 1.2, 1.2, "#a6a18b", 0);
  }
  // Tapered polygonal masses give each building a legible roof/body silhouette.
  drum(x, y, z, r, h, color, n = 8, top = r) {
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n, q = (i + 1) * Math.PI * 2 / n, mid = (a + q) / 2;
      this.face([[x + Math.cos(a) * r, y + Math.sin(a) * r, z], [x + Math.cos(q) * r, y + Math.sin(q) * r, z], [x + Math.cos(q) * top, y + Math.sin(q) * top, z + h], [x + Math.cos(a) * top, y + Math.sin(a) * top, z + h]], color, [Math.cos(mid), Math.sin(mid), 0]);
    }
    this.face(Array.from({ length: n }, (_, i) => [x + Math.cos(-i * 2 * Math.PI / n) * r, y + Math.sin(-i * 2 * Math.PI / n) * r, z]), color, [0, 0, -1]);
    this.face(Array.from({ length: n }, (_, i) => [x + Math.cos(i * 2 * Math.PI / n) * top, y + Math.sin(i * 2 * Math.PI / n) * top, z + h]), color, [0, 0, 1]);
  }
  cap(x, y, z, r, h, color = SLATE, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n, q = (i + 1) * Math.PI * 2 / n, mid = (a + q) / 2;
      this.face([[x + Math.cos(a) * r, y + Math.sin(a) * r, z], [x + Math.cos(q) * r, y + Math.sin(q) * r, z], [x, y, z + h]], color, [Math.cos(mid) * 0.65, Math.sin(mid) * 0.65, 0.76]);
    }
  }
  banner(x, y, z, team) {
    this.box(x, y, 0, 0.9, 0.9, z + 2, WOOD, 0);
    this.face([[x + 0.5, y, z], [x + 9, y, z - 1], [x + 7, y, z - 8], [x + 0.5, y, z - 7]], team, [0, 1, 0], 0);
  }
  door(x, y, z, w, h) {
    const p = [[x - w / 2, y, z], [x + w / 2, y, z], [x + w / 2, y, z + h * 0.7], [x + w * 0.3, y, z + h * 0.92], [x, y, z + h], [x - w * 0.3, y, z + h * 0.92], [x - w / 2, y, z + h * 0.7]];
    this.face(p, "#303831", [0, 1, 0], 0);
    this.box(x - w / 2 - 1, y, z, 1.4, 1.4, h * 0.72, CUT);
    this.box(x + w / 2 + 1, y, z, 1.4, 1.4, h * 0.72, CUT);
    this.box(x, y + 2, 0, w + 5, 5, 1.5, CUT);
  }
  fence(x, y, w) {
    for (let i = 0; i <= 4; i++) this.box(x - w / 2 + i * w / 4, y, 0, 1.3, 1.3, 8, WOOD);
    for (const z of [3, 6]) this.box(x, y, z, w, 1, 1, WOOD);
  }
};
var BASALT = "#898b7c";
var COPPER = "#b3825d";
var BRASS = "#d2b779";
function build(kind, team) {
  const m = new Construction();
  switch (kind) {
    case "citadel": {
      m.box(0, 0, 0, 67, 56, 3, CUT);
      m.box(0, 0, 3, 55, 44, 11, BASALT);
      m.box(0, -6, 14, 30, 27, 25, STONE);
      m.roof(0, -6, 39, 36, 32, 11, SLATE);
      for (const x of [-24, 24]) for (const y of [-19, 19]) {
        m.drum(x, y, 3, 9, 30, STONE, 8);
        m.drum(x, y, 31, 10, 4, CUT, 8);
        m.cap(x, y, 35, 12, 12, SLATE);
        m.door(x, y + 9, 14, 3, 7);
      }
      m.box(0, 22, 3, 25, 7, 22, STONE);
      m.door(0, 26, 3, 11, 18);
      for (const x of [-10, 0, 10]) m.box(x, 22, 25, 5, 8, 4, CUT);
      for (const x of [-9, 9]) m.door(x, 8, 24, 3, 8);
      m.banner(-19, -8, 53, team);
      m.banner(18, -8, 51, team);
      break;
    }
    case "shop": {
      m.box(0, 0, 0, 62, 44, 2, CUT);
      m.box(-5, -8, 2, 37, 25, 23, STONE);
      m.roof(-5, -8, 25, 44, 32, 14, SLATE);
      m.box(0, 14, 2, 42, 9, 12, WOOD);
      m.box(0, 14, 14, 46, 12, 2, "#a38e6a");
      for (const x of [-24, 24]) m.box(x, 22, 0, 1.8, 1.8, 27, WOOD);
      m.face([[-25, 0, 30], [25, 0, 30], [25, 24, 25], [-25, 24, 25]], "#bcad8c", [0, 0.25, 1]);
      for (const x of [-18, -6, 6, 18]) m.face([[x - 3, 0, 30.1], [x + 3, 0, 30.1], [x + 3, 24, 25.1], [x - 3, 24, 25.1]], "#776355", [0, 0.25, 1]);
      m.box(27, -7, 0, 2, 2, 34, WOOD);
      m.box(34, -7, 31, 16, 1.5, 1.5, WOOD);
      m.box(38, -7, 20, 11, 2, 9, "#a38c59");
      m.drum(38, -5.5, 23, 2, 3, BRASS, 8);
      for (const [x, color] of [[-14, "#8e7c55"], [-3, "#536965"], [9, "#a39777"]]) m.drum(x, 13, 16, 3.5, 5, color, 8, 2);
      for (const x of [23, 31]) m.box(x, -14, 0, 7, 8, 8, WOOD);
      break;
    }
    case "camp": {
      m.box(0, 0, 0, 58, 44, 1, "#80765e");
      m.face([[-24, -17, 2], [-24, 17, 2], [-24, 0, 34]], "#b4a78a", [-1, 0, 0.5]);
      m.face([[-24, 0, 34], [22, 0, 34], [27, 20, 1], [-28, 20, 1]], "#9a8a6f", [0, 0.75, 0.65]);
      m.face([[-24, -17, 2], [22, -17, 2], [22, 0, 34], [-24, 0, 34]], "#c3b494", [0, -0.75, 0.65]);
      m.face([[22, -17, 2], [27, 20, 1], [22, 0, 34]], "#75694f", [1, 0, 0.3]);
      m.face([[25, 4, 2], [25, 14, 2], [23, 4, 23]], "#353731", [1, 0, 0]);
      for (const x of [-28, 28]) for (const y of [-25, 25]) {
        m.box(x, y, 0, 1, 1, 4, WOOD);
        m.face([[x, y, 3], [x + 0.6, y, 3], [x * 0.8, y * 0.65, 26]], "#8f8164", [0, 1, 0], 0);
      }
      m.banner(-32, 15, 38, "#8b6e49");
      m.box(30, -12, 0, 8, 10, 8, WOOD);
      m.box(-22, 28, 0, 15, 4, 3, WOOD);
      m.box(-22, 28, 3, 9, 1, 12, IRON2);
      break;
    }
    case "well": {
      m.drum(0, 0, 0, 16, 12, CUT, 10);
      m.drum(0, 0, 12, 13, 1, "#3e4848", 10);
      for (const x of [-17, 17]) m.box(x, 0, 0, 2, 2, 34, WOOD);
      m.roof(0, 0, 32, 43, 30, 10);
      break;
    }
    case "statue": {
      m.box(0, 0, 0, 28, 24, 5, CUT);
      m.box(0, 0, 5, 20, 17, 9, STONE);
      m.box(0, 0, 14, 24, 21, 3, CUT);
      for (const x of [-4, 4]) m.box(x, 0, 17, 5, 6, 16, CUT);
      m.drum(0, 0, 31, 9, 17, STONE, 5, 12);
      m.drum(0, 0, 48, 5, 8, STONE, 6);
      m.box(13, 0, 22, 1, 2, 43, IRON2);
      m.box(13, 0, 42, 9, 2, 1, IRON2);
      break;
    }
    case "beacon": {
      m.drum(0, 0, 0, 14, 6, CUT, 8);
      m.drum(0, 0, 6, 9, 35, STONE, 8, 7);
      m.drum(0, 0, 41, 13, 3, IRON2, 8);
      for (const x of [-7, 7]) m.box(x, 0, 44, 1, 1, 12, IRON2);
      m.cap(0, 0, 56, 15, 8, SLATE, 8);
      m.drum(0, 0, 45, 5, 9, "#c39b60", 8);
      break;
    }
    case "fort-wall": {
      m.box(0, 0, 0, 66, 22, 4, CUT);
      m.box(0, 0, 4, 62, 15, 24, STONE);
      for (let x = -27; x < 30; x += 12) m.box(x, 0, 28, 8, 18, 7, CUT);
      m.banner(-20, 0, 39, team);
      break;
    }
    case "fort-lance":
    case "fort-flame":
    case "fort-mortar":
    case "fort-ward": {
      m.box(0, 0, 0, 56, 44, 4, CUT);
      m.drum(0, 0, 4, 23, 23, STONE, 6, 21);
      m.drum(0, 0, 27, 27, 4, CUT, 6);
      m.door(0, 20, 5, 10, 16);
      if (kind === "fort-lance") {
        m.box(0, 0, 31, 7, 8, 14, WOOD);
        m.box(0, 0, 44, 51, 3, 3, IRON2);
        m.box(5, 0, 44, 3, 39, 3, WOOD);
        m.box(0, 15, 43, 1, 27, 1, "#d8cdb5");
      } else if (kind === "fort-mortar") {
        m.drum(0, 0, 31, 12, 6, IRON2, 8);
        m.drum(0, 0, 37, 10, 12, IRON2, 8, 7);
        m.drum(0, 0, 49, 6, 1, "#242c31", 8);
        for (const x of [-21, 21]) m.box(x, 0, 31, 5, 28, 10, CUT);
      } else if (kind === "fort-flame") {
        m.drum(0, 0, 31, 15, 9, "#946d44", 8);
        m.cap(0, 0, 40, 10, 17, "#d19d5c", 6);
        for (const x of [-22, 22]) m.box(x, 0, 31, 3, 4, 17, IRON2);
      } else {
        for (const x of [-16, 16]) m.box(x, 0, 31, 4, 4, 19, CUT);
        m.cap(0, 0, 50, 24, 12, SLATE, 6);
        m.drum(0, 0, 32, 10, 3, "#7ca1a4", 8);
      }
      m.banner(-28, 10, 40, team);
      break;
    }
    case "townHall": {
      m.box(0, 3, 0, 58, 45, 2.5, CUT);
      m.box(-21, -5, 2, 17, 26, 17, STONE);
      m.roof(-21, -5, 19, 22, 31, 11);
      m.drum(3, -5, 2, 21, 25, STONE);
      m.drum(3, -5, 25, 22, 2, WOOD);
      m.cap(3, -5, 27, 26, 18);
      m.drum(3, -5, 44, 4, 5, BRASS, 6);
      m.cap(3, -5, 49, 6, 7);
      m.door(3, 15, 3, 10, 16);
      for (const x of [-9, 15]) m.box(x, 23, 2, 2, 2, 16, WOOD);
      m.roof(3, 20, 18, 29, 16, 6);
      m.banner(-24, 18, 33, team);
      break;
    }
    case "barracks": {
      m.box(0, 0, 0, 55, 43, 2, CUT);
      m.box(0, -12, 2, 49, 16, 19, STONE);
      m.roof(0, -12, 21, 54, 21, 9);
      for (const x of [-23, 23]) {
        m.box(x, 13, 2, 11, 14, 24, CUT);
        m.box(x, 13, 26, 14, 17, 2, STONE);
        for (const a of [-4, 4]) for (const d of [-5, 5]) m.box(x + a, 13 + d, 28, 3.5, 4, 4, STONE);
      }
      m.box(0, 18, 2, 36, 3, 12, STONE);
      m.door(0, 19.6, 2, 12, 12);
      m.box(0, 18, 15, 36, 4, 2, WOOD);
      m.banner(-15, 20, 29, team);
      break;
    }
    case "archeryRange": {
      m.box(0, 0, 0, 54, 42, 1.5, "#968465");
      for (const x of [-24, 24]) for (const y of [-17, 2]) m.box(x, y, 0, 1.8, 1.8, 21, WOOD);
      m.roof(0, -8, 22, 56, 25, 8, "#a49776");
      for (const x of [-16, 0, 16]) {
        m.box(x, 14, 0, 1.3, 2, 13, WOOD);
        const ring = (r, z, color) => m.face(Array.from({ length: 10 }, (_, i) => [x + Math.cos(i * Math.PI / 5) * r, 15 + z, 13 + Math.sin(i * Math.PI / 5) * r]), color, [0, 1, 0], 0);
        ring(6, 0, "#c3af76");
        ring(3.8, 0.1, "#6d6853");
        ring(1.7, 0.2, team);
      }
      m.box(-25, 4, 0, 4, 10, 9, WOOD);
      break;
    }
    case "stables": {
      m.box(0, -8, 0, 54, 23, 2, CUT);
      m.box(0, -17, 2, 51, 3, 18, STONE);
      for (const x of [-25, -9, 9, 25]) m.box(x, 2, 2, 2.3, 3, 18, WOOD);
      m.box(0, 2, 18, 53, 3, 2.5, WOOD);
      m.roof(0, -8, 21, 60, 29, 10, "#737465");
      for (const x of [-16, 0, 16]) m.box(x, -4, 3, 11, 7, 7, "#494b3d");
      m.fence(0, 24, 54);
      m.box(-26, 13, 0, 1.5, 20, 6, WOOD);
      m.box(20, 14, 0, 9, 9, 7, "#b6a273");
      m.banner(-24, 4, 31, team);
      break;
    }
    case "farm": {
      m.drum(-12, -7, 0, 14, 29, STONE, 6, 9);
      m.cap(-12, -7, 29, 14, 12, "#8f7c58", 6);
      m.door(-12, 3, 0, 6, 11);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2, ux = Math.cos(a), uz = Math.sin(a), cx = -12, cz = 26;
        m.face([[cx + ux * 3, 6, cz + uz * 3], [cx + ux * 21, 6, cz + uz * 21], [cx + ux * 21 - uz * 4, 6, cz + uz * 21 + ux * 4], [cx + ux * 5 - uz * 2, 6, cz + uz * 5 + ux * 2]], "#b4a180", [0, 1, 0]);
      }
      m.box(14, 12, 0, 25, 28, 1, "#817354");
      for (let row = 0; row < 4; row++) m.box(14, 2 + row * 6, 1, 24, 2, 3, "#baaa79");
      m.fence(15, 28, 27);
      break;
    }
    case "workshop": {
      m.box(-8, -5, 0, 33, 32, 3, CUT);
      m.box(-8, -9, 3, 30, 20, 17, STONE);
      m.roof(-8, -9, 21, 36, 28, 12);
      for (const x2 of [-23, 8]) m.box(x2, 15, 0, 2, 2, 14, WOOD);
      m.roof(-8, 10, 14, 36, 19, 4, "#8d8064");
      m.box(-7, 12, 2, 21, 8, 6, WOOD);
      const x = 21, y = 3, z = 14;
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6, q = (i + 1) * Math.PI / 6;
        m.face([[x, y + Math.cos(a) * 14, z + Math.sin(a) * 14], [x, y + Math.cos(q) * 14, z + Math.sin(q) * 14], [x, y + Math.cos(q) * 10, z + Math.sin(q) * 10], [x, y + Math.cos(a) * 10, z + Math.sin(a) * 10]], WOOD, [1, 0, 0]);
        if (i % 2 === 0) m.face([[x, y, z], [x, y + Math.cos(a) * 13, z + Math.sin(a) * 13], [x, y + Math.cos(a + 0.12) * 13, z + Math.sin(a + 0.12) * 13]], BRASS, [1, 0, 0]);
      }
      m.box(12, 0, 0, 6, 8, 15, CUT);
      break;
    }
    case "defenseTower": {
      m.drum(0, 0, 0, 14, 21, CUT, 6, 11);
      for (const x of [-9, 9]) for (const y of [-9, 9]) m.box(x, y, 20, 2, 2, 23, WOOD);
      m.box(0, 0, 29, 29, 29, 3, WOOD);
      for (const x of [-13, 13]) m.box(x, 0, 32, 1.5, 28, 5, WOOD);
      m.box(0, 13, 32, 27, 1.5, 5, WOOD);
      m.cap(0, 0, 43, 22, 12, SLATE, 4);
      m.banner(-12, 13, 34, team);
      break;
    }
    case "sanctum": {
      m.drum(0, 0, 0, 28, 3, CUT);
      m.drum(0, 0, 3, 21, 24, STONE);
      m.drum(0, 0, 27, 24, 3, BRASS);
      m.drum(0, 0, 30, 21, 10, SLATE, 10, 13);
      m.cap(0, 0, 40, 13, 8);
      for (const [x, y] of [[-21, -8], [15, -17], [14, 18]]) {
        m.drum(x, y, 0, 5, 33, CUT, 4, 3);
        m.cap(x, y, 33, 4, 7, BRASS, 4);
      }
      m.door(-4, 20, 3, 8, 17);
      m.drum(0, 0, 48, 2, 5, BRASS, 6);
      break;
    }
    case "moonWell": {
      m.drum(0, 0, 0, 29, 3, CUT, 12);
      m.drum(0, 0, 3, 24, 4, STONE, 12);
      m.drum(0, 0, 7, 20, 0.2, "#709c97", 12);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + i * Math.PI / 5, x = Math.cos(a) * 24, y = Math.sin(a) * 24;
        m.drum(x, y, 0, 3.5, 22 + Math.sin(i * Math.PI / 4) * 12, CUT, 4, 2.5);
        m.cap(x, y, 22 + Math.sin(i * Math.PI / 4) * 12, 4, 5, SLATE, 4);
      }
      m.box(0, 25, 0, 14, 10, 2, CUT);
      break;
    }
    case "shipyard": {
      m.box(0, -26, 0, 66, 17, 5, STONE);
      for (const x of [-26, 26]) {
        for (let i = 0; i < 10; i++) m.box(x, -16 + i * 5, 3, 13, 4.7, 2.5, WOOD);
        for (const y of [-16, 4, 25]) {
          m.drum(x, y, -5, 2.7, 9, WOOD, 8);
          m.drum(x, y, 4, 3.1, 1, IRON2, 8);
        }
        m.box(x, 31, 3, 14, 3, 3, CUT);
      }
      m.box(-11, -27, 5, 35, 16, 20, STONE);
      m.roof(-11, -27, 25, 40, 22, 12, "#647b77");
      for (const x of [-28, 6]) m.box(x, -17, 5, 2, 2, 22, WOOD);
      m.door(-13, -18.8, 5, 8, 15);
      m.box(1, -18.7, 14, 5, 0.5, 6, "#26312b");
      m.box(17, -23, 5, 13, 15, 3, WOOD);
      m.box(17, -23, 8, 10, 10, 4, WOOD);
      for (const x of [-21, 21]) m.box(x, 4, 5, 3, 3, 32, WOOD);
      m.box(0, 4, 35, 48, 4, 4, WOOD);
      m.drum(4, 4, 28, 2.5, 6, BRASS, 8);
      m.box(4, 4, 13, 0.6, 0.6, 15, IRON2);
      m.box(4, 4, 11, 4, 2, 2, IRON2);
      m.box(0, 0, 5, 5, 32, 2, WOOD);
      for (let i = 0; i < 6; i++) {
        const y = -12 + i * 5, w = 5 + Math.sin(i * Math.PI / 5) * 6;
        m.face([[-w, y, 14], [-w * 0.6, y, 7], [w * 0.6, y, 7], [w, y, 14], [w - 1.5, y, 14], [w * 0.45, y, 8.5], [-w * 0.45, y, 8.5], [-w + 1.5, y, 14]], "#a18c67", [0, 1, 0]);
      }
      m.drum(24, -16, 5, 3.8, 7, WOOD, 8);
      m.drum(24, -16, 7, 4, 0.8, IRON2, 8);
      m.box(-27, -8, 5, 6, 7, 6, WOOD);
      m.banner(-23, -22, 37, team);
      break;
    }
    case "emberForge": {
      m.drum(0, 0, 0, 29, 4, BASALT, 8);
      m.drum(0, 0, 4, 23, 20, BASALT, 8, 18);
      m.cap(0, 0, 24, 22, 10, COPPER, 8);
      for (const [x, y, h] of [[-14, -9, 45], [2, -13, 53], [17, -6, 39]]) {
        m.drum(x, y, 10, 4, h - 10, BASALT, 6, 3);
        m.drum(x, y, h, 5, 2, IRON2, 6);
      }
      m.door(0, 21, 4, 12, 12);
      m.face([[-4, 21.1, 5], [4, 21.1, 5], [3, 21.1, 12], [-3, 21.1, 12]], "#cf9054", [0, 1, 0], 0);
      for (const x of [-18, 18]) m.box(x, 18, 0, 5, 7, 18, IRON2);
      break;
    }
    case "cinderSpire": {
      m.drum(0, 0, 0, 23, 5, BASALT, 6);
      m.drum(0, 0, 5, 15, 34, BASALT, 6, 8);
      m.drum(0, 0, 39, 16, 4, IRON2, 6);
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        m.drum(Math.cos(a) * 11, Math.sin(a) * 11, 36, 3, 22, COPPER, 4, 1);
      }
      m.drum(0, 0, 43, 4, 8, "#bc8754", 6, 7);
      m.cap(0, 0, 51, 7, 10, "#d2aa72", 6);
      break;
    }
    case "ashenHall": {
      m.box(0, 0, 0, 57, 43, 4, BASALT);
      m.box(0, -6, 4, 40, 27, 24, BASALT);
      m.roof(0, -6, 28, 46, 32, 13, COPPER);
      for (const x of [-23, 23]) {
        m.drum(x, 9, 0, 10, 34, BASALT, 4, 7);
        m.cap(x, 9, 34, 10, 10, IRON2, 4);
      }
      m.box(0, 18, 3, 34, 5, 21, BASALT);
      m.door(0, 21, 3, 13, 18);
      m.box(0, 18, 25, 36, 9, 3, COPPER);
      m.banner(-18, 22, 37, team);
      break;
    }
    case "emberShrine": {
      m.drum(0, 0, 0, 28, 3, BASALT, 6);
      m.drum(0, 0, 3, 19, 7, COPPER, 6, 23);
      m.drum(0, 0, 10, 19, 1, "#513f32", 8);
      m.cap(0, 0, 11, 8, 17, "#cc9154", 5);
      for (const [x, y, h] of [[-22, -7, 31], [11, -21, 39], [18, 18, 23]]) {
        m.drum(x, y, 0, 5, h, BASALT, 4, 3);
        m.cap(x, y, h, 4, 7, COPPER, 4);
      }
      break;
    }
  }
  return m;
}
function paintBuildingModel(b, kind, team) {
  const m = build(kind, team);
  m.faces = m.faces.filter((f) => f.normal[0] * 0.57 + f.normal[1] * 0.82 + f.normal[2] * 0.8 > -0.01);
  b.save();
  b.lineJoin = "round";
  const feet = m.faces.flatMap((f) => f.p.filter((p) => p[2] <= 3).map(([x, y]) => project([x, y, 0])));
  const hull = groundHull(feet);
  if (hull.length > 2) {
    polygon(b, hull.map(([x, y], i) => [x * 1.14 + (noise(i) - 0.5) * 2, 19 + (y - 19) * 1.2]), "#a59c7424", "transparent", 0);
    polygon(b, hull.map(([x, y]) => [x * 1.035, 19 + (y - 19) * 1.045]), "#59624b30", "transparent", 0);
  }
  b.beginPath();
  for (const f of m.faces) {
    const p = f.p.map(([x, y, z]) => project([x + z * 0.45, y + z * 0.3, 0]));
    p.forEach(([x, y], i) => i ? b.lineTo(x, y) : b.moveTo(x, y));
    b.closePath();
  }
  b.fillStyle = "#56686b20";
  b.fill();
  m.faces.sort((a, z) => {
    const gap = depth(a) - depth(z);
    return Math.abs(gap) > 1e-3 ? gap : height(a) - height(z);
  });
  for (const f of m.faces) {
    const p = f.p.map(project);
    const light = 0.66 + Math.max(0, -f.normal[0] * 0.35 + f.normal[1] * 0.45 + f.normal[2] * 0.82) * 0.39;
    const fill = tint(f.color, light);
    polygon(b, p, fill, darker(f.color, 0.18), 0.38);
    if (light > 1 && (f.color === IRON2 || f.color === SLATE || f.color === CUT)) {
      let edge = 0;
      for (let i = 1; i < p.length; i++) if (p[i][1] + p[(i + 1) % p.length][1] < p[edge][1] + p[(edge + 1) % p.length][1]) edge = i;
      line(b, [p[edge], p[(edge + 1) % p.length]], f.color === IRON2 ? "#eee3c4b0" : "#e5d7b369", 0.7);
    }
    if (f.normal[2] === 0) {
      const foot = f.p.filter((p2) => p2[2] === 0);
      if (foot.length === 2) line(b, foot.map(project), "#69705b99", 0.75);
    }
    if (f.grain) {
      b.save();
      b.clip();
      const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
      const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX, h = Math.max(...ys) - minY;
      for (let i = 0; i < Math.min(50, w * h / 13); i++) {
        const x = minX + noise(i + f.p[0][0] * 13) * w, y = minY + noise(i * 3.7 + f.p[0][1] * 17) * h;
        line(b, [[x, y], [x + 1 + noise(i + 7) * 2, y - 0.35]], i % 3 ? "#fff4d91a" : "#5862530b", 0.55);
      }
      b.restore();
    }
  }
  b.restore();
}
function depth(f) {
  return f.p.reduce((sum, [x, y]) => sum + x * 0.6 + y * 0.8, 0) / f.p.length;
}
function height(f) {
  return f.p.reduce((sum, p) => sum + p[2], 0) / f.p.length;
}
function noise(x) {
  const v = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}
function groundHull(points) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (ps) => {
    const h = [];
    for (const p of ps) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// src/client/art/warfare-units.ts
var ink = "#252f34";
var wood = "#77634c";
var metal = "#7d9298";
var ivory = "#d9d0b6";
function plate(b, p, color) {
  polygon(b, p, color, ink, 0.8);
  line(b, p.slice(0, 2), "#e3d4ad88", 0.7);
}
function ship(id) {
  return { shadow: "none", paint(b, team) {
    const lineShip = id === "lineShip";
    if (lineShip) {
      b.save();
      b.scale(0.84, 0.84);
    }
    const heavy = id === "bombard" || id === "frigate", w = id === "cutter" ? 32 : lineShip ? 61 : id === "carrier" ? 54 : 45;
    ellipse(b, 0, 17, w + 3, 8, "#c9ded533");
    line(b, [[-w - 5, 18], [-w / 2, 25], [w / 2, 24], [w + 5, 14]], "#d3e1d799", 1);
    plate(b, [[-w, 0], [-w + 12, 17], [w - 12, 19], [w, -1], [12, 6]], "#4b443c");
    plate(b, [[-w, 0], [-w + 20, -13], [w - 12, -11], [w, -1], [12, 6]], wood);
    for (let y = -4; y < 11; y += 4)
      line(b, [[-w + 14, y], [w - 12, y - 2]], "#b19b7166", 0.8);
    if (id === "transport" || id === "carrier") {
      for (let x = id === "carrier" ? -35 : -20; x <= (id === "carrier" ? 35 : 20); x += 13)
        plate(b, [[x, -3], [x + 10, -3], [x + 10, 6], [x, 6]], "#998365");
    }
    if (id === "fireship") {
      for (let x = -20; x <= 18; x += 13) {
        ellipse(b, x, 0, 5, 6, "#45352a");
        plate(b, [[x - 3, -1], [x - 2, -20], [x + 3, -10], [x + 5, -2]], "#c8843c");
      }
    } else if (lineShip) {
      plate(b, [[-57, -5], [-53, -21], [-34, -20], [-27, -7]], "#67513b");
      for (const [x, height2] of [[-29, 48], [1, 60], [30, 43]]) {
        line(b, [[x, 3], [x, -height2]], ink, 2.5);
        line(b, [[x - 14, -height2 + 7], [x + 15, -height2 + 6]], "#a48c64", 2);
        plate(b, [[x - 13, -height2 + 8], [x + 14, -height2 + 7], [x + 12, -height2 + 29], [x - 10, -height2 + 29]], ivory);
        line(b, [[x, -height2], [x - 22, 1]], "#968d7544", 0.7);
      }
      plate(b, [[1, -63], [17, -59], [1, -55]], team);
      for (const x of [-33, -11, 11, 33]) {
        plate(b, [[x - 5, 7], [x + 5, 7], [x + 5, 14], [x - 5, 14]], "#242b2d");
        line(b, [[x, 9], [x + 6, 13]], metal, 3);
        plate(b, [[x - 5, -5], [x + 4, -5], [x + 4, 0], [x - 5, 0]], "#353332");
      }
      line(b, [[-47, 15], [47, 12]], "#c3a673", 1.5);
    } else {
      line(b, [[0, 4], [0, -49]], ink, 3);
      line(b, [[-0.8, 4], [-0.8, -49]], "#b4a482", 1);
      plate(b, [[2, -45], [30, -35], [34, -9], [2, -13]], ivory);
      plate(b, [[-3, -43], [-22, -10], [-3, -15]], "#a5aa9e");
      plate(b, [[0, -51], [18, -46], [0, -40]], team);
      line(b, [[14, -40], [18, -15]], "#978d7544", 1);
    }
    if (heavy) {
      for (let x = -23; x <= 23; x += 23) {
        plate(b, [[x - 5, 3], [x + 4, 3], [x + 9, -5], [x, -6]], metal);
        line(b, [[x + 4, -3], [x + 17, -8]], "#30383a", 4);
        line(b, [[x + 4, -4], [x + 17, -9]], "#a8b4b1", 1);
      }
    }
    if (lineShip) b.restore();
  } };
}
function paintSiege(b, team, id, pose) {
  const motion = sampleMotion(pose, "siege");
  b.save();
  b.translate(-motion.recoil * 5, 0);
  ellipse(b, 0, 18, 30, 6, "#252c3033");
  for (const x of [-21, 20]) {
    ellipse(b, x, 12, 7, 10, "#343432");
    ellipse(b, x, 12, 4, 7, "#998773");
    b.save();
    b.translate(x, 12);
    b.rotate(pose.mode === "walk" ? pose.frame / 8 * Math.PI * 2 : 0);
    line(b, [[0, -7], [0, 7]], "#433c32", 1.2);
    line(b, [[-5, 0], [5, 0]], "#433c32", 1.2);
    b.restore();
  }
  plate(b, [[-28, 5], [-22, -6], [25, -6], [30, 7], [8, 14]], wood);
  if (id === "ram") {
    plate(b, [[-28, 0], [-18, -25], [20, -25], [30, 0]], "#839090");
    plate(b, [[-18, -25], [-10, -31], [28, -26], [20, -25]], metal);
    line(b, [[-31, 2], [42, -4]], "#403d35", 9);
    line(b, [[-31, -1], [42, -7]], "#a89675", 2);
    plate(b, [[36, -11], [45, -7], [45, 1], [36, 2]], metal);
  } else if (id === "mortar") {
    for (const x of [-12, 12])
      line(b, [[x, 6], [x - 5, -33]], "#3e3931", 5);
    line(b, [[-22, -37], [34, -14]], "#b19a70", 5);
    line(b, [[-22, -37], [-12, -15]], "#424746", 9);
    line(b, [[34, -14], [36, -5]], ivory, 1);
  } else if (id === "ballista") {
    line(b, [[-18, 2], [34, -14]], "#b29b70", 4);
    line(b, [[20, -33], [31, -16], [30, 6]], metal, 3);
    line(b, [[20, -33], [4, -5], [30, 6]], ivory, 0.8);
    line(b, [[-16, 4], [43, -16]], "#d5d5c4", 1.5);
  } else
    for (let i = 0; i < 5; i++) {
      line(b, [[-12, i * 4 - 12], [34, i * 4 - 24]], "#343b3d", 4);
      line(b, [[-12, i * 4 - 13], [34, i * 4 - 25]], metal, 1);
    }
  plate(b, [[-21, 0], [-11, -3], [-11, 7], [-21, 9]], team);
  b.restore();
}
var shipPainters = /* @__PURE__ */ new Map();
var isSiege = (id) => id === "ram" || id === "mortar" || id === "ballista" || id === "organ";
function shipPainter(id) {
  let painter = shipPainters.get(id);
  if (!painter) {
    painter = ship(id).paint;
    shipPainters.set(id, painter);
  }
  return painter;
}
var MODEL_IDS = { transport: "transport", warship: "frigate", shipOfTheLine: "lineShip", cutter: "cutter", bombardShip: "bombard", fireShip: "fireship", carrier: "carrier", siegeRam: "ram", ballista: "ballista", catapult: "mortar", organGun: "organ" };
var hasWarfareUnit = (kind) => MODEL_IDS[kind] !== void 0;
function paintWarfareUnit(b, kind, team, pose) {
  const id = MODEL_IDS[kind];
  if (!id)
    return false;
  if (isSiege(id)) paintSiege(b, team, id, pose);
  else shipPainter(id)(b, team);
  return true;
}

// src/client/art/painted-units.ts
function face2(b, kind, team, facing, headwear = true, clothOverride) {
  paintedPlane(b, [[-3, -34], [-2, -38], [2, -38.5], [4, -35], [3.7, -30.5], [1, -28.7], [-2.7, -31]], SKIN);
  paintedPlane(b, [[1, -37], [3, -36], [4, -33], [3, -30], [0.8, -29.5]], "#84634e", "transparent", 0);
  line(b, [[2, -34], [4.2, -34]], "#35322d", 0.7);
  if (!headwear) return;
  if (kind.armor) {
    paintedPlane(b, [[-4, -33], [-3.5, -39], [-0.6, -41], [3.4, -39.4], [4.5, -34], [1, -35], [-1, -32]], kind.ember ? "#716d65" : STEEL);
    paintedPlane(b, [[-3.1, -38.8], [-0.6, -40], [1, -38], [0.2, -34.4], [-3, -33.8]], facing === 1 ? EDGE : SHADE, "transparent", 0);
    line(b, [[1, -35], [4.2, -35]], INK2, 1);
    if (kind.ember) {
      paintedPlane(b, [[1, -35], [5, -35], [4, -29], [1, -28]], "#5b5650");
      line(b, [[2, -33], [4, -33]], "#ba9d73", 0.65);
    }
    if (kind.elite) {
      paintedPlane(b, [[-4, -35], [-3, -29], [-0.5, -28], [1, -34]], SHADE);
      line(b, [[-1, -40], [-2, -45], [-7, -47], [-12, -46]], team, 2);
    } else line(b, [[-5, -34], [-1, -35], [5, -34]], "#b4b8ab", 1);
  } else if (kind.role === "worker") {
    paintedPlane(b, [[-4, -36], [-3, -40], [2, -40], [4, -36]], "#9f8556");
    paintedPlane(b, [[-7, -35], [-3, -37], [3, -36.7], [7, -34.5], [1, -33.5]], "#c2a46c");
  } else if (kind.role === "priest") {
    paintedPlane(b, [[-3.5, -35], [-3, -41], [0, -44], [3, -41], [4, -35]], kind.ember ? "#9e7054" : LINEN);
    line(b, [[0, -42], [0, -36]], "#ad9362", 0.8);
  } else {
    const cloth = clothOverride ?? (kind.role === "witch" ? "#625666" : darker(team, 0.28));
    paintedPlane(b, [[-5, -28], [-5, -37], [-1, -42], [3, -40], [5, -34], [3.7, -30], [2, -37], [-0.5, -38], [-2.6, -35], [-2.3, -29]], cloth);
    line(b, [[-4.3, -36], [-1, -40], [2, -39]], lighter(cloth, 0.2), 0.8);
    if (kind.role === "witch") paintedPlane(b, [[-4, -40], [-2, -47], [2, -46], [1, -40]], cloth);
  }
}
function mount(b, team, phase, elite, facing) {
  const coat = elite ? "#85847b" : "#685243";
  for (const [x, off] of [[-17, 0], [14, Math.PI], [-12, Math.PI], [19, 0]]) {
    const s = Math.sin(phase + off) * 5;
    segment(b, [x, 0], [x + s * 0.4, 8], 2.6, darker(coat, 0.25), false);
    segment(b, [x + s * 0.4, 8], [x + s, 16 - Math.max(0, s) * 0.4], 2, coat, true);
    line(b, [[x + s - 1.5, 17 - Math.max(0, s) * 0.4], [x + s + 2, 17 - Math.max(0, s) * 0.4]], INK2, 2);
  }
  line(b, [[-22, -5], [-28, 2], [-30, 8]], "#35322d", 3);
  paintedPlane(b, [[-24, -11], [-15, -17], [8, -16], [20, -10], [17, 2], [-16, 3], [-23, -2]], coat);
  paintedPlane(b, [[-20, -12], [-13, -15], [7, -14], [14, -10], [-14, -7]], lighter(coat, 0.2), "transparent", 0);
  paintedPlane(b, [[10, -10], [13, -27], [20, -36], [25, -34], [26, -30], [33, -25], [33, -20], [28, -19], [23, -23], [23, -9]], coat);
  paintedPlane(b, [[14, -26], [20, -34], [21, -28], [17, -14]], facing === 1 ? lighter(coat, 0.25) : darker(coat, 0.2), "transparent", 0);
  line(b, [[19, -33], [15, -26], [12, -15]], "#35322d", 3);
  paintedPlane(b, [[20, -35], [20, -42], [24, -35]], coat);
  line(b, [[25, -27], [28, -26]], INK2, 1);
  line(b, [[25, -28], [28, -20], [33, -22]], "#b6a582", 1);
  line(b, [[29, -22], [12, -17], [1, -16]], HIDE, 1);
  paintedPlane(b, [[-17, -13], [6, -14], [11, -3], [7, 8], [-16, 6], [-20, 1]], darker(team, 0.15));
  line(b, [[-17, 4], [6, 6], [9, 0]], "#b5a176", 1);
  if (elite) {
    paintedPlane(b, [[21, -34], [25, -30], [26, -27], [23, -25], [19, -29]], STEEL);
    line(b, [[20, -33], [23, -30]], EDGE, 1);
  }
}
function paintFigure(b, kind, team, pose, facing, presentation = {}) {
  if (hasWarfareUnit(kind)) return paintWarfareUnit(b, kind, team, pose);
  if (hasMercenaryModel(kind)) return paintMercenary(b, kind, team, pose, facing, presentation);
  const base = figures[kind];
  if (!base) return paintCreature(b, kind, team, pose);
  const f = presentation.appearance ? { ...base, ...presentation.appearance } : base;
  b.save();
  b.lineJoin = "round";
  b.lineCap = "round";
  const rig = sampleFigurePose(f, pose, presentation);
  const { motion, impact } = rig;
  const stride = motion.stride;
  const phase = pose.mode === "walk" ? pose.frame * Math.PI / 4 : 0;
  const robe = ["priest", "mage", "witch"].includes(f.role);
  const armor = !!f.armor;
  const cloth = presentation.cloth ?? (f.role === "witch" ? "#5d5061" : f.role === "priest" ? f.ember ? "#a78265" : LINEN : darker(team, 0.13));
  if (f.mounted) {
    mount(b, team, phase, !!f.elite, facing);
    b.translate(-3, -17);
    b.scale(0.84, 0.84);
  }
  const bob = motion.lift + motion.breathe + rig.bodyDrop;
  if (!f.mounted) {
    leg(b, [-3, -4 + rig.bodyDrop], [-4 - stride * 3, 5 + rig.bodyDrop * 0.4], [-5 - stride * 5, 16 - Math.max(0, stride) * 2.2], armor, false);
    leg(b, [3, -4 + rig.bodyDrop], [5 + stride * 2, 5 + rig.bodyDrop * 0.4], [6 + stride * 5, 16 - Math.max(0, -stride) * 2.2], armor, facing === 1);
  }
  b.translate(impact * (f.mounted ? 0.65 : 2), bob);
  b.translate(0, -4);
  b.rotate(rig.lean);
  b.translate(0, 4);
  const flutter = stride * 1.4 + impact * 2;
  if (robe || f.elite || f.role === "bow") {
    paintedPlane(b, [[-7, -25], [4, -25], [1, 0], [-6 + flutter, 11], [-14 + flutter, 10], [-11, -7]], darker(cloth, 0.3));
    line(b, [[-8, -21], [-10, 6], [-6 + flutter, 9]], lighter(cloth, 0.08), 1);
  }
  paintEquipment(b, f, team, facing, rig, cloth, "back");
  if (rig.equipmentLayer === "back") presentation.detail?.(b, rig, "equipment");
  paintedPlane(b, [[-2.2, -31], [2, -31], [2.5, -26], [-2.5, -26]], SKIN);
  paintedPlane(b, [[-6, -12], [6, -12], [7, -2], [3, 1], [-6, -1]], HIDE);
  if (robe) {
    paintedPlane(b, [[-6, -18], [6, -18], [7, 0], [11 + flutter, 15], [3, 16], [-2, 13], [-10 + flutter, 15], [-7, -2]], cloth);
    paintedPlane(b, [[2, -15], [5, -14], [6, 1], [9 + flutter, 14], [4, 13]], darker(cloth, 0.3), "transparent", 0);
    line(b, [[-4, -9], [-5, 3], [-7 + flutter, 12]], lighter(cloth, 0.23), 1);
    line(b, [[-8 + flutter, 14], [-2, 12], [3, 15], [9 + flutter, 14]], "#aa9472", 0.8);
  }
  paintedPlane(b, [[-7, -25], [-2, -28], [4, -27], [7, -23], [5, -10], [-5, -9], [-7, -17]], armor ? STEEL : cloth);
  paintedPlane(b, [[1, -26], [6, -23], [5, -11], [1, -10]], armor ? SHADE : darker(cloth, 0.3), "transparent", 0);
  line(b, [[-5, -23], [-3, -25], [0, -25]], armor ? EDGE : lighter(cloth, 0.3), 1.2);
  if (armor) {
    if (f.elite) {
      paintedPlane(b, [[-10, -27], [-4, -29], [-3, -22], [-10, -20]], f.ember ? "#837563" : STEEL);
      paintedPlane(b, [[4, -28], [10, -26], [11, -21], [5, -22]], SHADE);
    }
    paintedPlane(b, [[-8, -26], [-3, -25], [-4, -20], [-9, -21]], facing === 1 ? EDGE : SHADE);
    line(b, [[-5, -16], [0, -14], [5, -16]], "#b2b5a7", 0.65);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
      const x = -4 + col * 1.8 + row % 2 * 0.45, y = -13 + row * 1.25;
      line(b, [[x, y], [x + 0.6, y + 0.5], [x + 1, y]], row % 2 ? "#495653" : "#bdbaa5", 0.45);
    }
    line(b, [[-4, -22], [-3, -18], [0, -16]], "#c8cbbb", 0.75);
    for (const x of [-3, 3]) ellipse(b, x, -18, 0.45, 0.5, "#d1c7a9");
    paintedPlane(b, [[-5, -10], [5, -10], [7, -2], [1, -3], [-5, -1]], darker(team, 0.1));
    for (const x of [-3, 1, 4]) line(b, [[x, -9], [x + 1, -3]], "#83938e", 0.5);
  } else if (f.role === "bow" || f.role === "worker") {
    paintedPlane(b, [[-5, -25], [-1, -26], [4, -11], [1, -10]], HIDE);
    line(b, [[-4, -24], [2, -12]], "#b29c77", 0.7);
  }
  line(b, [[-6, -10], [5, -10]], "#493f33", 2.1);
  paintedPlane(b, [[-1, -11], [1, -11], [1, -9], [-1, -9]], "#b6a079");
  if (f.mounted) leg(b, [1, -5], [5, 3], [6, 12], armor, true);
  presentation.detail?.(b, rig, "body");
  face2(b, f, team, facing, presentation.headwear, presentation.cloth);
  presentation.detail?.(b, rig, "head");
  paintEquipment(b, f, team, facing, rig, cloth, "front");
  if (rig.equipmentLayer === "front") presentation.detail?.(b, rig, "equipment");
  b.restore();
  return true;
}

// canvas-route-proof:atlas-before
var sprites = new RasterCache();
var canvasArtCacheStats = () => sprites.stats();
var clearCanvasArtCache = () => {
  sprites.clear();
  clearFittedPortraits();
};
function sprite(c, key, point, scale, paint, mirrored = false, tileSize = 128) {
  const density = Math.max(2, Math.min(6, Math.ceil(scale * brushZoom(c) * 2)));
  const art = sprites.get(key, density, paint, tileSize);
  const width = art.canvas.width / density * scale, height2 = art.canvas.height / density * scale;
  if (!mirrored) {
    c.drawImage(art.canvas, point.x + art.x * scale, point.y + art.y * scale, width, height2);
    return;
  }
  c.save();
  c.translate(point.x, point.y);
  c.scale(-1, 1);
  c.drawImage(art.canvas, art.x * scale, art.y * scale, width, height2);
  c.restore();
}
function brushZoom(c) {
  const transform = c.getTransform();
  return Math.hypot(transform.a, transform.b);
}
function drawAtlasBuilding(c, kind, point, size, color) {
  sprite(c, `b:${kind}:${color}`, point, size / 64, (b) => {
    paintBuildingModel(b, kind, color);
  });
}
function drawAtlasBuildingPortrait(c, kind, size, color) {
  if (drawModelPortrait(c, `buildings/${kind}`, 0, 0, size, color)) return;
  drawFittedPortrait(c, `building:${kind}:${color}`, (b) => paintBuildingModel(b, kind, color), 0, 0, size, size);
}
function drawAtlasUnit(c, kind, point, scale, color, facing = 1, pose = IDLE_FRAME, presentation = {}) {
  sprite(c, `painted:${kind}:${color}:${facing}:${animationKey(pose)}:${appearanceKey(presentation)}`, point, scale, (b) => {
    const mounted = UNIT_CARDS[kind].art.bearing === "mounted";
    const broad = mounted || UNIT_CARDS[kind].art.bearing !== "foot";
    const feet = creatureShadow(kind);
    if (unitMover(kind) !== "sea") {
      ellipse(b, 3, feet?.y ?? 18, feet ? feet.rx * 1.12 : broad ? 29 : 14, feet ? feet.ry * 1.2 : broad ? 6 : 4.5, "#29282418");
      ellipse(b, 1, feet?.y ?? 17, feet?.rx ?? (broad ? 24 : 10), feet?.ry ?? (broad ? 4.5 : 2.8), "#29282438");
    }
    paintFigure(b, kind, color, pose, facing, presentation);
  }, facing === -1, actionPaintSize(pose, kind));
}
function drawAtlasUnitPortrait(c, kind, x, y, size, color, presentation = {}) {
  if (isShipKind(kind) && drawModelPortrait(c, `ships/${kind}`, x, y, size, color)) return;
  const bust = UNIT_CARDS[kind].art.bearing === "foot";
  drawFittedPortrait(c, `portrait:${kind}:${color}:${appearanceKey(presentation)}`, (b) => {
    paintFigure(b, kind, color, IDLE_FRAME, 1, presentation);
  }, x, y, size, size, bust, actionPaintSize(IDLE_FRAME, kind));
}
function drawAtlasUnitFigure(c, kind, width, height2, color, presentation = {}) {
  drawFittedPortrait(c, `figure:${kind}:${color}:${appearanceKey(presentation)}`, (b) => {
    paintFigure(b, kind, color, IDLE_FRAME, 1, presentation);
  }, 0, 0, width, height2, false, actionPaintSize(IDLE_FRAME, kind));
}
function drawAtlasModel(c, key, model, point, scale, color, facing = 1, pose = IDLE_FRAME, presentation = {}) {
  sprite(c, `m:${key}:${color}:${facing}:${animationKey(pose)}:${appearanceKey(presentation)}`, point, scale, (b) => {
    const shadow = model.shadow ?? "foot";
    if (shadow === "foot") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (shadow === "mounted") ellipse(b, 2, 17, 22, 5.5, "#30483630");
    else if (shadow === "beast") ellipse(b, 2, 15, 20, 5, "#30483630");
    else if (shadow === "huge") ellipse(b, 2, 18, 30, 8, "#30483638");
    model.paint(b, color, pose, facing, presentation);
  }, facing === -1, model.paint.paintSize?.(pose) ?? actionPaintSize(pose));
}
function drawAtlasProp(c, key, paint, point, scale, flip = false) {
  sprite(c, `p:${key}`, point, scale, paint, flip);
}
function drawAtlasMine(c, point) {
  sprite(c, "gold-mine", point, 1, paintMine);
}
function drawAtlasCamp(c, point, size = 1) {
  sprite(c, "mercenary-camp", point, size, (b) => paintBuildingModel(b, "camp", "#8b7355"));
}
function drawAtlasShop(c, point, size = 1) {
  sprite(c, "shop", point, size, (b) => paintBuildingModel(b, "shop", "#8b7355"));
}
var PAPER_BASE = "#ddd5bb";
var groundTile;
function drawAtlasGround(c, width, height2, camera) {
  if (!groundTile) {
    groundTile = createScratchCanvas(512, 512);
    const b = groundTile.getContext("2d");
    b.fillStyle = PAPER_BASE;
    b.fillRect(0, 0, 512, 512);
    let seed = 19027;
    const random = () => {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < 7e3; i++) {
      b.fillStyle = i % 2 ? "#7f8b6805" : "#fff8e720";
      b.fillRect(random() * 512, random() * 512, 1, 1);
    }
    for (let i = 0; i < 42; i++) {
      const x = 8 + random() * 496, y = 8 + random() * 496;
      line(b, [[x - 3, y], [x - 4, y - 3], [x, y + 1], [x + 1, y - 4]], "#7c8d671c", 0.8);
    }
  }
  const offsetX = (-camera.x % 512 + 512) % 512 - 512;
  const offsetY = (-camera.y % 512 + 512) % 512 - 512;
  for (let x = offsetX; x < width; x += 512) for (let y = offsetY; y < height2; y += 512) c.drawImage(groundTile, x, y, 512.35, 512.35);
}
function drawAtlasCorpse(c, kind, point, scale, variant = 0, model, modelKey = "", color = "#77766e", presentation = {}) {
  c.save();
  c.translate(point.x, point.y + 7);
  c.rotate((variant % 3 - 1) * 0.14);
  sprite(c, `corpse:${kind}:${modelKey}:${color}:${corpseAppearanceKey(presentation)}`, { x: 0, y: 0 }, scale, (b) => model?.remains ? model.remains(b, color, presentation) : paintCorpse(b, kind, presentation), variant % 2 === 1);
  c.restore();
}

// canvas-route-proof:atlas-candidate
var atlas_candidate_exports = {};
__export(atlas_candidate_exports, {
  PAPER_BASE: () => PAPER_BASE2,
  canvasArtCacheStats: () => canvasArtCacheStats2,
  clearCanvasArtCache: () => clearCanvasArtCache2,
  drawAtlasBuilding: () => drawAtlasBuilding2,
  drawAtlasBuildingPortrait: () => drawAtlasBuildingPortrait2,
  drawAtlasCamp: () => drawAtlasCamp2,
  drawAtlasCorpse: () => drawAtlasCorpse2,
  drawAtlasGround: () => drawAtlasGround2,
  drawAtlasLandmark: () => paintLandmark,
  drawAtlasMine: () => drawAtlasMine2,
  drawAtlasModel: () => drawAtlasModel2,
  drawAtlasObstacle: () => paintObstacle,
  drawAtlasProp: () => drawAtlasProp2,
  drawAtlasShop: () => drawAtlasShop2,
  drawAtlasTree: () => paintTree,
  drawAtlasUnit: () => drawAtlasUnit2,
  drawAtlasUnitFigure: () => drawAtlasUnitFigure2,
  drawAtlasUnitPortrait: () => drawAtlasUnitPortrait2,
  obstacleArtTop: () => obstacleArtTop
});

// src/client/art/paint-identity.ts
var SIEGE = /* @__PURE__ */ new Set(["siegeRam", "ballista", "catapult", "organGun"]);
var IDLE_KEY = "idle:0:0:0";
function unitPaintKey(kind, team, pose, variant) {
  let color = team, action = animationKey(pose);
  if (variant === void 0) {
    const stock = (!!figures[kind] || !!creatures[kind]) && !hasWarfareUnit(kind);
    if (stock && pose.mode === "idle") {
      const frame = pose.frame === 4 ? 0 : pose.frame === 3 ? 1 : pose.frame === 7 ? 5 : pose.frame;
      if (frame !== pose.frame) action = action.replace(`idle:${pose.frame}:`, `idle:${frame}:`);
    }
    if (creatures[kind] && !figures[kind] && !hasWarfareUnit(kind)) color = "intrinsic";
    if (SIEGE.has(kind)) action = pose.mode === "attack" && pose.frame < 5 ? `attack:${pose.frame}:0:0` : pose.mode === "walk" ? `walk:${pose.frame}:0:0` : IDLE_KEY;
  }
  return `${kind}:${color}:${action}:${variant ?? ""}`;
}

// canvas-route-proof:portrait-candidate
var FittedPortraitCache2 = class {
  constructor(budget = 12 * 1024 * 1024, limit = 96) {
    this.budget = budget;
    this.limit = limit;
  }
  budget;
  limit;
  cache = /* @__PURE__ */ new Map();
  work = [];
  leased = /* @__PURE__ */ new Map();
  retired = /* @__PURE__ */ new Set();
  epoch = 0;
  retire(canvas) {
    if (this.leased.has(canvas)) this.retired.add(canvas);
    else canvas.width = canvas.height = 1;
  }
  lease(canvas) {
    this.leased.set(canvas, (this.leased.get(canvas) ?? 0) + 1);
  }
  release(canvas) {
    const count = this.leased.get(canvas) ?? 0;
    if (count > 1) {
      this.leased.set(canvas, count - 1);
      return;
    }
    this.leased.delete(canvas);
    if (this.retired.delete(canvas)) this.retire(canvas);
  }
  draw(ctx, key, paint, x, y, width, height2, bust = false, domain = 128) {
    const workSize = domain * 4;
    let art = this.cache.get(key), source;
    const epoch = this.epoch;
    try {
      if (!art) {
        const reusable = this.work.findIndex((canvas) => canvas.width === workSize);
        source = reusable < 0 ? createScratchCanvas(workSize, workSize) : this.work.splice(reusable, 1)[0];
        this.lease(source);
        const brush = source.getContext("2d");
        if (typeof brush.reset === "function") brush.reset();
        else source.width = workSize;
        brush.translate(workSize / 2, workSize / 2);
        brush.scale(4, 4);
        paint(brush);
        const data = brush.getImageData(0, 0, workSize, workSize).data;
        const bounds = (limit = workSize) => {
          let left = workSize, top = workSize, right = 0, bottom = 0;
          for (let py = 0; py < limit; py++) for (let px = 0; px < workSize; px++) if (data[(py * workSize + px) * 4 + 3] > 8) {
            left = Math.min(left, px);
            right = Math.max(right, px);
            top = Math.min(top, py);
            bottom = Math.max(bottom, py);
          }
          return { x: left, y: top, width: Math.max(1, right - left + 1), height: Math.max(1, bottom - top + 1) };
        };
        let box = bounds();
        if (bust) box = bounds(Math.round(box.y + box.height * 0.65));
        const cropped = createScratchCanvas(box.width, box.height);
        this.lease(cropped);
        art = { canvas: cropped, x: 0, y: 0, width: box.width, height: box.height };
        cropped.getContext("2d").drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
        const prior = this.cache.get(key);
        if (epoch === this.epoch && prior) {
          this.cache.delete(key);
          this.retire(prior.canvas);
        }
        let pixels = [...this.cache.values()].reduce((sum, value) => sum + value.width * value.height, 0);
        const cost = box.width * box.height;
        while (epoch === this.epoch && this.cache.size && (this.cache.size >= this.limit || pixels + cost > this.budget)) {
          const oldest = this.cache.keys().next().value, value = this.cache.get(oldest);
          pixels -= value.width * value.height;
          this.cache.delete(oldest);
          this.retire(value.canvas);
        }
        if (epoch === this.epoch && cost <= this.budget && this.limit > 0) this.cache.set(key, art);
        else this.retire(cropped);
      } else this.lease(art.canvas);
      const scale = Math.min(width / art.width, height2 / art.height) * 0.94, w = art.width * scale, h = art.height * scale;
      ctx.drawImage(art.canvas, art.x, art.y, art.width, art.height, x + (width - w) / 2, y + (height2 - h) / 2, w, h);
    } finally {
      if (art) {
        if (this.cache.get(key) !== art) this.retire(art.canvas);
        this.release(art.canvas);
      }
      if (source) {
        this.release(source);
        if (epoch === this.epoch && this.work.length < 4) this.work.push(source);
        else this.retire(source);
      }
    }
  }
  clear() {
    this.epoch++;
    for (const art of this.cache.values()) this.retire(art.canvas);
    for (const canvas of this.work) this.retire(canvas);
    this.cache.clear();
    this.work.length = 0;
  }
  stats() {
    const cached = new Set([...this.cache.values()].map((art) => art.canvas));
    const owned = /* @__PURE__ */ new Set([...cached, ...this.work, ...this.leased.keys(), ...this.retired]);
    const bytes = (canvases) => {
      let n = 0;
      for (const canvas of canvases) n += canvas.width * canvas.height * 4;
      return n;
    };
    return { entries: this.cache.size, cacheBytes: bytes(cached), workCanvases: this.work.length, workBytes: bytes(this.work), leasedCanvases: this.leased.size, leasedBytes: bytes(this.leased.keys()), retiredCanvases: this.retired.size, retiredBytes: bytes(this.retired), ownedCanvasBytes: bytes(owned) };
  }
};
var portraits2 = new FittedPortraitCache2();
var drawFittedPortrait2 = portraits2.draw.bind(portraits2);
var clearFittedPortraits2 = () => portraits2.clear();
var fittedPortraitStats2 = () => portraits2.stats();

// canvas-route-proof:atlas-candidate
var sprites2 = new RasterCache();
var canvasArtCacheStats2 = () => sprites2.stats();
var clearCanvasArtCache2 = () => {
  sprites2.clear();
  clearFittedPortraits2();
};
function catalogPaintKey(kind, color, pose, presentation) {
  return Object.getPrototypeOf(presentation) === Object.prototype && Reflect.ownKeys(presentation).length === 0 ? unitPaintKey(kind, color, pose) : void 0;
}
function sprite2(c, key, point, scale, paint, mirrored = false, tileSize = 128) {
  const density = Math.max(2, Math.min(6, Math.ceil(scale * brushZoom2(c) * 2)));
  const art = sprites2.get(key, density, paint, tileSize);
  const width = art.canvas.width / density * scale, height2 = art.canvas.height / density * scale;
  if (!mirrored) {
    c.drawImage(art.canvas, point.x + art.x * scale, point.y + art.y * scale, width, height2);
    return;
  }
  c.save();
  c.translate(point.x, point.y);
  c.scale(-1, 1);
  c.drawImage(art.canvas, art.x * scale, art.y * scale, width, height2);
  c.restore();
}
function brushZoom2(c) {
  const transform = c.getTransform();
  return Math.hypot(transform.a, transform.b);
}
function drawAtlasBuilding2(c, kind, point, size, color) {
  sprite2(c, `b:${kind}:${color}`, point, size / 64, (b) => {
    paintBuildingModel(b, kind, color);
  });
}
function drawAtlasBuildingPortrait2(c, kind, size, color) {
  if (drawModelPortrait(c, `buildings/${kind}`, 0, 0, size, color)) return;
  drawFittedPortrait2(c, `building:${kind}:${color}`, (b) => paintBuildingModel(b, kind, color), 0, 0, size, size);
}
function drawAtlasUnit2(c, kind, point, scale, color, facing = 1, pose = IDLE_FRAME, presentation = {}) {
  const shared = catalogPaintKey(kind, color, pose, presentation);
  const key = shared === void 0 ? `painted:${kind}:${color}:${facing}:${animationKey(pose)}:${appearanceKey(presentation)}` : `painted:${shared}:${facing}:${appearanceKey(presentation)}`;
  sprite2(c, key, point, scale, (b) => {
    const mounted = UNIT_CARDS[kind].art.bearing === "mounted";
    const broad = mounted || UNIT_CARDS[kind].art.bearing !== "foot";
    const feet = creatureShadow(kind);
    if (unitMover(kind) !== "sea") {
      ellipse(b, 3, feet?.y ?? 18, feet ? feet.rx * 1.12 : broad ? 29 : 14, feet ? feet.ry * 1.2 : broad ? 6 : 4.5, "#29282418");
      ellipse(b, 1, feet?.y ?? 17, feet?.rx ?? (broad ? 24 : 10), feet?.ry ?? (broad ? 4.5 : 2.8), "#29282438");
    }
    paintFigure(b, kind, color, pose, facing, presentation);
  }, facing === -1, actionPaintSize(pose, kind));
}
function drawAtlasUnitPortrait2(c, kind, x, y, size, color, presentation = {}) {
  if (isShipKind(kind) && drawModelPortrait(c, `ships/${kind}`, x, y, size, color)) return;
  const bust = UNIT_CARDS[kind].art.bearing === "foot";
  const shared = catalogPaintKey(kind, color, IDLE_FRAME, presentation);
  const key = shared === void 0 ? `portrait:${kind}:${color}:${appearanceKey(presentation)}` : `portrait:${shared}:${appearanceKey(presentation)}`;
  drawFittedPortrait2(c, key, (b) => {
    paintFigure(b, kind, color, IDLE_FRAME, 1, presentation);
  }, x, y, size, size, bust, actionPaintSize(IDLE_FRAME, kind));
}
function drawAtlasUnitFigure2(c, kind, width, height2, color, presentation = {}) {
  const shared = catalogPaintKey(kind, color, IDLE_FRAME, presentation);
  const key = shared === void 0 ? `figure:${kind}:${color}:${appearanceKey(presentation)}` : `figure:${shared}:${appearanceKey(presentation)}`;
  drawFittedPortrait2(c, key, (b) => {
    paintFigure(b, kind, color, IDLE_FRAME, 1, presentation);
  }, 0, 0, width, height2, false, actionPaintSize(IDLE_FRAME, kind));
}
function drawAtlasModel2(c, key, model, point, scale, color, facing = 1, pose = IDLE_FRAME, presentation = {}) {
  sprite2(c, `m:${key}:${color}:${facing}:${animationKey(pose)}:${appearanceKey(presentation)}`, point, scale, (b) => {
    const shadow = model.shadow ?? "foot";
    if (shadow === "foot") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (shadow === "mounted") ellipse(b, 2, 17, 22, 5.5, "#30483630");
    else if (shadow === "beast") ellipse(b, 2, 15, 20, 5, "#30483630");
    else if (shadow === "huge") ellipse(b, 2, 18, 30, 8, "#30483638");
    model.paint(b, color, pose, facing, presentation);
  }, facing === -1, model.paint.paintSize?.(pose) ?? actionPaintSize(pose));
}
function drawAtlasProp2(c, key, paint, point, scale, flip = false) {
  sprite2(c, `p:${key}`, point, scale, paint, flip);
}
function drawAtlasMine2(c, point) {
  sprite2(c, "gold-mine", point, 1, paintMine);
}
function drawAtlasCamp2(c, point, size = 1) {
  sprite2(c, "mercenary-camp", point, size, (b) => paintBuildingModel(b, "camp", "#8b7355"));
}
function drawAtlasShop2(c, point, size = 1) {
  sprite2(c, "shop", point, size, (b) => paintBuildingModel(b, "shop", "#8b7355"));
}
var PAPER_BASE2 = "#ddd5bb";
var groundTile2;
function drawAtlasGround2(c, width, height2, camera) {
  if (!groundTile2) {
    groundTile2 = createScratchCanvas(512, 512);
    const b = groundTile2.getContext("2d");
    b.fillStyle = PAPER_BASE2;
    b.fillRect(0, 0, 512, 512);
    let seed = 19027;
    const random = () => {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < 7e3; i++) {
      b.fillStyle = i % 2 ? "#7f8b6805" : "#fff8e720";
      b.fillRect(random() * 512, random() * 512, 1, 1);
    }
    for (let i = 0; i < 42; i++) {
      const x = 8 + random() * 496, y = 8 + random() * 496;
      line(b, [[x - 3, y], [x - 4, y - 3], [x, y + 1], [x + 1, y - 4]], "#7c8d671c", 0.8);
    }
  }
  const offsetX = (-camera.x % 512 + 512) % 512 - 512;
  const offsetY = (-camera.y % 512 + 512) % 512 - 512;
  for (let x = offsetX; x < width; x += 512) for (let y = offsetY; y < height2; y += 512) c.drawImage(groundTile2, x, y, 512.35, 512.35);
}
function drawAtlasCorpse2(c, kind, point, scale, variant = 0, model, modelKey = "", color = "#77766e", presentation = {}) {
  c.save();
  c.translate(point.x, point.y + 7);
  c.rotate((variant % 3 - 1) * 0.14);
  sprite2(c, `corpse:${kind}:${modelKey}:${color}:${corpseAppearanceKey(presentation)}`, { x: 0, y: 0 }, scale, (b) => model?.remains ? model.remains(b, color, presentation) : paintCorpse(b, kind, presentation), variant % 2 === 1);
  c.restore();
}
export {
  actionPaintSize,
  appearanceKey,
  atlas_before_exports as before,
  atlas_candidate_exports as candidate,
  creatures,
  figures,
  fittedPortraitStats as portraitStatsBefore,
  fittedPortraitStats2 as portraitStatsCandidate
};
