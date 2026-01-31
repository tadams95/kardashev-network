// 3D Sun component with dynamic glow, hover effects, and click interactions

import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sphere } from '@react-three/drei'
import * as THREE from 'three'

interface SunProps {
  ghi: number // Global Horizontal Irradiance (0-1000+ W/m²)
  isDay: boolean
  onSunClick?: () => void // Callback when sun is clicked
}

export default function Sun({ ghi, isDay, onSunClick }: SunProps) {
  const groupRef = useRef<THREE.Group>(null)
  const sunRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const outerGlowRef = useRef<THREE.Mesh>(null)
  const pulseRingRef = useRef<THREE.Mesh>(null)

  const [isHovered, setIsHovered] = useState(false)
  const [isPulsing, setIsPulsing] = useState(false)
  const pulseStartTime = useRef(0)

  // Normalize GHI to 0-1 range (assuming max ~1000 W/m²)
  const baseIntensity = useMemo(() => {
    if (!isDay) return 0.1
    return Math.min(Math.max(ghi / 1000, 0.1), 1)
  }, [ghi, isDay])

  // Hover boost (30% increase when hovered)
  const intensity = baseIntensity * (isHovered ? 1.3 : 1)

  // Sun color shifts from orange (low) to bright yellow (high)
  const sunColor = useMemo(() => {
    if (!isDay) return new THREE.Color('#1a1a2e')
    const t = baseIntensity
    return new THREE.Color().lerpColors(
      new THREE.Color('#ff6b35'),
      new THREE.Color('#ffd93d'),
      t
    )
  }, [baseIntensity, isDay])

  // Glow color (slightly more saturated)
  const glowColor = useMemo(() => {
    if (!isDay) return new THREE.Color('#0a0a1a')
    return new THREE.Color().lerpColors(
      new THREE.Color('#ff8c42'),
      new THREE.Color('#ffeb3b'),
      baseIntensity
    )
  }, [baseIntensity, isDay])

  // Handle click - trigger pulse animation
  const handleClick = () => {
    if (!isPulsing) {
      setIsPulsing(true)
      pulseStartTime.current = 0
      onSunClick?.()
    }
  }

  // Animate sun rotation, pulsing, and hover effects
  useFrame((state, delta) => {
    // Rotate sun core
    if (sunRef.current) {
      sunRef.current.rotation.y += delta * 0.1
    }

    // Glow pulse effect
    if (glowRef.current) {
      const hoverScale = isHovered ? 1.1 : 1
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.05 * intensity
      glowRef.current.scale.setScalar(pulse * hoverScale)
    }

    // Outer glow expands on hover
    if (outerGlowRef.current) {
      const targetScale = isHovered ? 1.8 : 1.5
      const currentScale = outerGlowRef.current.scale.x
      outerGlowRef.current.scale.setScalar(
        currentScale + (targetScale - currentScale) * 0.1
      )
    }

    // Click pulse ring animation
    if (pulseRingRef.current && isPulsing) {
      pulseStartTime.current += delta

      const progress = pulseStartTime.current / 1.5 // 1.5 second animation
      const scale = 1 + progress * 4 // Expand from 1 to 5
      const opacity = Math.max(0, 0.6 - progress * 0.6) // Fade out

      pulseRingRef.current.scale.setScalar(scale)
      const material = pulseRingRef.current.material as THREE.MeshBasicMaterial
      material.opacity = opacity

      // End animation
      if (progress >= 1) {
        setIsPulsing(false)
        pulseRingRef.current.scale.setScalar(1)
        material.opacity = 0
      }
    }
  })

  return (
    <group ref={groupRef} position={[0, 2, 0]}>
      {/* Core sun sphere - interactive */}
      <Sphere
        ref={sunRef}
        args={[1, 64, 64]}
        onPointerEnter={(e) => {
          e.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerLeave={() => {
          setIsHovered(false)
          document.body.style.cursor = 'default'
        }}
        onClick={(e) => {
          e.stopPropagation()
          handleClick()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
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
      <Sphere ref={outerGlowRef} args={[1.5, 32, 32]}>
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.15 * intensity * (isHovered ? 1.5 : 1)}
          side={THREE.BackSide}
        />
      </Sphere>

      {/* Pulse ring (appears on click) */}
      <mesh ref={pulseRingRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.1, 64]} />
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

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
