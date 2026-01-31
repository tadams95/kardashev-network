'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SolarGlobeProps {
  scale?: number;
}

export default function SolarGlobe({ scale = 1.5 }: SolarGlobeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const wireframeRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.08;
    }
    if (wireframeRef.current) {
      wireframeRef.current.rotation.y = t * 0.05;
      wireframeRef.current.rotation.x = t * 0.02;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Wireframe icosahedron */}
      <mesh ref={wireframeRef} scale={scale}>
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial
          color="#FFD700"
          wireframe
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Point light at center */}
      <pointLight color="#FF8C00" intensity={1.5} distance={15} decay={2} />
    </group>
  );
}
