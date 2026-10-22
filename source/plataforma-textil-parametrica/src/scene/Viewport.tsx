/**
 * Viewport 3D compartido: Canvas de R3F, camara, luces, grid y controles de
 * orbita. Los modulos (campo de puas, corte laser) se montan como children.
 */
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { ReactNode } from 'react'

interface ViewportProps {
  children: ReactNode
}

export function Viewport({ children }: ViewportProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [14, 12, 18], fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#141518']} />
      <hemisphereLight args={['#dfe7ff', '#20222a', 0.55]} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight position={[-12, 6, -10]} intensity={0.4} />

      <Grid
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#2c2f38"
        sectionSize={10}
        sectionThickness={1.1}
        sectionColor="#3d5a80"
        fadeDistance={90}
        fadeStrength={1.5}
        infiniteGrid
        position={[0, -0.001, 0]}
      />

      {children}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </Canvas>
  )
}
