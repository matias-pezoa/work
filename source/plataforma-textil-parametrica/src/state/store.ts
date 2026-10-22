/**
 * Estado global de la app (Zustand).
 *
 * Guarda SOLO parametros que generan geometria, nunca las mallas resultantes.
 * Cada modulo de geometria las deriva de aca con funciones puras.
 */
import { create } from 'zustand'
import * as THREE from 'three'
import { DEFAULT_SPIKE_FIELD, type SpikeFieldParams } from '../geometry/spikeField'
import {
  DEFAULT_WAVE_FIELD,
  type CurveRibs,
  type WaveFieldParams,
} from '../geometry/waveField'
import {
  DEFAULT_LASER,
  LASER_MATERIALS,
  type LaserFamily,
  type LaserNumericKey,
  type LaserParams,
} from '../geometry/laserCut'
import { fitBoundaryToWidth, rescaleBoundary, type Vec2 } from '../geometry/polygon'
import type { ImportedBoundary } from '../io/importSvg'
import {
  applyAttractorPatch,
  createAttractor,
  createCurveAttractor,
  type Attractor,
  type AttractorPatch,
  type CombineMode,
} from '../geometry/attractionField'

export type AppMode = 'volume' | 'wave' | 'laser'
export type GizmoMode = 'translate' | 'rotate'

/** Campos numericos de SpikeFieldParams editables desde la UI. */
export type FieldNumericKey = Exclude<keyof SpikeFieldParams, 'combine' | 'alignToField'>
/** Campos numericos de WaveFieldParams editables desde la UI. */
export type WaveNumericKey = Exclude<keyof WaveFieldParams, 'combine' | 'curveRibs'>

/**
 * Base personalizada importada (p. ej. una pieza de patron), compartida entre
 * los modos 3D. `outer`/`holes` ya estan centrados en el origen y en mm.
 */
export interface BaseShapeState {
  outer: Vec2[]
  holes: Vec2[][]
  widthMm: number
  heightMm: number
  fileName: string
}

export interface AppState {
  mode: AppMode

  // --- Base personalizada (importada), compartida entre Volumen y Ondas ---
  baseShape: BaseShapeState | null

  // --- Modo Volumen: campo de puas desde un plano ---
  field: SpikeFieldParams
  attractors: Attractor[]
  selectedAttractorId: string | null

  // --- Modo Ondas: panel corrugado desde un plano ---
  wave: WaveFieldParams
  waveAttractors: Attractor[]
  selectedWaveAttractorId: string | null

  // --- Modo Corte laser: cortes y calados 2D sobre la pieza plana ---
  laser: LaserParams
  /** Atractores propios del modo, siempre sobre el plano (y = 0). */
  laserAttractors: Attractor[]
  selectedLaserAttractorId: string | null

  /**
   * Punto de control seleccionado del atractor seleccionado del modo activo
   * (0 para un atractor punto). Lo comparten el gizmo/vista, el panel y la
   * tecla Supr. Se reinicia al cambiar de atractor o de modo.
   */
  selectedPointIndex: number | null

  /** Gizmo 3D del punto activo: mover o rotar (rotar solo aplica a puntos del modo Ondas). */
  gizmoMode: GizmoMode

  // acciones
  setMode: (m: AppMode) => void
  setGizmoMode: (m: GizmoMode) => void
  setFieldParam: (key: FieldNumericKey, value: number) => void
  setCombine: (mode: CombineMode) => void
  toggleAlignToField: () => void

  addAttractor: (position: [number, number, number]) => void
  addAttractorCurve: (points: readonly [number, number, number][]) => void
  updateAttractor: (id: string, patch: AttractorPatch) => void
  removeAttractor: (id: string) => void
  selectAttractor: (id: string | null, pointIndex?: number | null) => void

