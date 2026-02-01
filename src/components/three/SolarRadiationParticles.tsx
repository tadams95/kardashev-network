'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SolarRadiationParticlesProps {
  sunRadius?: number;
  particleCount?: number;
  cursorX?: number;
  cursorY?: number;
  cursorActive?: boolean;
  delayStart?: number; // Delay in seconds before particles appear
}

// Lane configuration: speed multiplier, size, probability
const LANES = [
  { speed: 0.5, size: 0.05, probability: 0.3 },   // Slow
  { speed: 1.0, size: 0.04, probability: 0.35 },  // Medium
  { speed: 1.8, size: 0.03, probability: 0.25 },  // Fast
  { speed: 3.5, size: 0.025, probability: 0.1 },  // Burst
];

// Colors for gradient
const COLOR_START = new THREE.Color('#FFD700');  // Bright gold
const COLOR_MID = new THREE.Color('#FF8C00');    // Orange
const COLOR_END = new THREE.Color('#FF4D00');    // Deep orange-red

function getLaneIndex(): number {
  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < LANES.length; i++) {
    cumulative += LANES[i].probability;
    if (rand < cumulative) return i;
  }
  return 0;
}

function spawnParticle(
  index: number,
  positions: Float32Array,
  colors: Float32Array,
  lifetimes: Float32Array,
  velocities: Float32Array,
  lanes: Float32Array,
  directions: Float32Array,
  sunRadius: number
) {
  // Uniform spherical distribution
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);

  // Direction from center (normalized)
  const dx = Math.sin(phi) * Math.cos(theta);
  const dy = Math.cos(phi);
  const dz = Math.sin(phi) * Math.sin(theta);

  // Position on sun surface
  positions[index * 3] = dx * sunRadius;
  positions[index * 3 + 1] = dy * sunRadius;
  positions[index * 3 + 2] = dz * sunRadius;

  // Store direction for radial movement
  directions[index * 3] = dx;
  directions[index * 3 + 1] = dy;
  directions[index * 3 + 2] = dz;

  // Initial color (bright gold)
  colors[index * 3] = COLOR_START.r;
  colors[index * 3 + 1] = COLOR_START.g;
  colors[index * 3 + 2] = COLOR_START.b;

  // Reset lifetime
  lifetimes[index] = 0;

  // Assign lane and velocity
  const laneIndex = getLaneIndex();
  lanes[index] = laneIndex;
  velocities[index] = LANES[laneIndex].speed * (0.8 + Math.random() * 0.4); // Add variance
}

