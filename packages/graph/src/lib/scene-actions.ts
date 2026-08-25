// 씬 스택을 조작하는 액션들. 여러 컴포넌트(NodeDetail · StatusBar · Graph3D)가 같은 동작을
// 호출해야 해서 스토어 밖 함수로 뺐다 — 훅으로 만들면 호출 지점마다 렌더 트리에 묶인다.

import { useGraphStore } from '../stores/graph-store.js';
import { localSubgraph, tagOverlay, type SceneNode, type SceneEdge } from './scene-derive.js';

/** 로컬 그래프 진입 — 이 노트에서 N홉 안쪽만 남긴다. */
export function enterLocalGraph(rootId: string, depth?: number): void {
  const s = useGraphStore.getState();
  const d = depth ?? s.localDepth;
  const root = s.nodes.find((n) => n.id === rootId);
  if (!root) return;

  const r = localSubgraph(s.nodes as SceneNode[], s.edges as SceneEdge[], rootId, d);
  // 이웃이 하나도 없으면 화면에 점 하나만 남는다 — 들어가지 않는 편이 낫다.
  if (r.nodes.length <= 1) return;

  // 이미 로컬 그래프 안이면 프레임을 쌓지 말고 갈아끼운다(홉 수 조절이 스택을 무한정 늘리면
  // 뒤로가기가 홉 변경 이력을 되짚게 된다 — 사용자가 기대하는 "뒤로"는 원래 화면이다).
  if (s.sceneStack[s.sceneStack.length - 1]?.kind === 'local') s.popScene();

  useGraphStore.getState().pushScene({
    kind: 'local',
    key: rootId,
    label: root.label,
    nodes: r.nodes,
    edges: r.edges,
    baked: false,
  });
}

/** 현재 로컬 그래프의 홉 수를 바꾼다(로컬 프레임 안에서만 의미 있음). */
export function setLocalDepthAndRefresh(depth: number): void {
  const s = useGraphStore.getState();
  s.setLocalDepth(depth);
  const top = s.sceneStack[s.sceneStack.length - 1];
  if (top?.kind !== 'local') return;
  // popScene 이 되돌려 놓은 바탕 위에서 다시 계산한다.
  s.popScene();
  enterLocalGraph(top.key, useGraphStore.getState().localDepth);
}

export interface TagToggleResult {
  on: boolean;
  tagCount: number;
  /** minNotes 미달로 뺀 태그 수 — "왜 아무것도 안 뜨는지" UI 가 말할 수 있게. */
  skipped: number;
}

/**
 * 태그 오버레이 켜기/끄기.
 *
 * 오버레이를 별도 상태로 두지 않고 씬 프레임으로 쌓는다. 그러면 뒤로가기·breadcrumb·레이아웃
 * 재계산이 전부 기존 경로를 그대로 탄다. 대신 켜져 있는지는 "맨 위 프레임이 tag 인가"로 읽는다.
 *
 * ★이 볼트의 실측: 17,339 노트 중 태그가 달린 것은 26개(0.15%)뿐이고 2개 이상이 공유하는 태그는
 * 8개다. 즉 켜도 거의 아무것도 안 생긴다 — 기능 결함이 아니라 데이터가 없는 것이라, 호출자는
 * tagCount/skipped 를 사용자에게 그대로 보여줘야 한다.
 */
export function toggleTagScene(): TagToggleResult {
  const s = useGraphStore.getState();
  const top = s.sceneStack[s.sceneStack.length - 1];
  if (top?.kind === 'tag') {
    s.popScene();
    useGraphStore.getState().toggleTagNodes();
    return { on: false, tagCount: 0, skipped: 0 };
  }

  const overlay = tagOverlay(s.nodes as SceneNode[], {
    // 팔레트가 80색이라 태그 노드가 기존 클러스터 색과 겹치지 않게 뒤쪽에서 시작한다.
    clusterIdBase: 40,
  });
  if (overlay.tagCount === 0) {
    // 아무것도 안 올라가면 프레임을 쌓지 않는다 — 뒤로가기 버튼만 늘어난 빈 화면이 된다.
    return { on: false, tagCount: 0, skipped: overlay.skipped };
  }

  useGraphStore.getState().toggleTagNodes();
  useGraphStore.getState().pushScene({
    kind: 'tag',
    key: 'tags',
    label: `#tags (${overlay.tagCount})`,
    nodes: [...s.nodes, ...overlay.nodes],
    edges: [...s.edges, ...overlay.edges],
    baked: false,
  });
  return { on: true, tagCount: overlay.tagCount, skipped: overlay.skipped };
}
