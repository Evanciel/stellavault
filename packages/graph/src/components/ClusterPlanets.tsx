// Cluster super-nodes rendered as PLANETS — a custom-shaded sphere per folded cluster, so
// the galaxy reads as a little solar system instead of flat dots. NOT a plain coloured ball:
// the shader gives each one a banded/mottled surface (fbm noise), a real day/night terminator
// (fixed light dir, low ambient), and a fresnel atmosphere rim in the cluster colour.
//
// Gated on node.isCluster (≤80 spheres), cluster-view only. Decorative: raycast disabled so
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
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  uniform vec3 uColor;   // bright band
  uniform vec3 uDark;    // dark band
  uniform vec3 uAtmo;    // rim / atmosphere
  uniform float uSeed;

  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
  }
  float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }

  void main(){
    vec3 n = normalize(vNormalW);
    vec3 sp = normalize(vLocal);
    float seed = uSeed * 7.13;
    // gas-giant latitude bands, warped by fbm so they're not perfect rings
    float warp = fbm(sp * 2.4 + seed) - 0.5;
    float bands = sin((sp.y * 5.5 + warp * 2.5) * 3.14159);
    float t = smoothstep(-0.35, 0.35, bands);
    // mottled storms / continents
    float spots = fbm(sp * 4.7 + seed * 1.7);
    vec3 base = mix(uDark, uColor, t);
    base = mix(base, uColor * 1.25, smoothstep(0.62, 0.82, spots) * 0.6);
    base = mix(base, uDark * 0.7, smoothstep(0.62, 0.85, 1.0 - spots) * 0.35);
    // day/night terminator (fixed light), low ambient so the dark side is actually dark
    vec3 L = normalize(vec3(0.75, 0.45, 0.55));
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float light = 0.18 + 1.05 * diff;
    // fresnel atmosphere rim
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 2.6);
    vec3 col = base * light + uAtmo * fres * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Planet({ position, radius, color, seed }: { position: [number, number, number]; radius: number; color: string; seed: number }) {
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
      },
    });
  }, [color, seed]);

  // slow, slightly varied self-rotation so the surface drifts under the terminator
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * (0.08 + (seed % 5) * 0.012);
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh raycast={NOOP_RAYCAST} material={material}>
        <sphereGeometry args={[radius, 32, 32]} />
      </mesh>
      {/* soft outer atmosphere halo beyond the rim */}
      <mesh raycast={NOOP_RAYCAST} scale={1.35}>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
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
        />
      ))}
    </group>
  );
}