export default function SolarRadiationParticles({
  sunRadius = 1.8,
  particleCount = 2000,
  cursorX = 0,
  cursorY = 0,
  cursorActive = false,
  delayStart = 0.4, // Start particles slightly after globe begins expanding
}: SolarRadiationParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const entranceOpacity = useRef(0);

  // Maximum travel distance from center
  const maxDistance = sunRadius + 4;

  // Create particle data arrays
  const { positions, colors, lifetimes, velocities, lanes, directions, sizes } = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);
    const velocities = new Float32Array(particleCount);
    const lanes = new Float32Array(particleCount);
    const directions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    // Initialize all particles with staggered lifetimes for natural distribution
    for (let i = 0; i < particleCount; i++) {
      spawnParticle(i, positions, colors, lifetimes, velocities, lanes, directions, sunRadius);
      // Stagger initial lifetimes so particles are distributed
      lifetimes[i] = Math.random();

      // Move particles outward based on initial lifetime
      const distance = sunRadius + lifetimes[i] * (maxDistance - sunRadius);
      positions[i * 3] = directions[i * 3] * distance;
      positions[i * 3 + 1] = directions[i * 3 + 1] * distance;
      positions[i * 3 + 2] = directions[i * 3 + 2] * distance;

      // Set initial size
      sizes[i] = LANES[Math.floor(lanes[i])].size;
    }

    return { positions, colors, lifetimes, velocities, lanes, directions, sizes };
  }, [particleCount, sunRadius, maxDistance]);

  // Create buffer geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, [positions, colors, sizes]);

  // Create shader material for better control
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uOpacity: { value: 0 }, // For entrance fade-in
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        uniform float uOpacity;

        void main() {
          // Circular particle with soft edges
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          // Soft glow falloff
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          alpha *= alpha; // Quadratic falloff for softer glow
          alpha *= uOpacity; // Apply entrance fade

          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  // Animation loop
  useFrame((_, delta) => {
    if (!pointsRef.current) return;

    timeRef.current += delta;
    const time = timeRef.current;

    // Entrance fade-in after delay
    if (time > delayStart && entranceOpacity.current < 1) {
      // Smooth ease-out fade in over 0.8 seconds
      const fadeProgress = Math.min((time - delayStart) / 0.8, 1);
      entranceOpacity.current = easeOutCubic(fadeProgress);
      material.uniforms.uOpacity.value = entranceOpacity.current;
    }

    // Don't animate particles until they're visible
    if (entranceOpacity.current < 0.01) return;

    // Pulsing system
    const primaryPulse = Math.sin(time * 0.8) * 0.3 + 1;
    const secondaryRipple = Math.sin(time * 2.5) * 0.15 + 1;
    const pulseMultiplier = primaryPulse * secondaryRipple;

    // Get cursor position in 3D space (approximate)
    const cursorPos = new THREE.Vector3(cursorX * 3, cursorY * 3, 2);
    const interactionRadius = 1.5;

    const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
    const sizeAttr = geometry.attributes.size as THREE.BufferAttribute;

    const tempColor = new THREE.Color();

    for (let i = 0; i < particleCount; i++) {
      // Update lifetime
      const speedFactor = velocities[i] * pulseMultiplier;
      lifetimes[i] += delta * speedFactor * 0.3;

      // Get current position
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      // Calculate distance from center
      const distFromCenter = Math.sqrt(x * x + y * y + z * z);

      // Check for respawn
      if (lifetimes[i] >= 1 || distFromCenter > maxDistance) {
        spawnParticle(i, positions, colors, lifetimes, velocities, lanes, directions, sunRadius);
        continue;
      }

      // Get direction
      let dx = directions[i * 3];
      let dy = directions[i * 3 + 1];
      let dz = directions[i * 3 + 2];

      // Calculate movement speed
      let moveSpeed = velocities[i] * delta * pulseMultiplier * 1.5;

      // Cursor deflection
      if (cursorActive) {
        const particlePos = new THREE.Vector3(x, y, z);
        const toCursor = cursorPos.clone().sub(particlePos);
        const distToCursor = toCursor.length();

        if (distToCursor < interactionRadius) {
          // Calculate deflection strength
          const deflectionStrength = 1 - smoothstep(0, interactionRadius, distToCursor);

          // Push particle away from cursor
          const pushDir = particlePos.clone().sub(cursorPos).normalize();
          dx = dx * (1 - deflectionStrength * 0.5) + pushDir.x * deflectionStrength * 0.5;
          dy = dy * (1 - deflectionStrength * 0.5) + pushDir.y * deflectionStrength * 0.5;
          dz = dz * (1 - deflectionStrength * 0.5) + pushDir.z * deflectionStrength * 0.5;

          // Normalize
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          dx /= len;
          dy /= len;
          dz /= len;

          // Speed boost when deflected
          moveSpeed *= 1 + deflectionStrength * 0.5;
        }
      }

      // Move particle outward
      positions[i * 3] += dx * moveSpeed;
      positions[i * 3 + 1] += dy * moveSpeed;
      positions[i * 3 + 2] += dz * moveSpeed;

      // Update color based on lifetime (yellow -> orange -> fade)
      const progress = lifetimes[i];
      if (progress < 0.5) {
        // Yellow to orange
        tempColor.lerpColors(COLOR_START, COLOR_MID, progress * 2);
      } else {
        // Orange to fade (with opacity reduction handled by size)
        tempColor.lerpColors(COLOR_MID, COLOR_END, (progress - 0.5) * 2);
      }
      colors[i * 3] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;

      // Update size: grow then shrink
      const laneIndex = Math.floor(lanes[i]);
      const baseSize = LANES[laneIndex].size;
      // Sin curve for grow-shrink, with fade at end
      const sizeCurve = Math.sin(progress * Math.PI) * (1 - progress * 0.5);
      sizes[i] = baseSize * (0.5 + sizeCurve * 1.5);
    }

    // Mark attributes as needing update
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} />
  );
}

// Utility function for smooth interpolation
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Easing function for premium fade-in
function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
