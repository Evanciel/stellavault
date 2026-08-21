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

  // 큰 볼트에서는 iteration 을 줄인다. 옥트리 실측 90ms/iter @ n=17,342 이라 200회면 18초다 —
  // 그 동안 화면은 초기 랜덤 배치 그대로다. 냉각 스케줄은 iteration 비율로 도는(alpha =
  // 1 - iter/iterations) 구조라 횟수를 줄여도 "끝까지 식은" 배치가 나온다. 정밀도만 조금 잃는다.
  // 호출자가 iterations 를 명시했으면 존중한다.
  if (options?.iterations === undefined && n > 4000) {
    opts.iterations = Math.max(60, Math.round(200 * (4000 / n)));
  }

  // 부피를 노드 수에 맞춰 키운다 — 이것을 안 하면 전량 볼트에서 시뮬레이션이 터진다.
  //
  // brainScale 은 [250,180,200] 고정이었고 이 값은 노드 1.5k~3k 기준으로 튜닝된 것이다.
  // 같은 부피에 17,342개를 넣으면 노드 밀도가 약 11배가 되고, 1/d² 반발력은 밀도에 그대로
  // 비례해 폭주한다 → 속도가 발산 → 좌표가 Infinity → NaN. 실제 증상은
  // "THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN" 이 쏟아지고
  // 화면이 완전히 빈 채로 남는 것이었다(노드 17,342개가 로드된 상태로).
  // 세제곱근으로 키우면 노드당 부피가 일정하게 유지된다.
  if (options?.brainScale === undefined && n > 3000) {
    const grow = Math.cbrt(n / 3000);
    opts.brainScale = [
      DEFAULTS.brainScale[0] * grow,
      DEFAULTS.brainScale[1] * grow,
      DEFAULTS.brainScale[2] * grow,
    ];
  }

  // 발산 안전장치. 위의 밀도 보정으로 정상 범위에서는 걸릴 일이 없지만, 물리 상수를 건드리거나
  // 좌표가 거의 겹치는 입력이 오면 한 스텝에 좌표가 튀어 NaN 이 된다. 스텝당 이동량을 부피
  // 대비 상수로 묶어두면 최악의 경우에도 배치가 못생겨질 뿐 절대 NaN 이 되지 않는다.
  const maxStep = Math.max(opts.brainScale[0], opts.brainScale[1], opts.brainScale[2]) * 0.08;

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

    // 반발력 — Barnes-Hut 옥트리 근사.
    //
    // 예전엔 모든 쌍을 도는 O(n²) 였다(파일 헤더는 이미 Barnes-Hut 이라고 적어두고 있었는데
    // 구현은 brute force 였다). n<2000 에서는 문제가 없었지만 전량 볼트(17,342 노트)에서는
    // 17,342²/2 x 200 iter ≈ 300억 연산 = 워커가 영원히 안 끝나고 화면이 빈 채로 남았다.
    // 옥트리는 같은 1/d² 힘을 O(n log n) 으로 계산한다.
    buildOctree(pos, n);
    for (let i = 0; i < n; i++) {
      applyRepulsion(i, pos, vel, repForce);
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

      // 속도 적용 + 감쇠 (스텝 클램프 — 위 maxStep 주석 참조)
      let vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2];
      if (!Number.isFinite(vx)) vx = 0;
      if (!Number.isFinite(vy)) vy = 0;
      if (!Number.isFinite(vz)) vz = 0;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > maxStep) {
        const k = maxStep / speed;
        vx *= k; vy *= k; vz *= k;
      }
      pos[i * 3]     += vx;
      pos[i * 3 + 1] += vy;
      pos[i * 3 + 2] += vz;
      vel[i * 3]     = vx * opts.damping;
      vel[i * 3 + 1] = vy * opts.damping;
      vel[i * 3 + 2] = vz * opts.damping;
    }

    // 매 20 iteration마다 중간 결과 전송 (애니메이션)
    if (iter % 20 === 0 || iter === opts.iterations - 1) {
      // 마지막 방어선: 렌더러에는 절대 NaN 을 보내지 않는다. three 는 position 에 NaN 이
      // 하나만 있어도 boundingSphere 반지름이 NaN 이 되고, 프러스텀 컬링이 지오메트리 전체를
      // 버려서 화면이 통째로 비어버린다 — 노드 개수는 정상으로 표시된 채로.
      const positions: Array<[number, number, number]> = [];
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        positions.push([
          Number.isFinite(x) ? x : 0,
          Number.isFinite(y) ? y : 0,
          Number.isFinite(z) ? z : 0,
        ]);
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

// ─── Barnes-Hut 옥트리 ───
//
// 전부 평면 타입드 배열이다. iteration 마다 트리를 다시 세우므로(노드가 움직인다) 셀마다
// 객체를 만들면 200회 x 수만 개 할당 = GC 가 시뮬레이션보다 비싸진다. 배열은 한 번 잡고 재사용한다.
//
// octPoint 로 셀의 종류를 구분한다:
//   >= 0 : 점 하나만 든 leaf (그 점의 인덱스). 힘은 정확히 쌍으로 계산하고, 자기 자신이면 건너뛴다.
//   -1   : 내부 노드 (자식 있음).
//   -2   : 버킷 leaf — MAX_DEPTH 까지 갔는데도 안 갈라진 거의 겹친 점들. COM 으로만 근사한다.
//
// ★단일점 leaf 를 정확히 계산하는 것이 핵심이다. 처음엔 leaf 도 전부 COM 으로 뭉갰는데,
// 그러면 (a) 자기 자신의 질량이 COM 에 섞이고 (b) 두 점이 든 leaf 가 "중점에 질량 2" 로 바뀌어
// 1/d² 힘을 최대 8배로 부풀린다. 가까운 쌍이 이 힘을 지배하므로 오차가 전체 평균 20~28% 까지
// 났다(brute force 와 직접 비교 실측). 자기 제외 + 단일점 정확 계산으로 1% 아래로 떨어진다.
const THETA = 0.8;        // s/d < THETA 면 셀 하나로 뭉쳐서 계산. 0.8 = 정확도/속도 통상값.
const MAX_DEPTH = 24;     // 좌표가 거의 같은 노드들이 무한 세분되는 것을 막는다.

let octChild = new Int32Array(0);
let octPoint = new Int32Array(0);
let octComX = new Float64Array(0);
let octComY = new Float64Array(0);
let octComZ = new Float64Array(0);
let octMass = new Float64Array(0);
let octCx = new Float64Array(0);
let octCy = new Float64Array(0);
let octCz = new Float64Array(0);
let octHalf = new Float64Array(0);
let octDepth = new Int32Array(0);
let octCount = 0;
let octCap = 0;

function ensureOctreeCapacity(cells: number): void {
  if (octCap >= cells) return;
  octCap = cells;
  octChild = new Int32Array(cells * 8);
  octPoint = new Int32Array(cells);
  octComX = new Float64Array(cells);
  octComY = new Float64Array(cells);
  octComZ = new Float64Array(cells);
  octMass = new Float64Array(cells);
  octCx = new Float64Array(cells);
  octCy = new Float64Array(cells);
  octCz = new Float64Array(cells);
  octHalf = new Float64Array(cells);
  octDepth = new Int32Array(cells);
}

function newCell(cx: number, cy: number, cz: number, half: number, depth: number): number {
  const c = octCount++;
  const base = c * 8;
  for (let k = 0; k < 8; k++) octChild[base + k] = -1;
  octPoint[c] = -1;
  octComX[c] = 0; octComY[c] = 0; octComZ[c] = 0; octMass[c] = 0;
  octCx[c] = cx; octCy[c] = cy; octCz[c] = cz; octHalf[c] = half; octDepth[c] = depth;
  return c;
}

function accumulate(cell: number, x: number, y: number, z: number): void {
  const m = octMass[cell];
  octComX[cell] = (octComX[cell] * m + x) / (m + 1);
  octComY[cell] = (octComY[cell] * m + y) / (m + 1);
  octComZ[cell] = (octComZ[cell] * m + z) / (m + 1);
  octMass[cell] = m + 1;
}

function octantOf(cell: number, x: number, y: number, z: number): number {
  return (x > octCx[cell] ? 1 : 0) | (y > octCy[cell] ? 2 : 0) | (z > octCz[cell] ? 4 : 0);
}

function childCell(cell: number, oct: number): number {
  let c = octChild[cell * 8 + oct];
  if (c < 0) {
    const half = octHalf[cell] * 0.5;
    c = newCell(
      octCx[cell] + (oct & 1 ? half : -half),
      octCy[cell] + (oct & 2 ? half : -half),
      octCz[cell] + (oct & 4 ? half : -half),
      half, octDepth[cell] + 1,
    );
    octChild[cell * 8 + oct] = c;
  }
  return c;
}

function buildOctree(pos: Float64Array, n: number): void {
  let maxAbs = 1;
  for (let i = 0; i < n * 3; i++) {
    const v = Math.abs(pos[i]);
    if (v > maxAbs && Number.isFinite(v)) maxAbs = v;
  }
  // 실측상 셀은 점 수의 2배 남짓이면 충분하다. 모자라면 삽입 쪽이 버킷 leaf 로 접어
  // 넣으므로(정확도만 조금 잃고) 절대 넘치지 않는다.
  ensureOctreeCapacity(Math.max(64, n * 4));
  octCount = 0;
  newCell(0, 0, 0, maxAbs * 1.01, 0); // root = 0

  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    insertPoint(i, x, y, z, pos);
  }
}

