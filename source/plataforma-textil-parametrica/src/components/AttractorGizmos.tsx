/**
 * Gizmos de atractores para el viewport 3D: puntos arrastrables + circulo de
 * influencia + TransformControls del punto activo. Recibe el set de
 * atractores del modo (ver state/attractorSets.ts), asi sirve igual para
 * Volumen y Ondas.
 *
 * Un atractor `kind: 'point'` tiene UN punto arrastrable. Uno `kind: 'curve'`
 * tiene uno por punto de control: esfera = vertice suave (Bezier), cubo =
 * esquina. La linea dibujada es `curvePath` — la MISMA polilinea teselada
 * que usa el campo de atraccion, no una aproximacion visual. Solo un punto a
 * la vez tiene el gizmo de traslado (TransformControls no soporta mas de un
 * objeto): el seleccionado en el store (`selectedPointIndex`), compartido con
 * el panel y la tecla Supr.
 *
 * Clic derecho (sin arrastrar) sobre el plano: agrega un punto a la curva
 * seleccionada o crea un atractor punto (ver `addAtPoint`). Se escucha en un
 * plano invisible grande en y = 0 con `onContextMenu`, NO con
 * `onPointerDown`: el gizmo de TransformControls no es un objeto R3F y un
 * pointerdown sobre el "atravesaria" hasta el plano (ver CLAUDE.md,
 * Interaccion); el contextmenu solo lo dispara el boton derecho, que el gizmo
 * no usa. Un clic derecho CON arrastre es el paneo de OrbitControls y se
 * ignora (`e.delta`).
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { curvePath, type Attractor } from '../geometry/attractionField'
import { useAppStore } from '../state/store'
import {
  addAtPoint,
  DEFAULT_ATTRACTOR_Y,
  type AttractorSet,
} from '../state/attractorSets'

interface AttractorGizmosProps {
  set: AttractorSet
  /**
   * Modo Ondas: los puntos tienen direccion. Se dibuja una barra que la
   * indica y el gizmo puede ROTAR el punto (tecla R o el panel) ademas de
   * moverlo.
   */
  rotatable?: boolean
}

/** Px que puede moverse el puntero entre presionar y soltar para contar como clic. */
const CLICK_TOLERANCE_PX = 4

export function AttractorGizmos({ set, rotatable = false }: AttractorGizmosProps) {
  const handleRefs = useRef<Record<string, THREE.Mesh | null>>({})
  const gizmoMode = useAppStore((s) => s.gizmoMode)
  const { attractors, selectedId, selectedPointIndex, select, update } = set
  const selected = attractors.find((a) => a.id === selectedId)

  const pointCount = selected
    ? selected.kind === 'point'
      ? 1
      : selected.points.length
    : 0
  const activeIndex = Math.min(selectedPointIndex ?? 0, Math.max(0, pointCount - 1))
  const activeKey = selected ? `${selected.id}:${activeIndex}` : undefined
  const selectedObject = activeKey
    ? (handleRefs.current[activeKey] ?? undefined)
    : undefined
  const rotating = rotatable && gizmoMode === 'rotate' && selected?.kind === 'point'

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onContextMenu={(e) => {
          if (e.delta > CLICK_TOLERANCE_PX) return
          e.stopPropagation()
          e.nativeEvent.preventDefault()
          addAtPoint(set, e.point, DEFAULT_ATTRACTOR_Y)
        }}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {attractors.map((a) => (
        <AttractorGizmo
          key={a.id}
          attractor={a}
          selected={a.id === selectedId}
          showDirection={rotatable}
          activeIndex={a.id === selectedId ? activeIndex : -1}
          setRef={(index, el) => {
            handleRefs.current[`${a.id}:${index}`] = el
          }}
          onSelectPoint={(index) => select(a.id, index)}
        />
      ))}

      {selected && selectedObject && (
        <TransformControls
          object={selectedObject}
          mode={rotating ? 'rotate' : 'translate'}
          showX={!rotating}
          showZ={!rotating}
          size={0.7}
          onObjectChange={() => {
            const o = handleRefs.current[activeKey!]
            if (!o) return
            if (rotating) {
              // rotacion Y de -θ lleva el +X local a (cos θ, 0, sin θ): ver handle
              const deg = ((-o.rotation.y * 180) / Math.PI) % 180
              update(selected.id, { angleDeg: deg < 0 ? deg + 180 : deg })
              return
            }
            const newPos = new THREE.Vector3(o.position.x, o.position.y, o.position.z)
            if (selected.kind === 'point') {
              update(selected.id, { position: newPos })
            } else {
              const points = selected.points.map((p, i) =>
                i === activeIndex ? newPos : p,
              )
              update(selected.id, { points })
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
  showDirection: boolean
  /** Indice del punto activo de este atractor, o -1. */
  activeIndex: number
  setRef: (index: number, el: THREE.Mesh | null) => void
  onSelectPoint: (index: number) => void
}

function AttractorGizmo({
  attractor,
  selected,
  showDirection,
  activeIndex,
  setRef,
  onSelectPoint,
}: AttractorGizmoProps) {
  const points = attractor.kind === 'point' ? [attractor.position] : attractor.points
  const color = attractor.strength >= 0 ? '#f4f4f1' : '#8c8c87'

  const ring = useMemo(() => {
    const g = new THREE.RingGeometry(attractor.radius - 0.08, attractor.radius, 72)
    g.rotateX(-Math.PI / 2)
    return g
  }, [attractor.radius])
  useEffect(() => () => ring.dispose(), [ring])

  const line = useMemo(() => {
    if (attractor.kind !== 'curve') return null
    const g = new THREE.BufferGeometry().setFromPoints(curvePath(attractor))
    return new THREE.Line(g, LINE_MATERIAL)
  }, [attractor])
  useEffect(() => () => line?.geometry.dispose(), [line])

  return (
    <group>
      {line && <primitive object={line} />}
      {points.map((p, i) => {
        const corner = attractor.kind === 'curve' && !attractor.smooth[i]
        const active = i === activeIndex
        // un punto con direccion: el handle va rotado (Y = -angulo) para que el
        // gizmo de rotacion parta del angulo actual y la barra lo muestre.
        const dirAngle =
          showDirection && attractor.kind === 'point' ? attractor.angleDeg : null
        return (
          <group key={i}>
            <mesh
              ref={(el) => setRef(i, el)}
              position={[p.x, p.y, p.z]}
              rotation={[0, dirAngle === null ? 0 : (-dirAngle * Math.PI) / 180, 0]}
              scale={active ? 1.35 : 1}
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelectPoint(i)
              }}
            >
              {corner ? (
                <boxGeometry args={[0.62, 0.62, 0.62]} />
              ) : (
                <sphereGeometry args={[0.4, 20, 20]} />
              )}
              <meshStandardMaterial
                color={color}
                emissive={active ? '#8c8c87' : selected ? '#4a4a46' : '#000000'}
              />
              {dirAngle !== null && (
                // barra de direccion: eje local X (las costillas corren por ahi)
                <mesh>
                  <boxGeometry args={[2.6, 0.08, 0.08]} />
                  <meshBasicMaterial color={color} />
                </mesh>
              )}
            </mesh>
            <mesh geometry={ring} position={[p.x, 0.004, p.z]}>
              <meshBasicMaterial
                color={selected ? '#f4f4f1' : color}
                transparent
                opacity={selected ? 0.5 : 0.2}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

const LINE_MATERIAL = new THREE.LineBasicMaterial({ color: '#f4f4f1', linewidth: 2 })
