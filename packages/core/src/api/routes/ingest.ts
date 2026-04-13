// Ingest routes: text/URL ingest, file upload, web clipper
// Extracted from server.ts for modular architecture.

import { Router } from 'express';
import type { VectorStore } from '../../store/types.js';

interface IngestRouterOptions {
  store: VectorStore;
  vaultPath: string;
  requireAuth: (req: any, res: any, next: any) => void;
  assertNotPrivateUrl: (url: string) => void;
}

export function createIngestRouter(opts: IngestRouterOptions): Router {
  const { store, vaultPath, requireAuth, assertNotPrivateUrl } = opts;
  const router = Router();

  // POST /ingest — 웹 UI에서 URL/텍스트 인제스트
  router.post('/ingest', requireAuth, async (req, res) => {
    try {
      const { input, type, tags, title, stage, locale } = req.body;

      if (locale) {
        const { setNoteLocale } = await import('../../i18n/note-strings.js');
        setNoteLocale(locale);
      }
      if (!input || typeof input !== 'string') {
        res.status(400).json({ error: 'input is required' });
        return;
      }

      let content = input;
      let autoTitle = title;
      let autoTags = tags ?? [];
      let autoStage = stage ?? 'fleeting';
      const isYouTube = /youtube\.com\/watch|youtu\.be\//.test(input);

      if (isYouTube) {
        try {
          const { extractYouTubeContent, formatYouTubeNote } = await import('../../intelligence/youtube-extractor.js');
          const ytContent = await extractYouTubeContent(input);
          autoTitle = ytContent.title;
          autoTags = [...new Set(['youtube', ...ytContent.tags, ...(tags ?? [])])];
          autoStage = 'literature';
          content = formatYouTubeNote(ytContent);
        } catch (ytErr) {
          console.error('[ingest] YouTube extraction failed, falling back to basic:', ytErr instanceof Error ? ytErr.message : ytErr);
          try {
            const resp = await fetch(input, { signal: AbortSignal.timeout(8000) });
            const html = await resp.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch && !autoTitle) autoTitle = titleMatch[1].trim();
            content = input + '\n\n' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
          } catch (e) { console.error('[ingest] YouTube HTML fallback failed:', e instanceof Error ? e.message : e); }
        }
      } else if (input.startsWith('http')) {
        // HIGH-01: SSRF protection
        try { assertNotPrivateUrl(input); } catch (e: unknown) {
          res.status(400).json({ error: (e as Error).message }); return;
        }
        try {
          const resp = await fetch(input, { signal: AbortSignal.timeout(8000) });
          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch && !autoTitle) autoTitle = titleMatch[1].trim();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 5000);
          content = input + '\n\n' + text;
        } catch (e) { console.error('[ingest] URL fetch failed:', e instanceof Error ? e.message : e); }
      }

      const { ingest } = await import('../../intelligence/ingest-pipeline.js');
      const result = ingest(vaultPath, {
        type: type ?? (isYouTube ? 'youtube' : input.startsWith('http') ? 'url' : 'text'),
        content,
        tags: autoTags,
        title: autoTitle,
        stage: autoStage as any,
        source: input.startsWith('http') ? input : undefined,
      });

      try {
        const doc = {
          id: require('node:crypto').createHash('sha256').update(result.savedTo).digest('hex').slice(0, 16),
          filePath: result.savedTo,
          title: result.title,
          content: content,
          frontmatter: {},
          tags: result.tags,
          lastModified: new Date().toISOString(),
          contentHash: '',
          source: 'ingest',
          type: result.stage,
        };
        await store.upsertDocument(doc);
      } catch (indexErr) {
        console.error('[ingest] Auto-index failed:', indexErr instanceof Error ? indexErr.message : indexErr);
      }

      res.json({
        success: true,
        savedTo: result.savedTo,
        stage: result.stage,
        title: result.title,
        indexCode: result.indexCode,
        tags: result.tags,
        wordCount: result.wordCount,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Ingest failed' });
    }
  });

  // POST /ingest/file — 웹 UI에서 파일 드래그앤드롭 인제스트
  router.post('/ingest/file', requireAuth, async (req, res) => {
    try {
      const multer = (await import('multer')).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

      upload.single('file')(req, res, async (uploadErr: any) => {
        if (uploadErr) {
          res.status(400).json({ error: uploadErr.message || 'Upload failed' });
          return;
        }
        const file = (req as any).file;
        if (!file) {
          res.status(400).json({ error: 'No file provided' });
          return;
        }

        const allowedMimes = new Set([
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/plain', 'text/markdown', 'text/csv',
          'application/json', 'text/json',
          'text/xml', 'application/xml',
          'text/html',
          'text/yaml', 'application/x-yaml',
          'application/rtf', 'text/rtf',
        ]);
        if (!allowedMimes.has(file.mimetype)) {
          res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` });
          return;
        }

        try {
          const { writeFileSync, unlinkSync } = await import('node:fs');
          const { join } = await import('node:path');
          const { tmpdir } = await import('node:os');
          const safeName = (file.originalname ?? 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
          const tmpPath = join(tmpdir(), `sv-upload-${Date.now()}-${safeName}`);

          writeFileSync(tmpPath, file.buffer);

          const { extractFileContent } = await import('../../intelligence/file-extractors.js');
          const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
          const binaryExts = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'xls']);

          let content: string;
          let extractedTitle: string | undefined;
          let formatTag: string = ext;

          if (binaryExts.has(ext)) {
            const extracted = await extractFileContent(tmpPath);
            content = extracted.text;
            extractedTitle = extracted.metadata.title;
            formatTag = extracted.sourceFormat;
          } else {
            content = file.buffer.toString('utf-8');
          }

          try { unlinkSync(tmpPath); } catch { /* ok */ }

          const locale = req.body?.locale;
          if (locale) {
            const { setNoteLocale } = await import('../../i18n/note-strings.js');
            setNoteLocale(locale);
          }

          const tags = req.body?.tags ? (Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(',').map((t: string) => t.trim())) : [];
          const { ingest } = await import('../../intelligence/ingest-pipeline.js');
          const result = ingest(vaultPath, {
            type: formatTag as any,
            content,
            tags: [...tags, formatTag],
            title: req.body?.title ?? extractedTitle,
            stage: 'fleeting',
            source: file.originalname,
          });

          try {
            const doc = {
              id: require('node:crypto').createHash('sha256').update(result.savedTo).digest('hex').slice(0, 16),
              filePath: result.savedTo,
              title: result.title,
              content,
              frontmatter: {},
              tags: result.tags,
              lastModified: new Date().toISOString(),
              contentHash: '',
              source: 'upload',
              type: result.stage,
            };
            await store.upsertDocument(doc);
          } catch (indexErr) {
            console.error('[ingest/file] Auto-index failed:', indexErr instanceof Error ? indexErr.message : indexErr);
          }

          res.json({
            success: true,
            savedTo: result.savedTo,
            stage: result.stage,
            title: result.title,
            indexCode: result.indexCode,
            tags: result.tags,
            wordCount: result.wordCount,
          });
        } catch (err) {
          console.error('[ingest/file] Processing failed:', err instanceof Error ? err.message : err);
          res.status(500).json({ error: 'Processing failed' });
        }
      });
    } catch (err) {
      console.error('[ingest/file] Upload init failed:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'File upload initialization failed' });
    }
  });

  // POST /clip — 웹 페이지 클리핑
  router.post('/clip', requireAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) { res.status(400).json({ error: 'url required' }); return; }

      try { assertNotPrivateUrl(url); } catch (e: unknown) {
        res.status(400).json({ error: (e as Error).message }); return;
      }

      const isYT = /youtube\.com\/watch|youtu\.be\//.test(url);
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 stellavault-clipper/1.0' }, signal: AbortSignal.timeout(15000) });
      const html = await response.text();

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      let title = (titleMatch ? titleMatch[1] : new URL(url).hostname).replace(/ - YouTube$/, '').trim();
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

      let content: string;
      if (isYT) {
        const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)?.[1] ?? '';
        const descMatch = html.match(/"shortDescription":"([\s\S]*?)"/);
        const desc = descMatch ? descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').slice(0, 3000) : '';
        content = `![thumbnail](https://img.youtube.com/vi/${videoId}/maxresdefault.jpg)\n\n## 설명\n\n${desc}\n\n[YouTube](${url})`;
      } else {
        content = html
          .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n').replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
          .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
          .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n').replace(/<br\s*\/?>/gi, '\n')
          .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
          .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
          .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
          .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
          .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          .replace(/\n{3,}/g, '\n\n').trim();
        if (content.length > 10000) content = content.slice(0, 10000) + '\n\n...(truncated)';
      }

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const date = new Date().toISOString().slice(0, 10);
      const clipDir = join(vaultPath || '.', '06_Research', 'clips');
      mkdirSync(clipDir, { recursive: true });

      const fileName = `${date} ${safeTitle}.md`;
      const md = `---\ntitle: "${safeTitle}"\nsource: "${url}"\nclipped: ${date}\ntags: [clip${isYT ? ', youtube' : ''}]\n---\n\n# ${safeTitle}\n\n> Source: ${url}\n\n${content}`;
      writeFileSync(join(clipDir, fileName), md, 'utf-8');

      res.json({ success: true, fileName, path: join(clipDir, fileName) });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Clip failed' });
    }
  });

  return router;
}
