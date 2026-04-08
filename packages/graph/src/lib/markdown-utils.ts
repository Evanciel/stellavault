// Markdown ↔ HTML 변환 유틸 (TipTap 에디터용)
import DOMPurify from 'dompurify';

export function markdownToHtml(md: string): string {
  const result = md
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) =>
      `<a href="wikilink:${encodeURIComponent(target)}" class="wikilink">${display ?? target}</a>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)(?:\S*)/g,
      '<div class="sv-youtube" data-id="$1"><iframe src="https://www.youtube.com/embed/$1" frameborder="0" allowfullscreen></iframe></div>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- \[x\] (.+)$/gm, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">$1</li></ul>')
    .replace(/^- \[ \] (.+)$/gm, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">$1</li></ul>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/^---$/gm, '<hr>')
    .replace(/^(?!<[a-z])((?!^\s*$).+)$/gm, '<p>$1</p>')
    .replace(/<p>\s*<\/p>/g, '');
  return DOMPurify.sanitize(result, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder', 'data-id', 'data-type', 'data-checked'] });
}

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1>(.*?)<\/h1>/g, '# $1\n')
    .replace(/<h2>(.*?)<\/h2>/g, '## $1\n')
    .replace(/<h3>(.*?)<\/h3>/g, '### $1\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, '```\n$1```\n')
    .replace(/<blockquote>(.*?)<\/blockquote>/g, '> $1\n')
    .replace(/<a[^>]*href="wikilink:([^"]*)"[^>]*>(.*?)<\/a>/g, (_, target, display) =>
      `[[${decodeURIComponent(target)}|${display}]]`)
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/g, '![$2]($1)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/g, '![]($1)')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<li data-type="taskItem" data-checked="true">(.*?)<\/li>/g, '- [x] $1')
    .replace(/<li data-type="taskItem" data-checked="false">(.*?)<\/li>/g, '- [ ] $1')
    .replace(/<li>(.*?)<\/li>/g, '- $1')
    .replace(/<ul[^>]*>|<\/ul>/g, '')
    .replace(/<hr\s*\/?>/g, '---\n')
    .replace(/<p>(.*?)<\/p>/g, '$1\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
