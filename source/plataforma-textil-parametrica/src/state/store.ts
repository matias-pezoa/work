/**
 * Estado global de la app (Zustand).
 *
 * Guarda SOLO parametros que generan geometria, nunca las mallas resultantes.
 * Cada modulo de geometria las deriva de aca con funciones puras.
 */
import { create } from 'zustand'
import * as THREE from 'three'
import { DEFAULT_SPIKE_FIELD, type SpikeFieldParams } from '../geometry/spikeField'
import { DEFAULT_WAVE_FIELD, type WaveFieldParams } from '../geometry/waveField'
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

/** Campos numericos de SpikeFieldParams editables desde la UI. */
export type FieldNumericKey = Exclude<keyof SpikeFieldParams, 'combine' | 'alignToField'>
/** Campos numericos de WaveFieldParams editables desde la UI. */
export type WaveNumericKey = Exclude<keyof WaveFieldParams, 'combine'>

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

  // acciones
  setMode: (m: AppMode) => void
  setFieldParam: (key: FieldNumericKey, value: number) => void
  setCombine: (mode: CombineMode) => void
  toggleAlignToField: () => void

  addAttractor: (position: [number, number, number]) => void
  addAttractorCurve: (points: readonly [number, number, number][]) => void
  updateAttractor: (id: string, patch: AttractorPatch) => void
  removeAttractor: (id: string) => void
  selectAttractor: (id: string | null) => void

  setWaveParam: (key: WaveNumericKey, value: number) => void
  setWaveCombine: (mode: CombineMode) => void
  addWaveAttractor: (position: [number, number, number]) => void
  addWaveAttractorCurve: (points: readonly [number, number, number][]) => void
  updateWaveAttractor: (id: string, patch: AttractorPatch) => void
  removeWaveAttractor: (id: string) => void
  selectWaveAttractor: (id: string | null) => void

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
      { radius: 5, strength: 0.8, falloff: 'linear' },
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
      { radius: 4, strength: 0.9, falloff: 'linear' },
    ),
  ]
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

  setMode: (mode) => set({ mode }),

  setFieldParam: (key, value) => set((s) => ({ field: { ...s.field, [key]: value } })),

  setCombine: (combine) => set((s) => ({ field: { ...s.field, combine } })),

  toggleAlignToField: () =>
    set((s) => ({ field: { ...s.field, alignToField: !s.field.alignToField } })),

  addAttractor: (position) =>
    set((s) => {
      const a = createAttractor(new THREE.Vector3(position[0], position[1], position[2]))
      return { attractors: [...s.attractors, a], selectedAttractorId: a.id }
    }),

  addAttractorCurve: (points) =>
    set((s) => {
      const a = createCurveAttractor(toVec3s(points))
      return { attractors: [...s.attractors, a], selectedAttractorId: a.id }
    }),

  updateAttractor: (id, patch) =>
    set((s) => ({
      attractors: s.attractors.map((a) => (a.id === id ? applyAttractorPatch(a, patch) : a)),
    })),

  removeAttractor: (id) =>
    set((s) => ({
      attractors: s.attractors.filter((a) => a.id !== id),
      selectedAttractorId: s.selectedAttractorId === id ? null : s.selectedAttractorId,
    })),

  selectAttractor: (selectedAttractorId) => set({ selectedAttractorId }),

  setWaveParam: (key, value) => set((s) => ({ wave: { ...s.wave, [key]: value } })),

  setWaveCombine: (combine) => set((s) => ({ wave: { ...s.wave, combine } })),

  addWaveAttractor: (position) =>
    set((s) => {
      const a = createAttractor(new THREE.Vector3(position[0], position[1], position[2]))
      return { waveAttractors: [...s.waveAttractors, a], selectedWaveAttractorId: a.id }
    }),

  addWaveAttractorCurve: (points) =>
    set((s) => {
      const a = createCurveAttractor(toVec3s(points))
      return { waveAttractors: [...s.waveAttractors, a], selectedWaveAttractorId: a.id }
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
    })),

  selectWaveAttractor: (selectedWaveAttractorId) => set({ selectedWaveAttractorId }),

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
    }),
}))
