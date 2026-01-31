// Main 3D scene component with sun visualization

import { Suspense, useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import Sun from './Sun'

interface SunSceneProps {
  ghi: number // Current irradiance
  isDay: boolean
  cloudCover: number // 0-100
}

// Loading fallback
function SceneLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Scene content (inside Canvas)
function SceneContent({ ghi, isDay }: { ghi: number; isDay: boolean }) {
  return (
    <>
      {/* Ambient lighting */}
      <ambientLight intensity={isDay ? 0.3 : 0.05} />

      {/* Sun */}
      <Sun ghi={ghi} isDay={isDay} />

      {/* Stars (visible at night or low light) */}
      {!isDay && (
        <Stars
          radius={100}
          depth={50}
          count={1000}
          factor={4}
          saturation={0}
          fade
          speed={0.5}
        />
      )}
    </>
  )
}

export default function SunScene({ ghi, isDay, cloudCover }: SunSceneProps) {
  const [isClient, setIsClient] = useState(false)
  const [hasWebGL, setHasWebGL] = useState(true)

  // Only render on client (Next.js SSR safety)
  useEffect(() => {
    setIsClient(true)

    // Check WebGL support
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      setHasWebGL(!!gl)
    } catch {
      setHasWebGL(false)
    }
  }, [])

  // Don't render during SSR
  if (!isClient) {
    return (
      <div className="w-full h-full bg-gradient-to-b from-gray-900 to-black rounded-2xl" />
    )
  }

  // Fallback for no WebGL
  if (!hasWebGL) {
    return (
      <div className="w-full h-full bg-gradient-to-b from-gray-900 to-black rounded-2xl flex items-center justify-center">
        <div className="text-center text-gray-400">
          <div className="text-4xl mb-2">{isDay ? '☀️' : '🌙'}</div>
          <p className="text-sm">3D visualization unavailable</p>
        </div>
      </div>
    )
  }

  // Calculate glow intensity based on GHI
  const glowIntensity = isDay ? Math.min(ghi / 1000, 1) : 0.1
  const glowColor = isDay ? 'rgba(255, 200, 50,' : 'rgba(100, 100, 150,'

  return (
    <div className="w-full h-full relative">
      <Suspense fallback={<SceneLoader />}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 50 }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          }}
          dpr={[1, 2]} // Responsive pixel ratio
          style={{ background: 'transparent' }}
        >
          <SceneContent ghi={ghi} isDay={isDay} />
        </Canvas>
      </Suspense>

      {/* CSS-based bloom/glow overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 35%, ${glowColor}${glowIntensity * 0.3}) 0%, transparent 50%)`,
        }}
      />

      {/* Cloud overlay effect */}
      {cloudCover > 20 && isDay && (
        <div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            background: `radial-gradient(ellipse at center, transparent 30%, rgba(100, 100, 100, ${cloudCover / 200}) 100%)`,
          }}
        />
      )}
    </div>
  )
}
