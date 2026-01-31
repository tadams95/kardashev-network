// Ground plane showing energy absorption effect

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface GroundProps {
  ghi: number // Global Horizontal Irradiance (0-1000+ W/m²)
  isDay: boolean
}

export default function Ground({ ghi, isDay }: GroundProps) {
  const groundRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const ringsRef = useRef<THREE.Group>(null)

  // Normalize intensity
  const intensity = useMemo(() => {
    if (!isDay) return 0.05
    return Math.min(Math.max(ghi / 1000, 0.1), 1)
  }, [ghi, isDay])

  // Ground color based on energy absorption
  const groundColor = useMemo(() => {
    if (!isDay) return new THREE.Color('#0a0a15')
    // From dark to warm glow as more energy hits
    return new THREE.Color().lerpColors(
      new THREE.Color('#1a1a2e'),
      new THREE.Color('#2d1f1a'),
      intensity
    )
  }, [intensity, isDay])

  // Glow color for absorption effect
  const glowColor = useMemo(() => {
    if (!isDay) return new THREE.Color('#000000')
    return new THREE.Color().lerpColors(
      new THREE.Color('#ff6b35'),
      new THREE.Color('#ffd93d'),
      intensity
    )
  }, [intensity, isDay])

  // Animate absorption rings
  useFrame((state) => {
    if (!ringsRef.current || !isDay) return

    ringsRef.current.children.forEach((ring, i) => {
      const mesh = ring as THREE.Mesh
      // Pulsing scale
      const phase = state.clock.elapsedTime * 0.5 + i * 0.5
      const scale = 1 + Math.sin(phase) * 0.1 * intensity
      mesh.scale.set(scale, scale, 1)

      // Fade based on pulse
      const material = mesh.material as THREE.MeshBasicMaterial
      material.opacity = (0.1 + Math.sin(phase) * 0.05) * intensity
    })

    // Subtle glow pulse
    if (glowRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1 * intensity
      glowRef.current.scale.set(pulse, pulse, 1)
    }
  })

  return (
    <group position={[0, -3, 0]}>
      {/* Main ground plane */}
      <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[6, 64]} />
        <meshStandardMaterial
          color={groundColor}
          roughness={0.9}
          metalness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Energy absorption glow */}
      {isDay && ghi > 50 && (
        <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <circleGeometry args={[3, 32]} />
          <meshBasicMaterial
            color={glowColor}
            transparent
            opacity={0.15 * intensity}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* Concentric absorption rings */}
      {isDay && ghi > 100 && (
        <group ref={ringsRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          {[1.5, 2.5, 3.5].map((radius, i) => (
            <mesh key={i}>
              <ringGeometry args={[radius - 0.05, radius + 0.05, 64]} />
              <meshBasicMaterial
                color={glowColor}
                transparent
                opacity={0.1 * intensity}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* Edge fade gradient */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <ringGeometry args={[4, 8, 64]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
