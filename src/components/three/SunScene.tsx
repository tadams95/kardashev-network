// Simplified 3D scene - giant sphere

import { Suspense, useState, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import AbstractSun from './AbstractSun'

interface SunSceneProps {
  ghi: number
  isDay: boolean
  cloudCover: number
  currentValue?: number
}

function SceneLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function SunScene({
  ghi,
  isDay,
}: SunSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return <div className="w-full h-full bg-black rounded-2xl" />
  }

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <Suspense fallback={<SceneLoader />}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: '#000' }}
        >
          <AbstractSun ghi={ghi} isDay={isDay} />
        </Canvas>
      </Suspense>
    </div>
  )
}
