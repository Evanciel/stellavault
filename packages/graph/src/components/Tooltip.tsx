// 호버 툴팁 + 선택 시 연결 노드 라벨 표시

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { useGraphStore } from '../stores/graph-store.js';

const PALETTE = [
  '#818cf8', '#f472b6', '#fbbf24', '#34d399', '#60a5fa',
  '#fb7185', '#2dd4bf', '#a3e635', '#fb923c', '#a78bfa',
  '#14b8a6', '#e879f9', '#38bdf8', '#facc15', '#f87171',
];

export function Tooltip() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  // 선택된 노드의 이웃 ID
  const connectedNodes = useMemo(() => {
    if (!selectedNodeId) return [];
    const ids = new Set<string>();
    for (const e of edges) {
      if (e.source === selectedNodeId) ids.add(e.target);
      if (e.target === selectedNodeId) ids.add(e.source);
    }
    return nodes.filter(n => ids.has(n.id) && n.position);
  }, [selectedNodeId, edges, nodes]);

  const hoveredNode = hoveredNodeId ? nodes.find(n => n.id === hoveredNodeId) : null;

  return (
    <>
      {/* 호버 툴팁 (기존) */}
      {hoveredNode && hoveredNode.position && (
        <Html
          position={hoveredNode.position}
          center
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div style={{
            background: 'rgba(10, 10, 20, 0.9)',
            border: '1px solid rgba(100, 120, 255, 0.3)',
            borderRadius: '8px',
            padding: '8px 12px',
            maxWidth: '250px',
            backdropFilter: 'blur(8px)',
            transform: 'translateY(-40px)',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e0e0f0', marginBottom: '4px', lineHeight: 1.3 }}>
              {hoveredNode.label}
            </div>
            {hoveredNode.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                {hoveredNode.tags.slice(0, 3).map((tag) => (
                  <span key={tag} style={{ fontSize: '10px', color: '#88aaff', background: 'rgba(100, 120, 255, 0.15)', padding: '1px 6px', borderRadius: '4px' }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <div style={{ fontSize: '10px', color: '#666' }}>{hoveredNode.filePath}</div>
          </div>
        </Html>
      )}

      {/* 선택 시 연결 노드 라벨 */}
      {connectedNodes.map((node) => (
        <Html
          key={node.id}
          position={node.position!}
          center
          style={{ pointerEvents: 'none' }}
          zIndexRange={[90, 0]}
        >
          <div style={{
            background: 'rgba(10, 10, 20, 0.75)',
            border: `1px solid ${PALETTE[node.clusterId % PALETTE.length]}40`,
            borderRadius: '5px',
            padding: '3px 8px',
            transform: 'translateY(-25px)',
            whiteSpace: 'nowrap',
            maxWidth: '180px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            <span style={{
              fontSize: '10px',
              color: PALETTE[node.clusterId % PALETTE.length],
              fontWeight: 500,
            }}>
              {node.label}
            </span>
          </div>
        </Html>
      ))}
    </>
  );
}
