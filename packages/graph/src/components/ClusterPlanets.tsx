// Cluster super-nodes rendered as PLANETS — a custom-shaded sphere per folded cluster so the
// galaxy reads as a little solar system. Each cluster gets one of FIVE distinct planet TYPES
// (by clusterId): gas giant (bands), terrestrial (continents + ice caps), rocky/cratered,
// molten/lava (glowing cracks), and ice world — plus Saturn-style rings on some. So they look
// varied, not 80 identical Jupiters.
//
// Gated on node.isCluster (≤80), cluster-view only. Decorative: raycast disabled so
// hover/click/drilldown keep flowing through the GraphNodes Points raycaster (tiny core point).

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

const PALETTE_HEX = [
  '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
  '#14b8a6', '#e879f9', '#eab308', '#22d3ee', '#fb7185',
];

const NOOP_RAYCAST = () => null;
const TYPES = 5;

const VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  #define PI 3.14159265
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  uniform vec3 uColor;
  uniform vec3 uDark;
  uniform vec3 uAtmo;
  uniform float uSeed;
  uniform float uType;

  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
  }
  float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }

  void main(){
    vec3 n = normalize(vNormalW);
    vec3 sp = normalize(vLocal);
    float seed = uSeed * 7.13;
    int ptype = int(uType + 0.5);
    vec3 base; float selfLit = 0.0;

    if (ptype == 0) {
      // GAS GIANT — warped latitude bands + storm spots
      float warp = fbm(sp * 2.4 + seed) - 0.5;
      float bands = sin((sp.y * 5.5 + warp * 2.5) * PI);
      float t = smoothstep(-0.35, 0.35, bands);
      base = mix(uDark, uColor, t);
      float spots = fbm(sp * 4.7 + seed * 1.7);
      base = mix(base, uColor * 1.3, smoothstep(0.64, 0.82, spots) * 0.6);
    } else if (ptype == 1) {
      // TERRESTRIAL — continents over ocean + polar ice caps
      float cont = fbm(sp * 2.2 + seed);
      float land = smoothstep(0.48, 0.56, cont);
      vec3 ocean = uDark * 0.75;
      base = mix(ocean, uColor, land);
      base = mix(base, uColor * 1.25, smoothstep(0.7, 0.85, cont) * 0.5);
      float cap = smoothstep(0.74, 0.9, abs(sp.y));
      base = mix(base, vec3(0.92, 0.95, 1.0), cap * 0.85);
    } else if (ptype == 2) {
      // ROCKY / CRATERED — desaturated, pocked
      float rock = fbm(sp * 5.0 + seed);
      float craters = fbm(sp * 9.0 + seed * 2.0);
      vec3 stone = mix(uColor * 0.45, uColor * 0.95, rock);
      base = stone * (0.75 + 0.4 * smoothstep(0.4, 0.7, craters));
      base = mix(base, uDark * 0.45, smoothstep(0.62, 0.8, 1.0 - craters) * 0.55);
    } else if (ptype == 3) {
      // MOLTEN / LAVA — dark crust with self-lit glowing cracks
      float cracks = abs(fbm(sp * 5.5 + seed * 1.3) - 0.5);
      float glow = smoothstep(0.07, 0.0, cracks);
      base = mix(uDark * 0.22, uColor * 1.5, glow);
      selfLit = glow * 0.85;
    } else {
      // ICE — bright, low-saturation, fine cracks
      float ice = fbm(sp * 3.5 + seed);
      vec3 white = mix(uColor, vec3(1.0), 0.62);
      base = mix(white * 0.78, white, ice);
      float cracks = abs(fbm(sp * 7.5 + seed * 1.7) - 0.5);
      base = mix(base, uColor * 0.7, smoothstep(0.05, 0.0, cracks) * 0.5);
    }

    // day/night terminator (fixed light), low ambient — lava ignores it (self-lit)
    vec3 L = normalize(vec3(0.75, 0.45, 0.55));
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float light = mix(0.18 + 1.05 * diff, 1.0, selfLit);
    // fresnel atmosphere rim
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 2.6);
    vec3 col = base * light + uAtmo * fres * 0.85;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Planet({ position, radius, color, seed, type }: {
  position: [number, number, number]; radius: number; color: string; seed: number; type: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const material = useMemo(() => {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: c.clone() },
        uDark: { value: c.clone().multiplyScalar(0.34) },
        uAtmo: { value: c.clone().lerp(new THREE.Color('#ffffff'), 0.45) },
        uSeed: { value: seed },
        uType: { value: type },
      },
    });
  }, [color, seed, type]);

  // gas giants (type 0) and one ice variant get rings, tilted per seed.
  const hasRing = (type === 0 && seed % 2 === 0) || (type === 4 && seed % 3 === 0);
  const ringTilt = 0.35 + (seed % 4) * 0.18;

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * (0.07 + (seed % 5) * 0.013);
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh raycast={NOOP_RAYCAST} material={material}>
        <sphereGeometry args={[radius, 32, 32]} />
      </mesh>
      {/* soft outer atmosphere halo beyond the rim */}
      <mesh raycast={NOOP_RAYCAST} scale={1.35}>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.11} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {hasRing && (
        <mesh raycast={NOOP_RAYCAST} rotation={[Math.PI / 2 + ringTilt, 0, ringTilt * 0.5]}>
          <ringGeometry args={[radius * 1.5, radius * 2.3, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
    </group>
  );
}

export function ClusterPlanets() {
  const nodes = useGraphStore((s) => s.nodes);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);

  const planets = nodes.filter((n) => n.isCluster && n.position && !hiddenClusters.has(n.clusterId));
  if (planets.length === 0) return null;

  return (
    <group>
      {planets.map((n) => (
        <Planet
          key={n.id}
          position={n.position as [number, number, number]}
          radius={1.6 + (n.size ?? 3) * 0.9}
          color={PALETTE_HEX[n.clusterId % PALETTE_HEX.length]}
          seed={n.clusterId}
          // spread the 5 types across clusters; +the cluster's own id so colour≠type lockstep
          type={(n.clusterId * 2 + 1) % TYPES}
        />
      ))}
    </group>
  );
}
