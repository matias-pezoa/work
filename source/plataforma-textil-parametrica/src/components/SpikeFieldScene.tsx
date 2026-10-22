/**
 * Escena del modo Volumen: base de tela (plano o forma importada) + campo de
 * puas solidas que emergen de ella + gizmos de atractores editables.
 */
import * as THREE from 'three'
import { useAppStore } from '../state/store'
import { AttractorGizmos } from './AttractorGizmos'
import { BaseShapeGround } from './BaseShapeGround'

interface SpikeFieldSceneProps {
  geometry: THREE.BufferGeometry
  planeSize: number
}

export function SpikeFieldScene({ geometry, planeSize }: SpikeFieldSceneProps) {
  const baseShape = useAppStore((s) => s.baseShape)
  const attractors = useAppStore((s) => s.attractors)
  const selectedId = useAppStore((s) => s.selectedAttractorId)
  const selectAttractor = useAppStore((s) => s.selectAttractor)
  const updateAttractor = useAppStore((s) => s.updateAttractor)

  return (
    <group>
      {/* Los atractores se agregan con el boton del panel, no con clic aca: el
          gizmo de TransformControls no es un objeto de R3F (no tiene
          onPointerDown propio), asi que un clic para arrastrarlo "atravesaba"
          hasta este plano y sumaba un atractor de mas cada vez que se
          intentaba mover uno existente. */}
      <BaseShapeGround planeSize={planeSize} baseShape={baseShape} />

      {hasVerts(geometry) && (
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial color="#e7e2d6" roughness={0.45} metalness={0.05} />
        </mesh>
      )}

      <AttractorGizmos
        attractors={attractors}
        selectedId={selectedId}
        onSelect={selectAttractor}
        onUpdate={updateAttractor}
      />
    </group>
  )
}

function hasVerts(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position')
  return !!pos && pos.count > 0
}
