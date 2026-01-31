// Simple giant sphere - starting point

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface AbstractSunProps {
  ghi: number
  isDay: boolean
  mouseX?: number
  mouseY?: number
  mouseActive?: boolean
  onClick?: () => void
}

export default function AbstractSun({
  ghi,
  isDay,
  onClick,
}: AbstractSunProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  // Slow rotation
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.05
    }
  })

  const color = isDay ? '#ffd93d' : '#1a1a3a'

  return (
    <mesh
      ref={meshRef}
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      <sphereGeometry args={[2, 64, 64]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}
