/**
 * Escena del modo Volumen: base de tela (plano o forma importada) + campo de
 * puas solidas que emergen de ella + gizmos de atractores editables.
 */
import * as THREE from 'three'
import { useAppStore } from '../state/store'
import { useAttractorSet } from '../state/attractorSets'
import { AttractorGizmos } from './AttractorGizmos'
import { BaseShapeGround } from './BaseShapeGround'

interface SpikeFieldSceneProps {
  geometry: THREE.BufferGeometry
  planeSize: number
}

export function SpikeFieldScene({ geometry, planeSize }: SpikeFieldSceneProps) {
  const baseShape = useAppStore((s) => s.baseShape)
  const attractorSet = useAttractorSet('volume')

  return (
    <group>
      {/* Clic DERECHO agrega atractores/puntos (ver AttractorGizmos); el
          izquierdo no, y este es el motivo: el
          gizmo de TransformControls no es un objeto de R3F (no tiene
          onPointerDown propio), asi que un clic para arrastrarlo "atravesaba"
          hasta este plano y sumaba un atractor de mas cada vez que se
          intentaba mover uno existente. */}
      {/* apenas debajo de y=0: el disco de la base de cada pua es coplanar con la
          tela y sin este offset ambos parpadean (z-fighting) */}
      <BaseShapeGround planeSize={planeSize} baseShape={baseShape} y={-0.01} />

      {hasVerts(geometry) && (
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial color="#e9e9e4" roughness={0.45} metalness={0.05} />
        </mesh>
      )}

      <AttractorGizmos set={attractorSet} />
    </group>
  )
}

function hasVerts(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position')
  return !!pos && pos.count > 0
}
