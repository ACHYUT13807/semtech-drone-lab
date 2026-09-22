// ============================================================
// GitHub API Integration — Live Repository Data
// Fetches real repository structure, stats, and contents
// ============================================================

export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  language: string;
  license: { name: string } | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
  topics: string[];
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
  download_url?: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  assets: { name: string; download_count: number; browser_download_url: string }[];
}

export interface GitHubContributor {
  login: string;
  avatar_url: string;
  contributions: number;
  html_url: string;
}

const API_BASE = 'https://api.github.com';

// Rate limiting helper
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // ms

async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLast));
  }
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// ── Repository Info ──────────────────────────────────────────
export async function fetchRepo(owner: string, repo: string): Promise<GitHubRepo> {
  const response = await rateLimitedFetch(`${API_BASE}/repos/${owner}/${repo}`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch repo: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// ── Repository Tree (full file structure) ────────────────────
export async function fetchRepoTree(owner: string, repo: string, branch: string = 'main'): Promise<GitHubTree> {
  const response = await rateLimitedFetch(
    `${API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch tree: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// ── File Content ─────────────────────────────────────────────
export async function fetchFileContent(owner: string, repo: string, path: string): Promise<string> {
  const response = await rateLimitedFetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }
  
  const data: GitHubContent = await response.json();
  
  if (data.content && data.encoding === 'base64') {
    return atob(data.content.replace(/\n/g, ''));
  }
  
  throw new Error('Unable to decode file content');
}

// ── Releases ─────────────────────────────────────────────────
export async function fetchReleases(owner: string, repo: string, limit: number = 5): Promise<GitHubRelease[]> {
  const response = await rateLimitedFetch(
    `${API_BASE}/repos/${owner}/${repo}/releases?per_page=${limit}`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// ── Contributors ─────────────────────────────────────────────
export async function fetchContributors(owner: string, repo: string, limit: number = 10): Promise<GitHubContributor[]> {
  const response = await rateLimitedFetch(
    `${API_BASE}/repos/${owner}/${repo}/contributors?per_page=${limit}`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch contributors: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// ── Languages ────────────────────────────────────────────────
export async function fetchLanguages(owner: string, repo: string): Promise<Record<string, number>> {
  const response = await rateLimitedFetch(
    `${API_BASE}/repos/${owner}/${repo}/languages`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch languages: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// ── README ───────────────────────────────────────────────────
export async function fetchReadme(owner: string, repo: string): Promise<string> {
  const response = await rateLimitedFetch(
    `${API_BASE}/repos/${owner}/${repo}/readme`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3.html',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch README: ${response.status} ${response.statusText}`);
  }
  
  return response.text();
}

// ── Convert tree to nested structure ─────────────────────────
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  children?: FileTreeNode[];
  sha?: string;
}

export function treeToNested(items: GitHubTreeItem[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const map = new Map<string, FileTreeNode>();
  
  // Sort to ensure parents are processed before children
  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));
  
  for (const item of sorted) {
    const parts = item.path.split('/');
    const name = parts[parts.length - 1];
    
    const node: FileTreeNode = {
      name,
      path: item.path,
      type: item.type === 'tree' ? 'folder' : 'file',
      size: item.size,
      sha: item.sha,
      children: item.type === 'tree' ? [] : undefined,
    };
    
    map.set(item.path, node);
    
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = map.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }
  }
  
  return root;
}

// ── Detect language from file extension ──────────────────────
export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const languages: Record<string, string> = {
    'py': 'Python',
    'js': 'JavaScript',
    'ts': 'TypeScript',
    'tsx': 'TypeScript',
    'jsx': 'JavaScript',
    'rs': 'Rust',
    'go': 'Go',
    'cpp': 'C++',
    'c': 'C',
    'h': 'C/C++ Header',
    'hpp': 'C++ Header',
    'java': 'Java',
    'kt': 'Kotlin',
    'swift': 'Swift',
    'rb': 'Ruby',
    'php': 'PHP',
    'cs': 'C#',
    'yaml': 'YAML',
    'yml': 'YAML',
    'json': 'JSON',
    'xml': 'XML',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'less': 'Less',
    'md': 'Markdown',
    'rst': 'reStructuredText',
    'txt': 'Text',
    'sh': 'Shell',
    'bash': 'Bash',
    'zsh': 'Zsh',
    'ps1': 'PowerShell',
    'dockerfile': 'Dockerfile',
    'sql': 'SQL',
    'graphql': 'GraphQL',
    'proto': 'Protocol Buffers',
    'toml': 'TOML',
    'ini': 'INI',
    'cfg': 'Config',
    'env': 'Env',
    'gitignore': 'Git',
    'dockerignore': 'Docker',
  };
  
  if (filename.toLowerCase() === 'dockerfile') return 'Dockerfile';
  if (filename.toLowerCase() === 'makefile') return 'Makefile';
  
  return languages[ext || ''] || 'Unknown';
}
