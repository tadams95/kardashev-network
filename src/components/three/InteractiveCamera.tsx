// Interactive camera with mouse/touch parallax

import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface InteractiveCameraProps {
  mouseX: number // -1 to 1
  mouseY: number // -1 to 1
  isActive: boolean
  parallaxStrength?: number // how much the camera moves
}

export default function InteractiveCamera({
  mouseX,
  mouseY,
  isActive,
  parallaxStrength = 0.5,
}: InteractiveCameraProps) {
  const { camera } = useThree()
  const targetPosition = useRef(new THREE.Vector3(0, 0, 6))
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0))

  useFrame(() => {
    // Calculate target camera position based on mouse
    const strength = isActive ? parallaxStrength : 0
    const targetX = mouseX * strength
    const targetY = mouseY * strength * 0.5 // Less vertical movement

    // Update target position
    targetPosition.current.set(targetX, targetY, 6)

    // Smoothly interpolate camera position
    camera.position.lerp(targetPosition.current, 0.05)

    // Camera always looks at scene center with slight offset
    targetLookAt.current.set(mouseX * 0.2, mouseY * 0.1, 0)
    const currentLookAt = new THREE.Vector3()
    camera.getWorldDirection(currentLookAt)

    // Update camera to look at interpolated target
    camera.lookAt(
      camera.position.x * 0.1,
      camera.position.y * 0.1 + 0.5, // Slight upward bias to keep sun in view
      0
    )
  })

  return null
}
