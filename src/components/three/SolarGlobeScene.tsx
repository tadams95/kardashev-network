'use client';

import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Suspense } from 'react';
import SolarGlobe from '../three/SolarGlobe';

interface SolarGlobeSceneProps {
  className?: string;
}

export default function SolarGlobeScene({ className = '' }: SolarGlobeSceneProps) {
  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas
        camera={{
          position: [0, 0, 5],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 2]}
        style={{ background: '#050505' }}
      >
        <Suspense fallback={null}>
          {/* Ambient lighting for subtle fill */}
          <ambientLight intensity={0.1} color="#ffffff" />

          {/* Main Sun component */}
          <SolarGlobe scale={1.8} />

          {/* Background stars for depth */}
          <Stars
            radius={50}
            depth={50}
            count={2000}
            factor={2}
            saturation={0}
            fade
            speed={0.5}
          />

        </Suspense>
      </Canvas>
    </div>
  );
}