function insertPoint(i: number, x: number, y: number, z: number, pos: Float64Array): void {
  let cell = 0;
  for (;;) {
    if (octMass[cell] === 0) {                    // 빈 셀 → 이 점만 든 leaf
      octMass[cell] = 1;
      octComX[cell] = x; octComY[cell] = y; octComZ[cell] = z;
      octPoint[cell] = i;
      return;
    }
    if (octPoint[cell] === -2) {                  // 버킷 leaf — 계속 흡수
      accumulate(cell, x, y, z);
      return;
    }
    if (octPoint[cell] >= 0) {                    // 단일점 leaf → 갈라야 한다
      const q = octPoint[cell];
      if (octDepth[cell] >= MAX_DEPTH || octCount + 8 > octCap) {
        octPoint[cell] = -2;                      // 더 못 쪼갬 → 버킷으로 강등
        accumulate(cell, x, y, z);
        return;
      }
      octPoint[cell] = -1;                        // 내부 노드로 승격
      // 기존 점 q 를 자식으로 내린다. 이 셀은 방금까지 leaf 였으므로 자식은 전부 비어 있다.
      const qx = pos[q * 3], qy = pos[q * 3 + 1], qz = pos[q * 3 + 2];
      const qc = childCell(cell, octantOf(cell, qx, qy, qz));
      octMass[qc] = 1; octComX[qc] = qx; octComY[qc] = qy; octComZ[qc] = qz;
      octPoint[qc] = q;
    }
    accumulate(cell, x, y, z);                    // 지나가는 내부 노드 갱신
    cell = childCell(cell, octantOf(cell, x, y, z));
  }
}

