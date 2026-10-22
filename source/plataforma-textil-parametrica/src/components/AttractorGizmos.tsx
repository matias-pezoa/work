/**
 * Gizmos de atractores para el viewport: esferas arrastrables + circulo de
 * influencia + TransformControls del punto activo. Sin acoplar a un store en
 * particular (recibe todo por props) para poder usarse en cualquier modo que
 * tenga su propio set de atractores (Volumen, Ondas, ...).
 *
 * Un atractor `kind: 'point'` tiene UNA esfera arrastrable. Uno `kind: 'curve'`
 * tiene una esfera por punto de control, unidas por una linea recta (esa
 * linea ES la geometria que usa el campo de atraccion, ver attractionField.ts
 * — no hay suavizado oculto). Solo un punto a la vez tiene el gizmo de
 * traslado (TransformControls no soporta mas de un objeto): el ultimo que se
 * clickeo. Al cambiar de atractor seleccionado (desde la lista del panel, no
 * clickeando en el viewport) el punto activo vuelve al primero.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import type { Attractor, AttractorPatch } from '../geometry/attractionField'

interface AttractorGizmosProps {
  attractors: readonly Attractor[]
  selectedId: string | null
  onSelect: (id: string) => void
  onUpdate: (id: string, patch: AttractorPatch) => void
}

export function AttractorGizmos({
  attractors,
  selectedId,
  onSelect,
  onUpdate,
}: AttractorGizmosProps) {
  const handleRefs = useRef<Record<string, THREE.Mesh | null>>({})
  // ultimo punto clickeado a mano (id de atractor + indice). Si el atractor
  // seleccionado cambio desde afuera (lista del panel, no un clic en el
  // viewport), este recuerdo queda "viejo" y se ignora (ver clampedActiveIndex
  // abajo): el gizmo arranca en el primer punto de ese atractor sin necesitar
  // un efecto que sincronice el estado.
  const [manualPoint, setManualPoint] = useState<{ id: string; index: number } | null>(null)
  const selected = attractors.find((a) => a.id === selectedId)

  const pointCount = selected
    ? selected.kind === 'point'
      ? 1
      : selected.points.length
    : 0
  const activeIndex = manualPoint && manualPoint.id === selectedId ? manualPoint.index : 0
  const clampedActiveIndex = Math.min(activeIndex, Math.max(0, pointCount - 1))
  const activeKey = selected ? `${selected.id}:${clampedActiveIndex}` : undefined
  const selectedObject = activeKey ? (handleRefs.current[activeKey] ?? undefined) : undefined

  const selectPoint = (id: string, index: number) => {
    onSelect(id)
    setManualPoint({ id, index })
  }

  return (
    <group>
      {attractors.map((a) => (
        <AttractorGizmo
          key={a.id}
          attractor={a}
          selected={a.id === selectedId}
          setRef={(index, el) => {
            handleRefs.current[`${a.id}:${index}`] = el
          }}
          onSelectPoint={(index) => selectPoint(a.id, index)}
        />
      ))}

      {selected && selectedObject && (
        <TransformControls
          object={selectedObject}
          mode="translate"
          size={0.7}
          onObjectChange={() => {
            const o = handleRefs.current[activeKey!]
            if (!o) return
            const newPos = new THREE.Vector3(o.position.x, o.position.y, o.position.z)
            if (selected.kind === 'point') {
              onUpdate(selected.id, { position: newPos })
            } else {
              const points = selected.points.map((p, i) =>
                i === clampedActiveIndex ? newPos : p,
              )
              onUpdate(selected.id, { points })
            }
          }}
        />
      )}
    </group>
  )
}

interface AttractorGizmoProps {
  attractor: Attractor
  selected: boolean
  setRef: (index: number, el: THREE.Mesh | null) => void
  onSelectPoint: (index: number) => void
}

function AttractorGizmo({ attractor, selected, setRef, onSelectPoint }: AttractorGizmoProps) {
  const points = attractor.kind === 'point' ? [attractor.position] : attractor.points
  const color = attractor.strength >= 0 ? '#ff5d73' : '#4f7cff'

  const ring = useMemo(() => {
    const g = new THREE.RingGeometry(attractor.radius - 0.08, attractor.radius, 72)
    g.rotateX(-Math.PI / 2)
    return g
  }, [attractor.radius])
  useEffect(() => () => ring.dispose(), [ring])

  const line = useMemo(() => {
    if (attractor.kind !== 'curve') return null
    const g = new THREE.BufferGeometry().setFromPoints(attractor.points)
    return new THREE.Line(g, LINE_MATERIAL)
  }, [attractor])
  useEffect(() => () => line?.geometry.dispose(), [line])

  return (
    <group>
      {line && <primitive object={line} />}
      {points.map((p, i) => (
        <group key={i}>
          <mesh
            ref={(el) => setRef(i, el)}
            position={[p.x, p.y, p.z]}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelectPoint(i)
            }}
          >
            <sphereGeometry args={[0.4, 20, 20]} />
            <meshStandardMaterial
              color={color}
              emissive={selected ? '#5b1220' : '#180608'}
            />
          </mesh>
          <mesh geometry={ring} position={[p.x, 0.004, p.z]}>
            <meshBasicMaterial
              color={selected ? '#ffd166' : '#ff5d73'}
              transparent
              opacity={selected ? 0.5 : 0.2}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

const LINE_MATERIAL = new THREE.LineBasicMaterial({ color: '#ffd166', linewidth: 2 })
