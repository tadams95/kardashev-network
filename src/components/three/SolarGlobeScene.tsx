'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Suspense, useEffect, useState } from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import SolarGlobe from '../three/SolarGlobe';
import SolarRadiationParticles from '../three/SolarRadiationParticles';

function ResponsiveCamera() {
  const { size, camera } = useThree();

  useEffect(() => {
    const aspect = size.width / size.height;
    // On portrait/narrow screens, pull camera back to reveal more of the sun
    // On landscape/wide screens, keep default distance
    const baseZ = 5;
    camera.position.z = baseZ + Math.max(0, 1 - aspect) * 3;
    camera.updateProjectionMatrix();
  }, [size.width, size.height, camera]);

  return null;
}

interface SolarGlobeSceneProps {
  className?: string;
}

export default function SolarGlobeScene({ className = '' }: SolarGlobeSceneProps) {
  const [cursor, setCursor] = useState({ x: 0, y: 0, active: false });

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
          <ResponsiveCamera />

          {/* Ambient lighting for subtle fill */}
          <ambientLight intensity={0.1} color="#ffffff" />

          {/* Main Sun component */}
          <SolarGlobe
            scale={1.8}
            onCursorMove={(x, y, active) => setCursor({ x, y, active })}
          />

          {/* Solar radiation particles */}
          <SolarRadiationParticles
            sunRadius={1.8}
            particleCount={300}
            cursorX={cursor.x}
            cursorY={cursor.y}
            cursorActive={cursor.active}
          />

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

          {/* Post-processing Bloom for Intense Solar Glow */}
          <EffectComposer>
            <Bloom 
              luminanceThreshold={0.8} 
              luminanceSmoothing={0.5} 
              intensity={1.0} 
              mipmapBlur={true}
            />
          </EffectComposer>

        </Suspense>
      </Canvas>
    </div>
  );
}