// 순회 스택. 재귀는 17k x 200 iter 에서 호출 오버헤드가 그대로 붙는다.
let octStack: Int32Array<ArrayBuffer> = new Int32Array(4096);

function applyRepulsion(i: number, pos: Float64Array, vel: Float64Array, repForce: number): void {
  const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
  let fx = 0, fy = 0, fz = 0;
  let sp = 0;
  octStack[sp++] = 0; // root
  while (sp > 0) {
    const cell = octStack[--sp];
    const mass = octMass[cell];
    if (mass === 0) continue;

    const point = octPoint[cell];
    if (point === i) continue;                    // 자기 자신 — brute force 루프와 동일하게 제외

    const dx = octComX[cell] - px;
    const dy = octComY[cell] - py;
    const dz = octComZ[cell] - pz;
    const distSq = dx * dx + dy * dy + dz * dz + 0.01;

    // 단일점 leaf 는 근사할 것이 없다(정확), 버킷 leaf 는 더 내려갈 곳이 없다,
    // 내부 노드는 s/d < θ 일 때만 뭉친다.
    const width = octHalf[cell] * 2;
    if (point !== -1 || width * width < THETA * THETA * distSq) {
      const inv = repForce * mass / (distSq * Math.sqrt(distSq));
      fx -= dx * inv;
      fy -= dy * inv;
      fz -= dz * inv;
      continue;
    }
    if (sp + 8 > octStack.length) octStack = growStack(octStack);
    const base = cell * 8;
    for (let k = 0; k < 8; k++) {
      const c = octChild[base + k];
      if (c >= 0) octStack[sp++] = c;
    }
  }
  vel[i * 3] += fx;
  vel[i * 3 + 1] += fy;
  vel[i * 3 + 2] += fz;
}

function growStack(cur: Int32Array): Int32Array<ArrayBuffer> {
  const next = new Int32Array(cur.length * 2);
  next.set(cur);
  return next;
}
