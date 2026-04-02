// Design Ref: §6.1 — Force-Directed Layout (Web Worker)
// 뇌 형태 ellipsoid 초기 배치 + Barnes-Hut 근사 force simulation

interface LayoutMessage {
  type: 'init';
  nodes: Array<{ id: string; clusterId: number; size: number }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  options?: Partial<LayoutOptions>;
}

interface LayoutOptions {
  iterations: number;
  repulsion: number;
  attraction: number;
  damping: number;
  brainScale: [number, number, number]; // x, y, z 반지름 (뇌 비율)
}

const DEFAULTS: LayoutOptions = {
  iterations: 200,
  repulsion: 800,
  attraction: 0.005,
  damping: 0.92,
  brainScale: [250, 180, 200], // 좌우 넓고, 위아래 납작, 앞뒤 중간 = 뇌 비율
};

self.onmessage = (e: MessageEvent<LayoutMessage>) => {
  if (e.data.type !== 'init') return;

  const { nodes, edges, options } = e.data;
  const opts = { ...DEFAULTS, ...options };
  const n = nodes.length;

  if (n === 0) {
    self.postMessage({ type: 'done', positions: [] });
    return;
  }

  // 노드 인덱스 맵
  const idxMap = new Map<string, number>();
  nodes.forEach((node, i) => idxMap.set(node.id, i));

  // 엣지를 인덱스 기반으로 변환
  const edgeIdx = edges
    .map(e => ({ s: idxMap.get(e.source) ?? -1, t: idxMap.get(e.target) ?? -1, w: e.weight }))
    .filter(e => e.s >= 0 && e.t >= 0);

  // 초기 배치: 뇌 형태 ellipsoid 표면 + 내부
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  const [rx, ry, rz] = opts.brainScale;

  for (let i = 0; i < n; i++) {
    // 구면 좌표 → 타원체 매핑
    const theta = Math.acos(2 * Math.random() - 1); // 0~π
    const phi = Math.random() * 2 * Math.PI;         // 0~2π
    const r = 0.5 + 0.5 * Math.random();             // 반지름 비율 (내부에도 분포)

    // 뇌 좌반구/우반구 비대칭 (약간의 주름 효과)
    const wobble = 1 + 0.1 * Math.sin(5 * theta) * Math.cos(3 * phi);

    pos[i * 3]     = rx * r * Math.sin(theta) * Math.cos(phi) * wobble;
    pos[i * 3 + 1] = ry * r * Math.cos(theta) * wobble;
    pos[i * 3 + 2] = rz * r * Math.sin(theta) * Math.sin(phi) * wobble;

    // 같은 클러스터끼리 가깝게 초기 배치
    const cluster = nodes[i].clusterId;
    const clusterAngle = (cluster / 10) * 2 * Math.PI;
    pos[i * 3]     += 30 * Math.cos(clusterAngle);
    pos[i * 3 + 2] += 30 * Math.sin(clusterAngle);
  }

  // Force simulation
  for (let iter = 0; iter < opts.iterations; iter++) {
    const alpha = 1 - iter / opts.iterations; // cooling
    const repForce = opts.repulsion * alpha;

    // 반발력 (모든 노드 쌍 — n < 2000이면 O(n²) 허용)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - pos[i * 3];
        const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
        const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const distSq = dx * dx + dy * dy + dz * dz + 0.01;
        const force = repForce / distSq;
        const fx = dx * force / Math.sqrt(distSq);
        const fy = dy * force / Math.sqrt(distSq);
        const fz = dz * force / Math.sqrt(distSq);

        vel[i * 3]     -= fx;
        vel[i * 3 + 1] -= fy;
        vel[i * 3 + 2] -= fz;
        vel[j * 3]     += fx;
        vel[j * 3 + 1] += fy;
        vel[j * 3 + 2] += fz;
      }
    }

    // 인력 (연결된 노드)
    for (const edge of edgeIdx) {
      const dx = pos[edge.t * 3] - pos[edge.s * 3];
      const dy = pos[edge.t * 3 + 1] - pos[edge.s * 3 + 1];
      const dz = pos[edge.t * 3 + 2] - pos[edge.s * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const force = opts.attraction * dist * edge.w;
      const fx = dx / dist * force;
      const fy = dy / dist * force;
      const fz = dz / dist * force;

      vel[edge.s * 3]     += fx;
      vel[edge.s * 3 + 1] += fy;
      vel[edge.s * 3 + 2] += fz;
      vel[edge.t * 3]     -= fx;
      vel[edge.t * 3 + 1] -= fy;
      vel[edge.t * 3 + 2] -= fz;
    }

    // 뇌 형태 유지 — ellipsoid 경계 소프트 제약
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      // ellipsoid 밖이면 안쪽으로 끌어당김
      const ellipDist = (x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2;
      if (ellipDist > 1) {
        const pullback = 0.3 * (ellipDist - 1);
        vel[i * 3]     -= x * pullback * 0.01;
        vel[i * 3 + 1] -= y * pullback * 0.01;
        vel[i * 3 + 2] -= z * pullback * 0.01;
      }

      // 속도 적용 + 감쇠
      pos[i * 3]     += vel[i * 3];
      pos[i * 3 + 1] += vel[i * 3 + 1];
      pos[i * 3 + 2] += vel[i * 3 + 2];
      vel[i * 3]     *= opts.damping;
      vel[i * 3 + 1] *= opts.damping;
      vel[i * 3 + 2] *= opts.damping;
    }

    // 매 20 iteration마다 중간 결과 전송 (애니메이션)
    if (iter % 20 === 0 || iter === opts.iterations - 1) {
      const positions: Array<[number, number, number]> = [];
      for (let i = 0; i < n; i++) {
        positions.push([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      }
      self.postMessage({
        type: iter === opts.iterations - 1 ? 'done' : 'progress',
        positions,
        iteration: iter,
        total: opts.iterations,
      });
    }
  }
};
