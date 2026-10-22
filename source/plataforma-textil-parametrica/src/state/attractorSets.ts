/**
 * Cada modo tiene su propio set de atractores en el store (Volumen, Ondas,
 * Corte laser). `useAttractorSet` los expone con una interfaz comun para que
 * gizmos, vista 2D, panel y atajos de teclado no tripliquen la logica.
 */
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type AppState } from './store'
import {
  insertCurvePoint,
  removeCurvePoint,
  type Attractor,
  type AttractorPatch,
} from '../geometry/attractionField'

export type AttractorSetKind = 'volume' | 'wave' | 'laser'

export interface AttractorSet {
  attractors: readonly Attractor[]
  selectedId: string | null
  selectedPointIndex: number | null
  add: (position: [number, number, number]) => void
  addCurve: (points: readonly [number, number, number][]) => void
  update: (id: string, patch: AttractorPatch) => void
  remove: (id: string) => void
  select: (id: string | null, pointIndex?: number | null) => void
}

/** Set del modo `kind` leido de un snapshot del store (sin suscribirse). */
export function attractorSetFrom(s: AppState, kind: AttractorSetKind): AttractorSet {
  const common = { selectedPointIndex: s.selectedPointIndex }
  if (kind === 'volume') {
    return {
      ...common,
      attractors: s.attractors,
      selectedId: s.selectedAttractorId,
      add: s.addAttractor,
      addCurve: s.addAttractorCurve,
      update: s.updateAttractor,
      remove: s.removeAttractor,
      select: s.selectAttractor,
    }
  }
  if (kind === 'wave') {
    return {
      ...common,
      attractors: s.waveAttractors,
      selectedId: s.selectedWaveAttractorId,
      add: s.addWaveAttractor,
      addCurve: s.addWaveAttractorCurve,
      update: s.updateWaveAttractor,
      remove: s.removeWaveAttractor,
      select: s.selectWaveAttractor,
    }
  }
  return {
    ...common,
    attractors: s.laserAttractors,
    selectedId: s.selectedLaserAttractorId,
    add: s.addLaserAttractor,
    addCurve: s.addLaserAttractorCurve,
    update: s.updateLaserAttractor,
    remove: s.removeLaserAttractor,
    select: s.selectLaserAttractor,
  }
}

/** Hook: el set del modo, re-renderizando solo cuando cambia alguno de sus campos. */
export function useAttractorSet(kind: AttractorSetKind): AttractorSet {
  return useAppStore(useShallow((s) => attractorSetFrom(s, kind)))
}

/** Altura por defecto de un atractor punto nuevo en los modos 3D (u3d). */
export const DEFAULT_ATTRACTOR_Y = 3

/**
 * Tecla Supr/Delete: borra el punto de control seleccionado de una curva; si
 * la curva quedaria con menos de 2 puntos, o es un atractor punto, borra el
 * atractor entero. Devuelve false si no habia nada seleccionado.
 */
export function deleteSelection(set: AttractorSet): boolean {
  const a = set.attractors.find((at) => at.id === set.selectedId)
  if (!a) return false
  const index = set.selectedPointIndex
  if (a.kind === 'curve' && index !== null) {
    const patch = removeCurvePoint(a, index)
    if (patch) {
      set.update(a.id, patch)
      set.select(a.id, Math.max(0, index - 1))
      return true
    }
  }
  set.remove(a.id)
  return true
}

/**
 * Clic derecho en `point` (sobre el plano): con una curva seleccionada le
 * agrega un punto de control ahi (en el tramo mas cercano o extendiendo un
 * extremo); si no, crea un atractor punto nuevo en ese lugar.
 */
export function addAtPoint(
  set: AttractorSet,
  point: THREE.Vector3,
  pointY: number,
): void {
  const a = set.attractors.find((at) => at.id === set.selectedId)
  if (a?.kind === 'curve') {
    const { patch, index } = insertCurvePoint(a, point)
    set.update(a.id, patch)
    set.select(a.id, index)
    return
  }
  set.add([point.x, pointY, point.z])
}
