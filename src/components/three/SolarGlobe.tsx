'use client';

import { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

interface SolarGlobeProps {
  scale?: number;
  onCursorMove?: (x: number, y: number, active: boolean) => void;
  onEntranceComplete?: () => void;
}

// Spring physics constants for premium feel (slower, elegant expansion)
const SPRING_STIFFNESS = 25;
const SPRING_DAMPING = 8;

// Custom shader for cursor-reactive wireframe
const vertexShader = `
  varying vec3 vPosition;

  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uCursorPosition;
  uniform vec3 uBaseColor;
  uniform vec3 uHoverColor;
  uniform float uRadius;
  uniform float uOpacity;

  varying vec3 vPosition;

  void main() {
    float dist = distance(vPosition, uCursorPosition);
    float influence = smoothstep(uRadius, 0.0, dist);
    vec3 color = mix(uBaseColor, uHoverColor, influence);
    float alpha = uOpacity + influence * 0.4;
    gl_FragColor = vec4(color, alpha);
  }
`;

export default function SolarGlobe({ scale = 1.5, onCursorMove, onEntranceComplete }: SolarGlobeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Entrance animation state
  const animatedScale = useRef(0.1);
  const scaleVelocity = useRef(0);
  const entranceComplete = useRef(false);

  // Cursor position in local space
  const cursorPosition = useRef(new THREE.Vector3(0, 0, 10));

  // Velocity for momentum after drag
  const velocity = useRef({ x: 0, y: 0 });
  // Auto-rotation speed
  const autoRotateSpeed = 0.03;

  // Create shader material with uniforms
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uCursorPosition: { value: new THREE.Vector3(0, 0, 10) },
        uBaseColor: { value: new THREE.Color('#f0f8ff') },   // blue-white core
        uHoverColor: { value: new THREE.Color('#FFF8E7') },  // solar-white corona
        uRadius: { value: 0.6 },
        uOpacity: { value: 0.5 },
      },
      wireframe: true,
      transparent: true,
    });
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current || !meshRef.current) return;

    // Spring-based entrance animation
    if (!entranceComplete.current) {
      const targetScale = scale;
      const currentScale = animatedScale.current;

      // Spring physics: F = -k * x - d * v
      const displacement = currentScale - targetScale;
      const springForce = -SPRING_STIFFNESS * displacement;
      const dampingForce = -SPRING_DAMPING * scaleVelocity.current;
      const acceleration = springForce + dampingForce;

      scaleVelocity.current += acceleration * delta;
      animatedScale.current += scaleVelocity.current * delta;

      // Apply animated scale to mesh
      meshRef.current.scale.setScalar(animatedScale.current);

      // Check if animation is complete (settled)
      if (Math.abs(displacement) < 0.01 && Math.abs(scaleVelocity.current) < 0.01) {
        animatedScale.current = targetScale;
        meshRef.current.scale.setScalar(targetScale);
        entranceComplete.current = true;
        onEntranceComplete?.();
      }
    }

    if (!dragging) {
      // Apply velocity with friction when not dragging
      groupRef.current.rotation.y += velocity.current.x * delta;
      groupRef.current.rotation.x += velocity.current.y * delta;

      // Friction - slow down over time
      velocity.current.x *= 0.95;
      velocity.current.y *= 0.95;

      // If velocity is very low, apply gentle auto-rotation
      if (Math.abs(velocity.current.x) < 0.1 && Math.abs(velocity.current.y) < 0.1) {
        groupRef.current.rotation.y += delta * autoRotateSpeed;
      }
    }

    // Update shader uniforms
    shaderMaterial.uniforms.uCursorPosition.value.copy(cursorPosition.current);
    shaderMaterial.uniforms.uOpacity.value = hovered ? 0.6 : 0.5;
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    // Update cursor position for shader (in local coordinates)
    if (e.point && meshRef.current) {
      // Transform world point to local space
      const localPoint = meshRef.current.worldToLocal(e.point.clone());
      cursorPosition.current.copy(localPoint);

      // Notify parent of cursor position (normalized -1 to 1)
      if (onCursorMove) {
        // Use the world point to get approximate screen-space position
        const normalizedX = e.point.x / 3; // Approximate normalization
        const normalizedY = e.point.y / 3;
        onCursorMove(normalizedX, normalizedY, true);
      }
    }

    if (!dragging || !groupRef.current) return;

    // Rotate based on pointer movement
    const sensitivity = 0.01;
    groupRef.current.rotation.y += e.movementX * sensitivity;
    groupRef.current.rotation.x += e.movementY * sensitivity;

    // Store velocity for momentum
    velocity.current.x = e.movementX * 0.5;
    velocity.current.y = e.movementY * 0.5;
  };

  const handlePointerOut = () => {
    setHovered(false);
    // Move cursor far away when not hovering
    cursorPosition.current.set(0, 0, 10);
    if (!dragging) document.body.style.cursor = 'auto';
    // Notify parent cursor is no longer active
    if (onCursorMove) {
      onCursorMove(0, 0, false);
    }
  };

  return (
    <group ref={groupRef}>
      {/* Wireframe icosahedron */}
      <mesh
        ref={meshRef}
        scale={0.1}
        onPointerOver={() => {
          setHovered(true);
          document.body.style.cursor = 'grab';
        }}
        onPointerOut={handlePointerOut}
        onPointerDown={(e) => {
          handlePointerDown(e);
          document.body.style.cursor = 'grabbing';
        }}
        onPointerUp={(e) => {
          handlePointerUp(e);
          document.body.style.cursor = hovered ? 'grab' : 'auto';
        }}
        onPointerMove={handlePointerMove}
        material={shaderMaterial}
      >
        <icosahedronGeometry args={[1, 35]} />
      </mesh>

      {/* Soft glow */}
      <pointLight
        color="#fffaf5"  // neutral warm white
        intensity={1.5}
        distance={15}
        decay={2}
      />
    </group>
  );
}
