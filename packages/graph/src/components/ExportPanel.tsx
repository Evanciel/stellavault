// Design Ref: §4.1 — 내보내기 UI 패널
// Plan SC: SC-01 (스크린샷), SC-02 (WebM 녹화)

import { useState } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import { useExport } from '../hooks/useExport.js';

export function ExportPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [watermark, setWatermark] = useState(true);
  const [duration, setDuration] = useState(5);

  const isRecording = useGraphStore((s) => s.isRecording);
  const isExporting = useGraphStore((s) => s.isExporting);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const {
    takeScreenshot,
    startRecording,
    stopRecording,
    recordingDuration,
    isMediaRecorderSupported,
  } = useExport();

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        title="Export"
        style={{
          background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
          borderRadius: '4px',
          padding: '2px 8px',
          color: isDark ? '#667' : '#555',
          fontSize: '10px',
          cursor: 'pointer',
        }}
      >
        Export
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '40px',
      right: '16px',
      background: isDark ? 'rgba(10, 12, 28, 0.95)' : 'rgba(255, 255, 255, 0.97)',
      border: `1px solid ${isDark ? 'rgba(100, 120, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)'}`,
      borderRadius: '8px',
      padding: '12px 16px',
      width: '240px',
      backdropFilter: 'blur(12px)',
      boxShadow: isDark ? 'none' : '0 4px 16px rgba(0,0,0,0.08)',
      zIndex: 100,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '10px',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: isDark ? '#c0c0f0' : '#2a2a4a' }}>
          Export
        </span>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            background: 'none', border: 'none', color: isDark ? '#556' : '#999',
            cursor: 'pointer', fontSize: '14px',
          }}
        >
          x
        </button>
      </div>

      {/* Options */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '11px', color: '#889', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
            style={{ accentColor: '#6366f1' }}
          />
          Watermark
        </label>
      </div>

      {/* Screenshot Button */}
      <button
        onClick={() => takeScreenshot({ watermark })}
        disabled={isExporting || isRecording}
        style={{
          width: '100%',
          padding: '6px',
          marginBottom: '6px',
          background: isExporting ? 'rgba(100,120,255,0.2)' : 'rgba(100,120,255,0.12)',
          border: '1px solid rgba(100,120,255,0.2)',
          borderRadius: '4px',
          color: '#c0d0ff',
          fontSize: '11px',
          cursor: isExporting ? 'wait' : 'pointer',
        }}
      >
        {isExporting ? 'Capturing...' : 'Screenshot (PNG)'}
      </button>

      {/* Recording */}
      {isMediaRecorderSupported ? (
        <>
          {!isRecording ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{
                  flex: '0 0 60px',
                  background: 'rgba(100,120,255,0.08)',
                  border: '1px solid rgba(100,120,255,0.15)',
                  borderRadius: '4px',
                  color: '#889',
                  fontSize: '11px',
                  padding: '4px',
                }}
              >
                <option value={3}>3s</option>
                <option value={5}>5s</option>
                <option value={10}>10s</option>
              </select>
              <button
                onClick={() => startRecording({ duration, rotation: true })}
                disabled={isExporting}
                style={{
                  flex: 1,
                  padding: '6px',
                  background: 'rgba(255,80,80,0.12)',
                  border: '1px solid rgba(255,80,80,0.2)',
                  borderRadius: '4px',
                  color: '#ff8888',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Record (WebM)
              </button>
            </div>
          ) : (
            <button
              onClick={stopRecording}
              style={{
                width: '100%',
                padding: '6px',
                background: 'rgba(255,80,80,0.2)',
                border: '1px solid rgba(255,80,80,0.3)',
                borderRadius: '4px',
                color: '#ff6666',
                fontSize: '11px',
                cursor: 'pointer',
                animation: 'pulse 1s infinite',
              }}
            >
              Recording {recordingDuration.toFixed(1)}s — Stop
            </button>
          )}
        </>
      ) : (
        <div style={{ fontSize: '10px', color: '#556', marginTop: '4px' }}>
          WebM recording requires Chrome or Firefox
        </div>
      )}
    </div>
  );
}
