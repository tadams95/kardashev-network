// Energy particles streaming from sun to ground
// Active energy flow with scientific precision, wavy organic paths

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface EnergyParticlesProps {
  ghi: number // Global Horizontal Irradiance (0-1000+ W/m²)
  isDay: boolean
  cursorX?: number // -1 to 1 normalized mouse X
  cursorY?: number // -1 to 1 normalized mouse Y
  cursorActive?: boolean // whether cursor is in scene
}

// Particle count scales with irradiance
const BASE_PARTICLE_COUNT = 150
const MAX_PARTICLE_COUNT = 400

export default function EnergyParticles({
  ghi,
  isDay,
  cursorX = 0,
  cursorY = 0,
  cursorActive = false,
}: EnergyParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null)

  // Calculate particle count based on irradiance
  const particleCount = useMemo(() => {
    if (!isDay) return Math.floor(BASE_PARTICLE_COUNT * 0.1)
    const intensity = Math.min(ghi / 1000, 1)
    return Math.floor(BASE_PARTICLE_COUNT + (MAX_PARTICLE_COUNT - BASE_PARTICLE_COUNT) * intensity)
  }, [ghi, isDay])

  // Initialize particle data with wave parameters
  const particleData = useMemo(() => {
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)

    // Store per-particle data for wave motion
    const waveData = new Float32Array(particleCount * 4) // phase, frequency, amplitude, speed

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3
      const i4 = i * 4

      // Distribute particles in vertical streams from sun
      const streamAngle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.3
      const streamRadius = 0.3 + Math.random() * 1.2

      // Starting position - staggered along the path
      const progress = Math.random() // 0 = at sun, 1 = at ground
      const startY = 2.5 - progress * 5.5 // Sun at y=2.5, ground at y=-3

      positions[i3] = Math.cos(streamAngle) * streamRadius
      positions[i3 + 1] = startY
      positions[i3 + 2] = Math.sin(streamAngle) * streamRadius * 0.5 // Flatten in z

      // Wave parameters for organic motion
      waveData[i4] = Math.random() * Math.PI * 2 // phase offset
      waveData[i4 + 1] = 1.5 + Math.random() * 1.5 // wave frequency
      waveData[i4 + 2] = 0.1 + Math.random() * 0.15 // wave amplitude
      waveData[i4 + 3] = 0.3 + Math.random() * 0.4 // descent speed

      // Color: energy gradient from bright yellow (top) to warm orange (bottom)
      const energyLevel = 1 - progress * 0.3 // Slightly dimmer as it descends
      colors[i3] = 1.0 * energyLevel // R
      colors[i3 + 1] = (0.75 + Math.random() * 0.2) * energyLevel // G
      colors[i3 + 2] = (0.2 + Math.random() * 0.2) * energyLevel // B
    }

    return { positions, colors, waveData }
  }, [particleCount])

  // Particle size based on irradiance
  const particleSize = useMemo(() => {
    if (!isDay) return 0.015
    const intensity = Math.min(ghi / 1000, 1)
    return 0.025 + intensity * 0.025
  }, [ghi, isDay])

  // Animate particles with wavy organic motion + cursor attraction
  useFrame((state) => {
    if (!pointsRef.current) return

    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array
    const colors = pointsRef.current.geometry.attributes.color.array as Float32Array
    const { waveData } = particleData
    const time = state.clock.elapsedTime
    const intensity = isDay ? 0.5 + (ghi / 1000) * 0.5 : 0.15

    // Convert normalized cursor to world space (approximate)
    const cursorWorldX = cursorX * 3
    const cursorWorldY = cursorY * 2.5

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3
      const i4 = i * 4

      const phase = waveData[i4]
      const freq = waveData[i4 + 1]
      const amp = waveData[i4 + 2]
      const speed = waveData[i4 + 3]

      // Move particle downward
      positions[i3 + 1] -= speed * intensity * 0.016 // ~60fps normalized

      // Apply sinusoidal wave motion in X and Z
      const waveOffset = Math.sin(time * freq + phase + positions[i3 + 1] * 2)
      const baseX = Math.cos(phase) * (0.3 + (phase % 1) * 1.2)
      const baseZ = Math.sin(phase) * (0.3 + (phase % 1) * 0.6)

      let targetX = baseX + waveOffset * amp
      let targetZ = baseZ + Math.cos(time * freq * 0.7 + phase) * amp * 0.5

      // Cursor attraction effect
      if (cursorActive) {
        const dx = cursorWorldX - positions[i3]
        const dy = cursorWorldY - positions[i3 + 1]
        const distance = Math.sqrt(dx * dx + dy * dy)

        // Attract particles within range (stronger when closer)
        if (distance < 3) {
          const attractionStrength = 0.15 * (1 - distance / 3)
          targetX += dx * attractionStrength
          // Subtle vertical attraction (don't pull too hard)
          positions[i3 + 1] += dy * attractionStrength * 0.3
        }
      }

      positions[i3] = targetX
      positions[i3 + 2] = targetZ

      // Reset particle when it reaches ground
      if (positions[i3 + 1] < -3) {
        positions[i3 + 1] = 2.5 + Math.random() * 0.5

        // Slight randomization on respawn
        waveData[i4] = Math.random() * Math.PI * 2
      }

      // Update color based on height (energy dissipation effect)
      const progress = (2.5 - positions[i3 + 1]) / 5.5
      const energyLevel = Math.max(0.4, 1 - progress * 0.4)
      colors[i3] = energyLevel
      colors[i3 + 1] = 0.7 * energyLevel
      colors[i3 + 2] = 0.25 * energyLevel
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
    pointsRef.current.geometry.attributes.color.needsUpdate = true
  })

  // Don't render if very low light
  if (!isDay && ghi < 10) return null

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={particleData.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={particleCount}
          array={particleData.colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={particleSize}
        vertexColors
        transparent
        opacity={isDay ? 0.85 : 0.25}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}
