// Design Ref: §3.1 — MST 별자리 생성
// Prim's MST: 클러스터 내 노드를 최소 거리로 연결 → 자연스러운 별자리 형태

interface Node {
  id: string;
  clusterId: number;
  position?: [number, number, number];
}

interface Cluster {
  id: number;
  label: string;
  color: string;
}

export interface ConstellationLine {
  from: [number, number, number];
  to: [number, number, number];
  clusterId: number;
}

export interface ConstellationLabel {
  position: [number, number, number];
  text: string;
  color: string;
  clusterId: number;
}

export interface ConstellationData {
  lines: ConstellationLine[];
  labels: ConstellationLabel[];
}

export function buildConstellations(nodes: Node[], clusters: Cluster[]): ConstellationData {
  const lines: ConstellationLine[] = [];
  const labels: ConstellationLabel[] = [];

  for (const cluster of clusters) {
    const clusterNodes = nodes.filter(n => n.clusterId === cluster.id && n.position);
    if (clusterNodes.length < 2) {
      // 단일 노드 클러스터도 라벨은 표시
      if (clusterNodes.length === 1 && clusterNodes[0].position) {
        labels.push({
          position: clusterNodes[0].position!,
          text: cluster.label,
          color: cluster.color,
          clusterId: cluster.id,
        });
      }
      continue;
    }

    // Prim's MST
    const positions = clusterNodes.map(n => n.position!);
    const n = positions.length;
    const inMST = new Array(n).fill(false);
    const minEdge = new Array(n).fill(Infinity);
    const parent = new Array(n).fill(-1);
    minEdge[0] = 0;

    for (let iter = 0; iter < n; iter++) {
      // 최소 비용 노드 선택
      let u = -1;
      for (let i = 0; i < n; i++) {
        if (!inMST[i] && (u === -1 || minEdge[i] < minEdge[u])) u = i;
      }
      if (u === -1) break;
      inMST[u] = true;

      // 엣지 추가
      if (parent[u] !== -1) {
        lines.push({
          from: positions[parent[u]],
          to: positions[u],
          clusterId: cluster.id,
        });
      }

      // 인접 노드 업데이트
      for (let v = 0; v < n; v++) {
        if (inMST[v]) continue;
        const d = dist3D(positions[u], positions[v]);
        if (d < minEdge[v]) {
          minEdge[v] = d;
          parent[v] = u;
        }
      }
    }

    // 클러스터 중심에 라벨
    const cx = positions.reduce((s, p) => s + p[0], 0) / n;
    const cy = positions.reduce((s, p) => s + p[1], 0) / n + 20; // 약간 위
    const cz = positions.reduce((s, p) => s + p[2], 0) / n;
    labels.push({
      position: [cx, cy, cz],
      text: cluster.label,
      color: cluster.color,
      clusterId: cluster.id,
    });
  }

  return { lines, labels };
}

function dist3D(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