  setWaveParam: (key: WaveNumericKey, value: number) => void
  setWaveCombine: (mode: CombineMode) => void
  setWaveCurveRibs: (curveRibs: CurveRibs) => void
  addWaveAttractor: (position: [number, number, number]) => void
  addWaveAttractorCurve: (points: readonly [number, number, number][]) => void
  updateWaveAttractor: (id: string, patch: AttractorPatch) => void
  removeWaveAttractor: (id: string) => void
  selectWaveAttractor: (id: string | null, pointIndex?: number | null) => void

  setLaserParam: (key: LaserNumericKey, value: number) => void
  setLaserFamily: (family: LaserFamily) => void
  setLaserMaterial: (materialId: string) => void
  setLaserCombine: (mode: CombineMode) => void
  toggleLaserAlign: () => void
  addLaserAttractor: (position: [number, number, number]) => void
  addLaserAttractorCurve: (points: readonly [number, number, number][]) => void
  updateLaserAttractor: (id: string, patch: AttractorPatch) => void
  removeLaserAttractor: (id: string) => void
  selectLaserAttractor: (id: string | null, pointIndex?: number | null) => void

  setBaseShape: (imported: ImportedBoundary, widthMm: number, fileName: string) => void
  setBaseShapeWidthMm: (widthMm: number) => void
  clearBaseShape: () => void

  reset: () => void
}

function toVec3s(points: readonly [number, number, number][]): THREE.Vector3[] {
  return points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
}

function initialAttractors(): Attractor[] {
  return [
    createAttractor(new THREE.Vector3(0, 5, 2), {
      radius: 12,
      strength: 1,
      falloff: 'gaussian',
    }),
    createAttractor(new THREE.Vector3(-9, 3, -7), {
      radius: 8,
      strength: 0.65,
      falloff: 'linear',
    }),
    createCurveAttractor(
      toVec3s([
        [6, 3, -8],
        [9, 3, 0],
        [6, 3, 8],
      ]),
      { radius: 5, strength: 0.8, falloff: 'linear', smooth: [true] },
    ),
  ]
}

function initialWaveAttractors(): Attractor[] {
  return [
    createAttractor(new THREE.Vector3(-3, 3, -2), {
      radius: 9,
      strength: 1,
      falloff: 'linear',
    }),
    createAttractor(new THREE.Vector3(5, 3, 4), {
      radius: 7,
      strength: 0.8,
      falloff: 'linear',
    }),
    createCurveAttractor(
      toVec3s([
        [-8, 3, 6],
        [0, 3, 9],
        [8, 3, 6],
      ]),
      { radius: 4, strength: 0.9, falloff: 'linear', smooth: [true] },
    ),
  ]
}

/** Atractores del modo Corte laser, en u3d (1u = 1cm) sobre y = 0: pieza de 300x200mm. */
function initialLaserAttractors(): Attractor[] {
  return [
    createAttractor(new THREE.Vector3(-6, 0, -2), {
      radius: 9,
      strength: 1,
      falloff: 'gaussian',
    }),
    createAttractor(new THREE.Vector3(8, 0, 4), {
      radius: 6,
      strength: 0.8,
      falloff: 'linear',
    }),
    createCurveAttractor(
      toVec3s([
        [-13, 0, 7],
        [0, 0, 3],
        [13, 0, 7],
      ]),
      { radius: 3.5, strength: 0.9, falloff: 'linear', smooth: [true] },
    ),
  ]
}

/** El campo del modo laser es 2D: todo atractor vive en y = 0. */
function flatten(
  points: readonly [number, number, number][],
): [number, number, number][] {
  return points.map(([x, , z]) => [x, 0, z])
}

