/**
 * "Tela" de base para los modos 3D: un plano cuadrado por defecto, o la forma
 * importada (con agujeros) cuando hay una base personalizada activa. Ambos
 * modos (Volumen, Ondas) comparten este render para que la superficie visible
 * coincida exactamente con el dominio que usan spikeField.ts/waveField.ts
 * (mismas coordenadas x,z, ver la nota de signo mas abajo).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { BaseShapeState } from '../state/store'
import { mmToThree } from '../utils/units'

interface BaseShapeGroundProps {
  /** Lado del panel cuadrado por defecto (u3d), usado si `baseShape` es null. */
  planeSize: number
  baseShape: BaseShapeState | null
  /** Offset vertical para evitar z-fighting con lo que se apoya encima. */
  y?: number
}

export function BaseShapeGround({ planeSize, baseShape, y = 0 }: BaseShapeGroundProps) {
  const geometry = useMemo(() => {
    if (!baseShape) return null
    // THREE.Shape vive en un plano local (x,y); al acostarlo con
    // rotation=[-PI/2,0,0] el mundo queda en (x, 0, -y) — se usa -z aca para
    // que, tras la rotacion, el mundo (x,z) coincida EXACTO con el (x,z) que
    // usan spikeField/waveField (mismo contorno, mismas coordenadas).
    const toLocal = ([x, z]: readonly [number, number]) =>
      new THREE.Vector2(mmToThree(x), -mmToThree(z))
    const shape = new THREE.Shape(baseShape.outer.map(toLocal))
    for (const hole of baseShape.holes) {
      shape.holes.push(new THREE.Path(hole.map(toLocal)))
    }
    return new THREE.ShapeGeometry(shape, 24)
  }, [baseShape])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (geometry) {
    return (
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, y, 0]}
        receiveShadow
      >
        <meshStandardMaterial
          color="#d8cdbf"
          roughness={0.95}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    )
  }

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
        <planeGeometry args={[planeSize, planeSize, 1, 1]} />
        <meshStandardMaterial color="#d8cdbf" roughness={0.95} metalness={0} />
      </mesh>
      <gridHelper
        args={[planeSize, Math.max(2, Math.round(planeSize / 2)), '#b9ab97', '#c7bca6']}
        position={[0, y + 0.002, 0]}
      />
    </group>
  )
}
