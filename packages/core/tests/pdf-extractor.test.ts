import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFileContent } from '../src/intelligence/file-extractors.js';

// 최소한의 유효한 PDF 하나 — 페이지 1, 본문 "Hello Stellavault".
// 외부 픽스처 파일 없이 시험이 자급하도록 바이트를 직접 조립한다.
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objs) { offsets.push(body.length); body += o; }
  const xref = body.length;
  body += `xref\n0 6\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

describe('PDF 추출 — 패치된 pdfjs 로', () => {
  // GHSA-hq66-cqwq-w95j: unpdf 의 <번들> pdfjs(5.6.205)는 취약 범위였고 npm audit 에 안 보였다.
  // 이 시험이 재는 것 둘: ① 스왑 후에도 추출이 실제로 동작한다 ② 로드된 pdfjs 가 패치판이다.
  it('진짜 PDF 에서 텍스트를 꺼낸다 (스왑이 추출을 깨지 않았다)', async () => {
    const dir = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'pdf-'));
    const p = join(dir, 'probe.pdf');
    try {
      writeFileSync(p, minimalPdf('Hello Stellavault'));
      const r = await extractFileContent(p);
      expect(r.sourceFormat).toBe('pdf');
      expect(r.text).toContain('Hello Stellavault');
      expect(r.metadata.pageCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('로드된 pdfjs 가 취약 범위(<6.2.108) 밖이다', async () => {
    const { getResolvedPDFJS } = await import('unpdf');
    const pdfjs = (await getResolvedPDFJS()) as { version?: string };
    const v = String(pdfjs.version ?? '');
    expect(v).not.toBe('');
    const [maj, min, pat] = v.split('.').map(Number);
    const ok = maj > 6 || (maj === 6 && (min > 2 || (min === 2 && pat >= 108)));
    expect(ok, `loaded pdfjs ${v} is inside the vulnerable range`).toBe(true);
  });
});
