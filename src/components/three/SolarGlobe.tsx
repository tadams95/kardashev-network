'use client';

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

interface SolarGlobeProps {
  scale?: number;
  onCursorMove?: (x: number, y: number, active: boolean) => void;
  onEntranceComplete?: () => void;
}

const SPRING_STIFFNESS = 25;
const SPRING_DAMPING = 8;
const FLARE_COUNT = 6; 
const IDLE_ROTATION_SPEED = 0.02; 
const DRAG_SENSITIVITY = 0.008;

// --- NOISE FUNCTIONS ---
const noiseGLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m; m = m * m;
  vec4 px = vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3));
  return 42.0 * dot(m, px);
}
`;

// --- SHADERS ---

// 1. SUN SURFACE (Cellular Granulation, Smooth Limb Darkening)
const sunVertexShader = `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
${noiseGLSL}

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  
  // Back to a near-perfect sphere to match the majestic deep-space reference. 
  // We use just a microscopic amount of noise so it's technically not a dead 3D primitive,
  // but it visually holds a perfectly round silhouette.
  float t = uTime * 0.1; 
  float noise = snoise(position * 5.0 + vec3(0.0, t, 0.0));
  float displacement = noise * 0.002; // Very subtle!
  
  vec3 displacedPosition = position + normal * displacement;
  vPos = position; // Pass raw local position for stable texture coordinates
  
  vec4 worldPosition = modelMatrix * vec4(displacedPosition, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
}
`;

const sunFragmentShader = `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
${noiseGLSL}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float viewDot = dot(normalize(vNormal), viewDir);
  float cosTheta = max(0.001, viewDot);
  
  // --- COLOR PALETTE (Matched to Deep Orange Reference) ---
  vec3 colorHigh = vec3(1.0, 0.75, 0.1);     // Golden yellow for hot plasma wisps
  vec3 colorBase = vec3(0.95, 0.45, 0.0);    // Deep vibrant orange main body
  vec3 colorOuter = vec3(0.85, 0.15, 0.0);   // Fiery dark red-orange edge
  vec3 colorLimb = vec3(0.4, 0.02, 0.0);     // Pitch dark red extreme rim
  
  // --- SMOOTH LIMB DARKENING ---
  // Shifted darker so the sun is primarily deep orange instead of pale yellow
  vec3 sphereColor = mix(colorOuter, colorBase, smoothstep(0.1, 0.6, cosTheta));
  sphereColor = mix(colorLimb, sphereColor, smoothstep(0.0, 0.15, cosTheta)); 
  
  // --- WISPY SURFACE MOTION (Magnetic Flow) ---
  // Low-frequency noise creates flowing "rivers" or magnetic field lines
  float t = uTime * 0.06; // Slowed down 25% for a more majestic, massive feel
  vec3 flow = vec3(
      snoise(vPos * 2.5 + vec3(t, 0.0, 0.0)),
      snoise(vPos * 2.5 + vec3(0.0, t, 0.0)),
      snoise(vPos * 2.5 + vec3(0.0, 0.0, t))
  );
  
  // Use the flow to massively warp the coordinate space, making details look "swept" and fibrous
  vec3 pWisps = vPos * 65.0 + flow * 20.0;
  float n1 = snoise(pWisps + vec3(0.0, t * 1.5, 0.0));
  float n2 = snoise(pWisps * 1.5 - vec3(t * 1.2, 0.0, t * 0.5));
  float fibrous = (n1 * 0.6 + n2 * 0.4) * 0.5 + 0.5; // Map to 0-1
  
  // Secondary tiny cellular granulation underneath the wisps
  vec3 pCells = vPos * 150.0 + flow * 5.0;
  float cells = 1.0 - abs(snoise(pCells + vec3(t * 2.0)));
  cells = smoothstep(0.3, 0.9, cells);
  
  // Combine swept fibrous textures with cellular dots
  float textureMix = mix(cells, fibrous, 0.65); 
  
  // Apply the texture to brightness. High values get the hot yellow highlight.
  vec3 surfaceColor = mix(sphereColor * 0.6, colorHigh, textureMix * 0.9);
  
  // --- SUNSPOTS & MAGNETIC KNOTS ---
  // Occasional dark pits warped by the same flow
  float spotNoise = snoise(vPos * 6.0 + flow * 3.0 + t * 0.4);
  float spots = smoothstep(0.75, 1.0, spotNoise); 
  surfaceColor = mix(surfaceColor, vec3(0.1, 0.0, 0.0), spots * 0.85);

  // Keep emission flat to avoid a "spotlight"
  float emissionMult = 1.15;
  
  gl_FragColor = vec4(surfaceColor * emissionMult, 1.0);
}
`;

// 2. CORONA MESH (Billboard Glow)
const coronaMeshVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Soft fading halo blending into pitch black
const coronaFragmentShader = `
varying vec2 vUv;
void main() {
  vec2 center = vec2(0.5);
  float dist = length(vUv - center) * 2.0; 
  
  // Soft fade out using inverse square-like falloff
  float glow = 1.0 - smoothstep(0.0, 1.0, dist);
  glow = pow(glow, 3.0); // Tighter inner glow, fades beautifully
  
  // Rich golden orange hue
  vec3 color = vec3(1.0, 0.45, 0.05); 
  
  // Intense core
  vec3 coreColor = vec3(1.0, 0.8, 0.2);
  vec3 finalColor = mix(color, coreColor, glow * glow);
  
  float alpha = glow * 0.85; 
  
  gl_FragColor = vec4(finalColor, alpha);
}
`;

// 3. FLARES (Tiny, Tapered Plasma Prominences)
const flareVertexShader = `
varying vec2 vUv; 
uniform float uTime;
${noiseGLSL}

