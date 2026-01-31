// 3D Sun component with dynamic glow based on irradiance

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sphere } from '@react-three/drei'
import * as THREE from 'three'

interface SunProps {
  ghi: number // Global Horizontal Irradiance (0-1000+ W/m²)
  isDay: boolean
}

export default function Sun({ ghi, isDay }: SunProps) {
  const sunRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)

  // Normalize GHI to 0-1 range (assuming max ~1000 W/m²)
  const intensity = useMemo(() => {
    if (!isDay) return 0.1
    return Math.min(Math.max(ghi / 1000, 0.1), 1)
  }, [ghi, isDay])

  // Sun color shifts from orange (low) to bright yellow (high)
  const sunColor = useMemo(() => {
    if (!isDay) return new THREE.Color('#1a1a2e')
    const t = intensity
    // Interpolate from orange (#ff6b35) to yellow (#ffd93d)
    return new THREE.Color().lerpColors(
      new THREE.Color('#ff6b35'),
      new THREE.Color('#ffd93d'),
      t
    )
  }, [intensity, isDay])

  // Glow color (slightly more saturated)
  const glowColor = useMemo(() => {
    if (!isDay) return new THREE.Color('#0a0a1a')
    return new THREE.Color().lerpColors(
      new THREE.Color('#ff8c42'),
      new THREE.Color('#ffeb3b'),
      intensity
    )
  }, [intensity, isDay])

  // Animate sun rotation and pulsing
  useFrame((state, delta) => {
    if (sunRef.current) {
      sunRef.current.rotation.y += delta * 0.1
    }
    if (glowRef.current) {
      // Subtle pulse effect
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.05 * intensity
      glowRef.current.scale.setScalar(pulse)
    }
  })

  return (
    <group position={[0, 2, 0]}>
      {/* Core sun sphere */}
      <Sphere ref={sunRef} args={[1, 64, 64]}>
        <meshStandardMaterial
          color={sunColor}
          emissive={sunColor}
          emissiveIntensity={intensity * 2}
          toneMapped={false}
        />
      </Sphere>

      {/* Inner glow layer */}
      <Sphere ref={glowRef} args={[1.2, 32, 32]}>
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.3 * intensity}
          side={THREE.BackSide}
        />
      </Sphere>

      {/* Outer glow layer */}
      <Sphere args={[1.5, 32, 32]}>
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.15 * intensity}
          side={THREE.BackSide}
        />
      </Sphere>

      {/* Point light emanating from sun */}
      <pointLight
        color={sunColor}
        intensity={intensity * 3}
        distance={20}
        decay={2}
      />
    </group>
  )
}
