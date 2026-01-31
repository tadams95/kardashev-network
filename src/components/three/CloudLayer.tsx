// Animated cloud layer based on cloudCover percentage

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface CloudLayerProps {
  cloudCover: number // 0-100 percentage
  isDay: boolean
}

// Individual cloud component
function Cloud({
  position,
  scale,
  speed,
  opacity,
}: {
  position: [number, number, number]
  scale: number
  speed: number
  opacity: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const initialX = position[0]

  useFrame((state, delta) => {
    if (!groupRef.current) return

    // Drift clouds horizontally
    groupRef.current.position.x += delta * speed

    // Reset cloud when it goes off screen
    if (groupRef.current.position.x > 8) {
      groupRef.current.position.x = -8
    }
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Cloud made of overlapping spheres */}
      <mesh scale={[scale * 1.5, scale * 0.6, scale]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          transparent
          opacity={opacity}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <mesh position={[-0.6 * scale, 0.1 * scale, 0]} scale={[scale * 1.2, scale * 0.5, scale * 0.8]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color="#f0f0f0"
          transparent
          opacity={opacity * 0.9}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <mesh position={[0.7 * scale, -0.05 * scale, 0.2 * scale]} scale={[scale * 1.1, scale * 0.5, scale * 0.9]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color="#e8e8e8"
          transparent
          opacity={opacity * 0.85}
          roughness={1}
          metalness={0}
        />
      </mesh>
    </group>
  )
}

export default function CloudLayer({ cloudCover, isDay }: CloudLayerProps) {
  // Generate cloud configurations based on coverage
  const clouds = useMemo(() => {
    if (cloudCover < 10) return []

    // More clouds = higher cloud cover
    const cloudCount = Math.floor((cloudCover / 100) * 8) + 1
    const cloudConfigs: Array<{
      position: [number, number, number]
      scale: number
      speed: number
      opacity: number
    }> = []

    for (let i = 0; i < cloudCount; i++) {
      const x = (Math.random() - 0.5) * 12
      const y = 3.5 + Math.random() * 1.5 // Above the sun
      const z = -2 + Math.random() * 4

      cloudConfigs.push({
        position: [x, y, z],
        scale: 0.4 + Math.random() * 0.4,
        speed: 0.1 + Math.random() * 0.15,
        opacity: isDay
          ? 0.3 + (cloudCover / 100) * 0.5
          : 0.1 + (cloudCover / 100) * 0.2,
      })
    }

    return cloudConfigs
  }, [cloudCover, isDay])

  // Don't render if no clouds
  if (clouds.length === 0) return null

  return (
    <group>
      {clouds.map((cloud, index) => (
        <Cloud
          key={index}
          position={cloud.position}
          scale={cloud.scale}
          speed={cloud.speed}
          opacity={cloud.opacity}
        />
      ))}

      {/* Ambient cloud haze for heavy coverage */}
      {cloudCover > 50 && (
        <mesh position={[0, 4, 0]}>
          <planeGeometry args={[20, 8]} />
          <meshBasicMaterial
            color={isDay ? '#d0d0d0' : '#303040'}
            transparent
            opacity={(cloudCover - 50) / 200}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}