void main() { 
  vUv = uv; 
  
  vec3 pos = position;
  float t = uTime * 0.8;
  
  float taper = sin(uv.x * 3.14159);
  
  // Marginally larger base radius to be visible without turning into tentacles
  float currentRadius = 0.012;
  float desiredRadius = currentRadius * pow(taper, 1.5);
  float shift = desiredRadius - currentRadius;
  pos += normal * shift;
  
  float displacement = snoise(vec3(uv.x * 12.0, t * 2.0, 0.0)) * 0.02 * taper;
  pos += normal * displacement;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0); 
}
`;

const flareFragmentShader = `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
${noiseGLSL}

void main() {
  float edgeMask = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  float dist = abs(vUv.y - 0.5) * 2.0; 
  
  float plasmaAlpha = snoise(vec3(vUv.x * 15.0, vUv.y * 5.0, uTime)) * 0.5 + 0.5;
  
  float core = smoothstep(0.6, 0.0, dist);
  float glow = smoothstep(1.0, 0.4, dist);
  
  vec3 superHot = vec3(1.0, 0.95, 0.8);
  vec3 baseFlare = mix(vec3(0.6, 0.1, 0.0), uColor, core);
  vec3 c = mix(baseFlare, superHot, core * core);
  
  float emissionMult = 1.6;
  
  float alpha = (core + glow * 0.5) * edgeMask * uOpacity * plasmaAlpha;
  
  gl_FragColor = vec4(c * emissionMult, alpha);
}
`;

interface FlareState { startTheta: number; startPhi: number; endTheta: number; endPhi: number; arcHeight: number; phase: number; duration: number; }

function createFlareState(): FlareState {
  // Keep them tighter to the surface to mimic realistic prominences
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * (Math.random() * 0.8 + 0.1) - 1); 
  const spread = 0.06 + Math.random() * 0.10; 
  return {
    startTheta: theta, startPhi: phi,
    endTheta: theta + (Math.random() - 0.5) * spread,
    endPhi: phi + (Math.random() - 0.5) * spread,
    arcHeight: 0.05 + Math.random() * 0.08, 
    phase: Math.random(),
    duration: 6.0 + Math.random() * 4.0, 
  };
}

function spherePoint(theta: number, phi: number, r: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta) * r,
    Math.cos(phi) * r,
    Math.sin(phi) * Math.sin(theta) * r
  );
}

function buildFlareGeometry(state: FlareState, radius: number): THREE.TubeGeometry {
  const start = spherePoint(state.startTheta, state.startPhi, radius);
  const mid = start.clone().add(spherePoint(state.endTheta, state.endPhi, radius)).multiplyScalar(0.5).normalize().multiplyScalar(radius + state.arcHeight);
  const end = spherePoint(state.endTheta, state.endPhi, radius);
  const curve = new THREE.CatmullRomCurve3([start, mid, end]);
  // Match the new 0.012 radius
  return new THREE.TubeGeometry(curve, 64, 0.012, 8, false);
}

function SolarFlares({ surfaceRadius }: { surfaceRadius: number }) {
  const groupRef = useRef<THREE.Group>(null!);
  const flaresRef = useRef<FlareState[]>([]);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const materialsRef = useRef<THREE.ShaderMaterial[]>([]);
  const geometriesRef = useRef<THREE.TubeGeometry[]>([]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    while(group.children.length > 0){ group.remove(group.children[0]); }
    
    flaresRef.current = [];
    meshesRef.current = [];
    materialsRef.current = [];
    geometriesRef.current = [];

    for (let i = 0; i < FLARE_COUNT; i++) {
      const state = createFlareState();
      flaresRef.current.push(state);
      const geo = buildFlareGeometry(state, surfaceRadius);
      geometriesRef.current.push(geo);

      const mat = new THREE.ShaderMaterial({
        vertexShader: flareVertexShader,
        fragmentShader: flareFragmentShader,
        uniforms: {
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uColor: { value: new THREE.Color('#ffaa00') },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false, 
        side: THREE.DoubleSide,
      });
      materialsRef.current.push(mat);

      const mesh = new THREE.Mesh(geo, mat);
      meshesRef.current.push(mesh);
      group.add(mesh);
    }
    
    return () => {
        geometriesRef.current.forEach(g => g.dispose());
        materialsRef.current.forEach(m => m.dispose());
    };
  }, [surfaceRadius]);

  useFrame((_, delta) => {
    for (let i = 0; i < FLARE_COUNT; i++) {
      const flare = flaresRef.current[i];
      const mat = materialsRef.current[i];
      if (!flare || !mat) continue;

      mat.uniforms.uTime.value += delta;
      flare.phase += delta / flare.duration;
      
      if (flare.phase >= 1.0) {
        flaresRef.current[i] = createFlareState();
        flaresRef.current[i].phase = 0;
        const newGeo = buildFlareGeometry(flaresRef.current[i], surfaceRadius);
        geometriesRef.current[i].dispose();
        geometriesRef.current[i] = newGeo;
        meshesRef.current[i].geometry = newGeo;
      }

      const p = flare.phase;
      let opacity = 0;
      if (p < 0.2) opacity = THREE.MathUtils.smoothstep(p, 0, 0.2);
      else if (p > 0.8) opacity = THREE.MathUtils.smoothstep(p, 1.0, 0.8);
      else opacity = 1.0;
      
      mat.uniforms.uOpacity.value = opacity * 0.6; 
    }
  });

  return <group ref={groupRef} />;
}

export default function SolarGlobe({ scale = 1.5, onCursorMove, onEntranceComplete }: SolarGlobeProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const scaleGroupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const coronaRef = useRef<THREE.Mesh>(null!);
  const hoveredRef = useRef(false);
  const draggingRef = useRef(false);
  const isIdleRef = useRef(true);
  const animatedScale = useRef(0.1);
  const scaleVelocity = useRef(0);
  const entranceComplete = useRef(false);
  const targetScale = useRef(scale);
  const velocity = useRef({ x: 0, y: 0 });
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { targetScale.current = scale; }, [scale]);

  // Prevent the corona billboard from intercepting pointer events meant for the sun sphere
  useEffect(() => {
    if (coronaRef.current) {
      coronaRef.current.raycast = () => {};
    }
  }, []);

  const sunMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: sunVertexShader,
    fragmentShader: sunFragmentShader,
    uniforms: { uTime: { value: 0 } },
  }), []);

  const coronaMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: coronaMeshVertexShader, 
    fragmentShader: coronaFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false, 
  }), []);

  useFrame((state, delta) => {
    if (!groupRef.current || !scaleGroupRef.current) return;

    if (coronaRef.current) {
      coronaRef.current.lookAt(state.camera.position);
    }

    const t = sunMaterial.uniforms.uTime.value + delta;
    sunMaterial.uniforms.uTime.value = t;

    if (!entranceComplete.current) {
      const disp = animatedScale.current - targetScale.current;
      const spring = -SPRING_STIFFNESS * disp;
      const damp = -SPRING_DAMPING * scaleVelocity.current;
      scaleVelocity.current += (spring + damp) * delta;
      animatedScale.current += scaleVelocity.current * delta;
      
      if (animatedScale.current < 0) animatedScale.current = 0.01;
      scaleGroupRef.current.scale.setScalar(animatedScale.current);

      if (Math.abs(disp) < 0.006 && Math.abs(scaleVelocity.current) < 0.006) {
        scaleGroupRef.current.scale.setScalar(targetScale.current);
        animatedScale.current = targetScale.current;
        entranceComplete.current = true;
        onEntranceComplete?.();
      }
    } else if (Math.abs(scaleGroupRef.current.scale.x - targetScale.current) > 0.001) {
         scaleGroupRef.current.scale.setScalar(targetScale.current);
    }

    if (!draggingRef.current) {
      groupRef.current.rotation.y += velocity.current.x * delta;
      groupRef.current.rotation.x += velocity.current.y * delta;
      velocity.current.x *= 0.95; 
      velocity.current.y *= 0.95;
      if (isIdleRef.current) groupRef.current.rotation.y += delta * IDLE_ROTATION_SPEED;
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'grabbing';
    isIdleRef.current = false;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    draggingRef.current = false;
    document.body.style.cursor = hoveredRef.current ? 'grab' : 'auto';
    isIdleRef.current = false;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => { isIdleRef.current = true; }, 2800);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current && groupRef.current) {
      groupRef.current.rotation.y += e.movementX * DRAG_SENSITIVITY;
      groupRef.current.rotation.x += e.movementY * DRAG_SENSITIVITY;
      velocity.current.x = e.movementX * 0.4;
      velocity.current.y = e.movementY * 0.4;
    }
    if (e.point && onCursorMove) onCursorMove(e.point.x / 3, e.point.y / 3, true);
  };

  const handlePointerOut = () => {
    hoveredRef.current = false;
    if (!draggingRef.current) document.body.style.cursor = 'auto';
    onCursorMove?.(0, 0, false);
  };

  return (
    <group ref={groupRef}>
      <group ref={scaleGroupRef} scale={0.1}>
        <mesh
          ref={meshRef}
          material={sunMaterial}
          onPointerOver={() => { hoveredRef.current = true; document.body.style.cursor = 'grab'; }}
          onPointerOut={handlePointerOut}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerMove={handlePointerMove}
        >
          <sphereGeometry args={[1, 192, 192]} />
        </mesh>

        <mesh ref={coronaRef} material={coronaMaterial} scale={[2.8, 2.8, 1.0]}>
          <planeGeometry args={[1, 1]} />
        </mesh>

        <SolarFlares surfaceRadius={0.98} />
      </group>
    </group>
  );
}