/** Proyecta al plano y = 0 las posiciones de un parche (modo laser). */
function flattenPatch(patch: AttractorPatch): AttractorPatch {
  return {
    ...patch,
    position: patch.position && new THREE.Vector3(patch.position.x, 0, patch.position.z),
    points: patch.points?.map((p) => new THREE.Vector3(p.x, 0, p.z)),
  }
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'volume',
  baseShape: null,
  field: { ...DEFAULT_SPIKE_FIELD },
  attractors: initialAttractors(),
  selectedAttractorId: null,

  wave: { ...DEFAULT_WAVE_FIELD },
  waveAttractors: initialWaveAttractors(),
  selectedWaveAttractorId: null,

  laser: { ...DEFAULT_LASER },
  laserAttractors: initialLaserAttractors(),
  selectedLaserAttractorId: null,
  selectedPointIndex: null,
  gizmoMode: 'translate',

  setMode: (mode) => set({ mode, selectedPointIndex: null, gizmoMode: 'translate' }),

  setGizmoMode: (gizmoMode) => set({ gizmoMode }),

  setFieldParam: (key, value) => set((s) => ({ field: { ...s.field, [key]: value } })),

  setCombine: (combine) => set((s) => ({ field: { ...s.field, combine } })),

  toggleAlignToField: () =>
    set((s) => ({ field: { ...s.field, alignToField: !s.field.alignToField } })),

  addAttractor: (position) =>
    set((s) => {
      const a = createAttractor(new THREE.Vector3(position[0], position[1], position[2]))
      return {
        attractors: [...s.attractors, a],
        selectedAttractorId: a.id,
        selectedPointIndex: 0,
      }
    }),

  addAttractorCurve: (points) =>
    set((s) => {
      const a = createCurveAttractor(toVec3s(points), { smooth: [true] })
      return {
        attractors: [...s.attractors, a],
        selectedAttractorId: a.id,
        selectedPointIndex: 0,
      }
    }),

  updateAttractor: (id, patch) =>
    set((s) => ({
      attractors: s.attractors.map((a) =>
        a.id === id ? applyAttractorPatch(a, patch) : a,
      ),
    })),

  removeAttractor: (id) =>
    set((s) => ({
      attractors: s.attractors.filter((a) => a.id !== id),
      selectedAttractorId: s.selectedAttractorId === id ? null : s.selectedAttractorId,
      selectedPointIndex: s.selectedAttractorId === id ? null : s.selectedPointIndex,
    })),

  selectAttractor: (selectedAttractorId, pointIndex = null) =>
    set({
      selectedAttractorId,
      selectedPointIndex: selectedAttractorId ? pointIndex : null,
    }),

  setWaveParam: (key, value) => set((s) => ({ wave: { ...s.wave, [key]: value } })),

  setWaveCombine: (combine) => set((s) => ({ wave: { ...s.wave, combine } })),

  setWaveCurveRibs: (curveRibs) => set((s) => ({ wave: { ...s.wave, curveRibs } })),

  addWaveAttractor: (position) =>
    set((s) => {
      const a = createAttractor(new THREE.Vector3(position[0], position[1], position[2]))
      return {
        waveAttractors: [...s.waveAttractors, a],
        selectedWaveAttractorId: a.id,
        selectedPointIndex: 0,
      }
    }),

  addWaveAttractorCurve: (points) =>
    set((s) => {
      const a = createCurveAttractor(toVec3s(points), { smooth: [true] })
      return {
        waveAttractors: [...s.waveAttractors, a],
        selectedWaveAttractorId: a.id,
        selectedPointIndex: 0,
      }
    }),

  updateWaveAttractor: (id, patch) =>
    set((s) => ({
      waveAttractors: s.waveAttractors.map((a) =>
        a.id === id ? applyAttractorPatch(a, patch) : a,
      ),
    })),

  removeWaveAttractor: (id) =>
    set((s) => ({
      waveAttractors: s.waveAttractors.filter((a) => a.id !== id),
      selectedWaveAttractorId:
        s.selectedWaveAttractorId === id ? null : s.selectedWaveAttractorId,
      selectedPointIndex: s.selectedWaveAttractorId === id ? null : s.selectedPointIndex,
    })),

  selectWaveAttractor: (selectedWaveAttractorId, pointIndex = null) =>
    set({
      selectedWaveAttractorId,
      selectedPointIndex: selectedWaveAttractorId ? pointIndex : null,
    }),

  setLaserParam: (key, value) => set((s) => ({ laser: { ...s.laser, [key]: value } })),

  setLaserFamily: (family) => set((s) => ({ laser: { ...s.laser, family } })),

  setLaserMaterial: (materialId) =>
    set((s) => {
      const m = LASER_MATERIALS.find((mat) => mat.id === materialId)
      if (!m) return s
      return {
        laser: { ...s.laser, materialId, kerfMm: m.kerfMm, minBridgeMm: m.minBridgeMm },
      }
    }),

  setLaserCombine: (combine) => set((s) => ({ laser: { ...s.laser, combine } })),

  toggleLaserAlign: () =>
    set((s) => ({ laser: { ...s.laser, alignToField: !s.laser.alignToField } })),

  addLaserAttractor: (position) =>
    set((s) => {
      const a = createAttractor(new THREE.Vector3(position[0], 0, position[2]))
      return {
        laserAttractors: [...s.laserAttractors, a],
        selectedLaserAttractorId: a.id,
        selectedPointIndex: 0,
      }
    }),

  addLaserAttractorCurve: (points) =>
    set((s) => {
      const a = createCurveAttractor(toVec3s(flatten(points)), { smooth: [true] })
      return {
        laserAttractors: [...s.laserAttractors, a],
        selectedLaserAttractorId: a.id,
        selectedPointIndex: 0,
      }
    }),

  updateLaserAttractor: (id, patch) =>
    set((s) => ({
      laserAttractors: s.laserAttractors.map((a) =>
        a.id === id ? applyAttractorPatch(a, flattenPatch(patch)) : a,
      ),
    })),

  removeLaserAttractor: (id) =>
    set((s) => ({
      laserAttractors: s.laserAttractors.filter((a) => a.id !== id),
      selectedLaserAttractorId:
        s.selectedLaserAttractorId === id ? null : s.selectedLaserAttractorId,
      selectedPointIndex: s.selectedLaserAttractorId === id ? null : s.selectedPointIndex,
    })),

  selectLaserAttractor: (selectedLaserAttractorId, pointIndex = null) =>
    set({
      selectedLaserAttractorId,
      selectedPointIndex: selectedLaserAttractorId ? pointIndex : null,
    }),

  setBaseShape: (imported, widthMm, fileName) => {
    const fitted = fitBoundaryToWidth(imported.outer, imported.holes, widthMm)
    set({
      baseShape: {
        outer: fitted.outer,
        holes: fitted.holes,
        widthMm: fitted.widthMm,
        heightMm: fitted.heightMm,
        fileName,
      },
    })
  },

  setBaseShapeWidthMm: (widthMm) =>
    set((s) => {
      if (!s.baseShape || widthMm <= 0) return s
      const factor = widthMm / s.baseShape.widthMm
      const scaled = rescaleBoundary(s.baseShape.outer, s.baseShape.holes, factor)
      return {
        baseShape: {
          ...s.baseShape,
          outer: scaled.outer,
          holes: scaled.holes,
          widthMm: s.baseShape.widthMm * factor,
          heightMm: s.baseShape.heightMm * factor,
        },
      }
    }),

  clearBaseShape: () => set({ baseShape: null }),

  reset: () =>
    set({
      mode: 'volume',
      baseShape: null,
      field: { ...DEFAULT_SPIKE_FIELD },
      attractors: initialAttractors(),
      selectedAttractorId: null,
      wave: { ...DEFAULT_WAVE_FIELD },
      waveAttractors: initialWaveAttractors(),
      selectedWaveAttractorId: null,
      laser: { ...DEFAULT_LASER },
      laserAttractors: initialLaserAttractors(),
      selectedLaserAttractorId: null,
      selectedPointIndex: null,
      gizmoMode: 'translate',
    }),
}))
