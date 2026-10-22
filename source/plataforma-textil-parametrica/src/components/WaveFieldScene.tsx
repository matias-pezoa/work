/**
 * Escena del modo Ondas: base de tela (plano, solo referencia visual — ver
 * waveField.ts sobre por que las costillas no incluyen su propia base) +
 * peine de costillas independientes (contour) + gizmos de atractores
 * editables en el viewport.
 *
 * El material usa `flatShading` para que el perfil de cada costilla (que ya
 * viene muestreado con resolucion baja respecto de la longitud de onda, ver
 * waveField.ts) se lea como segmentos/facetas en vez de una curva suavizada;
 * ademas se dibujan las aristas (`<Edges>`) para que se vean nitidas sin
 * depender del angulo de luz.
 */
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import { useAppStore } from '../state/store'
import { AttractorGizmos } from './AttractorGizmos'
import { BaseShapeGround } from './BaseShapeGround'

interface WaveFieldSceneProps {
  geometry: THREE.BufferGeometry
  planeSize: number
}

export function WaveFieldScene({ geometry, planeSize }: WaveFieldSceneProps) {
  const baseShape = useAppStore((s) => s.baseShape)
  const attractors = useAppStore((s) => s.waveAttractors)
  const selectedId = useAppStore((s) => s.selectedWaveAttractorId)
  const selectAttractor = useAppStore((s) => s.selectWaveAttractor)
  const updateAttractor = useAppStore((s) => s.updateWaveAttractor)

  return (
    <group>
      {/* base de tela, apenas debajo del panel para que no compitan en el z-fight */}
      <BaseShapeGround planeSize={planeSize} baseShape={baseShape} y={-0.01} />

      {hasVerts(geometry) && (
        <mesh geometry={geometry} receiveShadow>
          <meshStandardMaterial
            color="#dcd4c2"
            roughness={0.9}
            metalness={0}
            flatShading
            side={THREE.DoubleSide}
          />
          <Edges threshold={6} color="#8a7a5c" />
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
