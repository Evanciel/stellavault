// Side panel: document preview for the selected node

import { useState, useMemo, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGraphStore } from '../stores/graph-store.js';
import { t } from '../lib/i18n.js';
import { useNodeDetail } from './useNodeDetail.js';
import { NodeEditForm } from './NodeEditForm.js';

export function NodeDetail() {
  const {
    selectedNodeId, selectNode, isDark,
    doc, loading, editing,
    editTitle, setEditTitle,
    editContent, setEditContent,
    editTags, setEditTags,
    saveStatus,
    toggleEdit, pulseNode, openInObsidian, saveEdit, deleteDoc,
  } = useNodeDetail();

  if (!selectedNodeId) return null;

  // Theme colors
  const bg = isDark ? '#0d0d18' : '#fafafa';
  const border = isDark ? 'rgba(100, 120, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';
  const textPrimary = isDark ? '#e0e0f0' : '#1a1a2e';
  const textSecondary = isDark ? '#556' : '#888';
  const tagBg = isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(80, 100, 200, 0.08)';
  const tagColor = isDark ? '#88aaff' : '#4466aa';
  const btnBg = isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(80, 100, 200, 0.06)';
  const btnBorder = isDark ? 'rgba(100, 120, 255, 0.2)' : 'rgba(80, 100, 200, 0.15)';
  const btnColor = isDark ? '#88aaff' : '#4466aa';

  return (
    <div style={{
      width: '380px', background: bg,
      borderLeft: `1px solid ${border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: '11px', color: textSecondary, textTransform: 'uppercase', letterSpacing: '1px' }}>
          Document Preview
        </span>
        <button
          onClick={() => selectNode(null)}
          style={{ background: 'none', border: 'none', color: textSecondary, cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
        >
          x
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '24px 16px', color: textSecondary }}>Loading...</div>
      ) : doc ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {/* Title */}
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: textPrimary, marginBottom: '6px', lineHeight: 1.3 }}>
            {doc.title}
          </h2>

          {/* Tags */}
          {doc.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {doc.tags.map((tag) => (
                <span key={tag} style={{ fontSize: '10px', color: tagColor, background: tagBg, padding: '1px 7px', borderRadius: '4px' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Date */}
          <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '12px' }}>
            {new Date(doc.lastModified).toLocaleDateString('ko-KR')}
          </div>

          {/* Action buttons */}
          <button
            onClick={pulseNode}
            style={{
              width: '100%', padding: '7px', marginBottom: '8px',
              background: btnBg, border: `1px solid ${btnBorder}`,
              borderRadius: '5px', color: btnColor, fontSize: '11px', cursor: 'pointer',
            }}
          >
            Explore connections
          </button>
          <button
            onClick={openInObsidian}
            style={{
              width: '100%', padding: '7px', marginBottom: '14px',
              background: isDark ? 'rgba(140, 100, 255, 0.08)' : 'rgba(120, 80, 200, 0.05)',
              border: `1px solid ${isDark ? 'rgba(140, 100, 255, 0.15)' : 'rgba(120, 80, 200, 0.12)'}`,
              borderRadius: '5px', color: isDark ? '#a088ff' : '#6644aa', fontSize: '11px', cursor: 'pointer',
            }}
          >
            Open in Obsidian
          </button>

          {/* Edit / Delete buttons */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
            <button
              onClick={toggleEdit}
              style={{
                flex: 1, padding: '7px', background: editing ? btnBg : 'transparent',
                border: `1px solid ${btnBorder}`, borderRadius: '5px',
                color: btnColor, fontSize: '11px', cursor: 'pointer',
              }}
            >
              {editing ? t('node.editCancel') : t('node.edit')}
            </button>
            <button
              onClick={() => {
                if (!confirm(`"${doc.title}"\n${t('node.deleteConfirm')}`)) return;
                deleteDoc();
              }}
              style={{
                padding: '7px 12px', background: 'transparent',
                border: `1px solid ${isDark ? 'rgba(255,80,80,0.2)' : 'rgba(200,50,50,0.15)'}`,
                borderRadius: '5px', color: isDark ? '#ff6666' : '#cc3333',
                fontSize: '11px', cursor: 'pointer',
              }}
            >
              {t('node.delete')}
            </button>
          </div>

          {/* Edit form or content display */}
          {editing ? (
            <NodeEditForm
              editTitle={editTitle}
              setEditTitle={setEditTitle}
              editContent={editContent}
              setEditContent={setEditContent}
              editTags={editTags}
              setEditTags={setEditTags}
              saveStatus={saveStatus}
              onSave={saveEdit}
              isDark={isDark}
            />
          ) : (
            <ContentAccordion content={doc.content} isDark={isDark} />
          )}

          {/* Related documents */}
          {doc.related.length > 0 && (
            <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: `1px solid ${border}` }}>
              <div style={{ fontSize: '10px', color: textSecondary, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                Related
              </div>
              {doc.related.map((r) => (
                <div
                  key={r.id}
                  onClick={() => selectNode(r.id)}
                  style={{ padding: '4px 0', fontSize: '11px', color: isDark ? '#778' : '#555', cursor: 'pointer' }}
                >
                  {r.title}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Convert [[wikilink]] to markdown links + YouTube URL to embeds */
function processWikilinks(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) =>
      `[${display ?? target}](wikilink:${encodeURIComponent(target)})`)
    .replace(/^(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)\S*)$/gm,
      '[![YouTube](https://img.youtube.com/vi/$2/hqdefault.jpg)]($1)');
}

/** Rich markdown renderer with wikilink navigation, external links, and code highlight */
function RichMarkdown({ children, isDark }: { children: string; isDark: boolean }) {
  const handleWikilinkClick = useCallback((target: string) => {
    const store = useGraphStore.getState();
    const decoded = decodeURIComponent(target);
    const node = store.nodes.find(n =>
      n.label === decoded ||
      n.filePath?.includes(decoded) ||
      n.label?.toLowerCase().includes(decoded.toLowerCase())
    );
    if (node) {
      store.selectNode(node.id);
      store.setHighlightedNodes([node.id]);
    }
  }, []);

  const processed = processWikilinks(children);

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children: linkChildren }) => {
          if (href?.startsWith('wikilink:')) {
            const target = href.replace('wikilink:', '');
            return (
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); handleWikilinkClick(target); }}
                style={{
                  color: isDark ? '#818cf8' : '#6366f1',
                  textDecoration: 'none',
                  borderBottom: `1px dashed ${isDark ? '#818cf880' : '#6366f180'}`,
                  cursor: 'pointer',
                }}
                title={`Go to: ${decodeURIComponent(target)}`}
              >
                {linkChildren}
              </a>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: isDark ? '#22d3ee' : '#0891b2',
                textDecoration: 'none',
                borderBottom: `1px solid ${isDark ? '#22d3ee40' : '#0891b240'}`,
              }}
            >
              {linkChildren}
            </a>
          );
        },
        code: ({ className, children: codeChildren, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code style={{
                background: isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.06)',
                padding: '2px 6px', borderRadius: '4px',
                fontSize: '12px', fontFamily: "'DM Mono', monospace",
                color: isDark ? '#c0c0f0' : '#6366f1',
              }}>
                {codeChildren}
              </code>
            );
          }
          return (
            <pre style={{
              background: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
              padding: '12px 16px', borderRadius: '8px',
              overflow: 'auto', fontSize: '12px',
              fontFamily: "'DM Mono', monospace",
              border: `1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
              lineHeight: 1.6,
            }}>
              <code className={className} style={{ color: isDark ? '#c8c8e0' : '#333' }}>
                {codeChildren}
              </code>
            </pre>
          );
        },
        blockquote: ({ children: bqChildren }) => (
          <blockquote style={{
            borderLeft: `3px solid ${isDark ? '#6366f1' : '#6366f1'}`,
            margin: '8px 0', padding: '4px 12px',
            color: isDark ? '#9898b8' : '#666',
            fontSize: '13px',
          }}>
            {bqChildren}
          </blockquote>
        ),
        table: ({ children: tChildren }) => (
          <div style={{ overflowX: 'auto', margin: '8px 0' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse', fontSize: '12px',
              border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
            }}>
              {tChildren}
            </table>
          </div>
        ),
        th: ({ children: thChildren }) => (
          <th style={{
            padding: '6px 10px', textAlign: 'left',
            borderBottom: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
            background: isDark ? 'rgba(100,120,255,0.05)' : 'rgba(0,0,0,0.02)',
            fontSize: '11px', fontWeight: 600,
          }}>
            {thChildren}
          </th>
        ),
        td: ({ children: tdChildren }) => (
          <td style={{
            padding: '5px 10px',
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}`,
          }}>
            {tdChildren}
          </td>
        ),
        hr: () => (
          <hr style={{
            border: 'none', height: '1px', margin: '16px 0',
            background: isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)',
          }} />
        ),
      }}
    >
      {processed}
    </Markdown>
  );
}

/** Collapsible content sections split by headings */
function ContentAccordion({ content, isDark }: { content: string; isDark: boolean }) {
  const sections = useMemo(() => {
    const parts: Array<{ heading: string; body: string }> = [];
    const lines = content.split('\n');
    let currentHeading = 'Overview';
    let currentBody: string[] = [];

    for (const line of lines) {
      const match = line.match(/^#{1,3}\s+(.+)$/);
      if (match) {
        if (currentBody.length > 0) {
          parts.push({ heading: currentHeading, body: currentBody.join('\n') });
        }
        currentHeading = match[1];
        currentBody = [];
      } else {
        currentBody.push(line);
      }
    }
    if (currentBody.length > 0) {
      parts.push({ heading: currentHeading, body: currentBody.join('\n') });
    }

    return parts;
  }, [content]);

  const bodyColor = isDark ? '#b0b0c0' : '#444';

  if (content.length < 500 || sections.length <= 1) {
    return (
      <div style={{ fontSize: '13px', lineHeight: 1.7, color: bodyColor }}>
        <RichMarkdown isDark={isDark}>{content}</RichMarkdown>
      </div>
    );
  }

  return (
    <div>
      {sections.map((sec, i) => (
        <AccordionSection key={i} heading={sec.heading} body={sec.body} defaultOpen={i === 0} isDark={isDark} />
      ))}
    </div>
  );
}

/** Single accordion section with toggle */
function AccordionSection({ heading, body, defaultOpen, isDark }: { heading: string; body: string; defaultOpen: boolean; isDark: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = body.trim();
  if (!trimmed) return null;

  return (
    <div style={{ borderBottom: `1px solid ${isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.05)'}`, marginBottom: '4px' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        <span style={{
          fontSize: '10px', color: isDark ? '#556' : '#999', transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          ▶
        </span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: isDark ? '#99a' : '#555' }}>
          {heading}
        </span>
      </button>
      {open && (
        <div style={{ fontSize: '13px', lineHeight: 1.7, color: isDark ? '#b0b0c0' : '#444', paddingBottom: '8px' }}>
          <RichMarkdown isDark={isDark}>{trimmed}</RichMarkdown>
        </div>
      )}
    </div>
  );
}
