// Pack Marketplace (F-A07) — npm registry + GitHub Releases 기반
// 서버 불필요: npm/GitHub를 마켓플레이스로 활용

export interface PackListing {
  name: string;
  version: string;
  description: string;
  author: string;
  downloads?: number;
  tags: string[];
  source: 'npm' | 'github';
  installCommand: string;
}

// npm에서 @stellavault/pack-* 패키지 검색
export async function searchMarketplace(query: string, limit = 10): Promise<PackListing[]> {
  const results: PackListing[] = [];

  try {
    // npm registry search
    const npmUrl = `https://registry.npmjs.org/-/v1/search?text=stellavault-pack+${encodeURIComponent(query)}&size=${limit}`;
    const res = await fetch(npmUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as any;
      for (const pkg of data.objects ?? []) {
        results.push({
          name: pkg.package.name,
          version: pkg.package.version,
          description: pkg.package.description ?? '',
          author: pkg.package.author?.name ?? pkg.package.publisher?.username ?? 'unknown',
          downloads: pkg.downloads?.weekly ?? 0,
          tags: pkg.package.keywords ?? [],
          source: 'npm',
          installCommand: `npm install ${pkg.package.name}`,
        });
      }
    }
  } catch { /* npm search failed — continue */ }

  try {
    // GitHub search for stellavault-pack repos
    const ghUrl = `https://api.github.com/search/repositories?q=stellavault-pack+${encodeURIComponent(query)}&per_page=${limit}`;
    const res = await fetch(ghUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'stellavault-marketplace' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      for (const repo of data.items ?? []) {
        // npm과 중복 방지
        if (results.some(r => r.name === repo.name)) continue;
        results.push({
          name: repo.full_name,
          version: 'latest',
          description: repo.description ?? '',
          author: repo.owner?.login ?? 'unknown',
          downloads: repo.stargazers_count,
          tags: repo.topics ?? [],
          source: 'github',
          installCommand: `sv pack import <(curl -sL ${repo.html_url}/releases/latest/download/pack.sv-pack)`,
        });
      }
    }
  } catch { /* GitHub search failed — continue */ }

  return results;
}

// sv-pack 파일을 npm에 publish할 수 있도록 패키지 생성
export function createPackageJson(packName: string, description: string, author: string, version = '1.0.0'): string {
  return JSON.stringify({
    name: `stellavault-pack-${packName}`,
    version,
    description,
    author,
    license: 'CC-BY-4.0',
    keywords: ['stellavault', 'knowledge-pack', packName],
    files: ['*.sv-pack', 'README.md'],
    stellavault: { type: 'knowledge-pack' },
  }, null, 2);
}

// GitHub Release로 pack 배포용 명령어 생성
export function getPublishInstructions(packName: string): string {
  return `
To publish your Knowledge Pack:

Option A: npm
  1. cd your-pack-directory/
  2. npm init (or use: sv pack prepare ${packName})
  3. npm publish

Option B: GitHub Release
  1. Create a GitHub repo: stellavault-pack-${packName}
  2. Add your .sv-pack file
  3. Create a release with the .sv-pack as an asset

Users install with:
  npm: sv pack install stellavault-pack-${packName}
  GitHub: sv pack import <url-to-sv-pack-file>
`.trim();
}
