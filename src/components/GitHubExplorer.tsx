import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, FileCode, ChevronRight, ChevronDown, GitFork, Star, Eye, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { GitHubIcon } from './icons';
import AnimatedSection from './AnimatedSection';
import {
  fetchRepo, fetchRepoTree, fetchFileContent, treeToNested, detectLanguage,
  type FileTreeNode, type GitHubRepo,
} from '../engine/github-api';

// TODO: update once the architecture-only docs repo is created and pushed.
// This intentionally does NOT point at the real pipeline code repo (kept
// private) or the models repo (also private) — only a docs/structure repo,
// per the plan: no code, no .onnx weights, just how the pipeline works.
const REPO_OWNER = 'ACHYUT13807';
const REPO_NAME = 'semantic-drone-architecture';

export default function GitHubExplorer() {
  const [tree, setTree] = useState<FileTreeNode[] | null>(null);
  const [repoInfo, setRepoInfo] = useState<GitHubRepo | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found'>('loading');

  const [selectedFile, setSelectedFile] = useState<FileTreeNode | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [repo, treeData] = await Promise.all([
        fetchRepo(REPO_OWNER, REPO_NAME),
        fetchRepoTree(REPO_OWNER, REPO_NAME, 'main'),
      ]);
      setRepoInfo(repo);
      const nested = treeToNested(treeData.tree);
      setTree(nested);
      setExpandedFolders(new Set(nested.filter(n => n.type === 'folder').map(n => n.path)));
      setStatus('ready');
    } catch (err) {
      console.error('GitHub fetch failed:', err);
      setStatus('not-found');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectFile = async (file: FileTreeNode) => {
    setSelectedFile(file);
    setFileContent(null);
    setLoadingFile(true);
    try {
      const content = await fetchFileContent(REPO_OWNER, REPO_NAME, file.path);
      setFileContent(content);
    } catch (err) {
      console.error('Failed to fetch file content:', err);
      setFileContent(null);
    } finally {
      setLoadingFile(false);
    }
  };

  return (
    <section id="github-explorer" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              GitHub Explorer
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Browse the </span>
              <span className="gradient-text">architecture</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              A structure-only reference for the pipeline — how the modules fit together, not the
              implementation itself. The runnable code and trained weights stay private.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            {/* Repo header */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <GitHubIcon className="w-5 h-5 text-gray-400" />
                <span className="text-sm font-semibold text-white">{REPO_OWNER} / {REPO_NAME}</span>
                {status === 'ready' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 text-gray-500">public</span>
                )}
                <a
                  href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </a>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                {repoInfo && (
                  <>
                    <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {repoInfo.stargazers_count}</span>
                    <span className="flex items-center gap-1"><GitFork className="w-3.5 h-3.5" /> {repoInfo.forks_count}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {repoInfo.watchers_count}</span>
                  </>
                )}
                <button
                  onClick={refresh}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {status === 'loading' && (
              <div className="flex items-center justify-center gap-2 py-20 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading repository…
              </div>
            )}

            {status === 'not-found' && (
              <div className="flex flex-col items-center justify-center gap-2 py-20 px-6 text-center">
                <GitHubIcon className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-sm text-gray-400">
                  <span className="font-mono text-gray-300">{REPO_OWNER}/{REPO_NAME}</span> isn't published yet.
                </p>
                <p className="text-xs text-gray-600 max-w-sm">
                  This section renders live from GitHub's API once the architecture-reference repo is pushed —
                  nothing fabricated in the meantime.
                </p>
              </div>
            )}

            {status === 'ready' && tree && (
              <div className="grid grid-cols-1 lg:grid-cols-5">
                {/* File tree */}
                <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-white/5 p-3 max-h-[420px] overflow-y-auto">
                  {tree.map(node => (
                    <TreeNode
                      key={node.path}
                      entry={node}
                      depth={0}
                      expanded={expandedFolders}
                      onToggle={toggleFolder}
                      onSelect={selectFile}
                      selected={selectedFile}
                    />
                  ))}
                </div>

                {/* Detail pane */}
                <div className="lg:col-span-3 p-4 sm:p-6 min-h-[300px]">
                  <AnimatePresence mode="wait">
                    {selectedFile ? (
                      <motion.div
                        key={selectedFile.path}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="flex items-center gap-2 mb-4 flex-wrap">
                          <FileCode className="w-4 h-4 text-cyan-400" />
                          <span className="text-sm font-semibold text-white">{selectedFile.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                            {detectLanguage(selectedFile.name)}
                          </span>
                          {selectedFile.size != null && (
                            <span className="text-[10px] text-gray-600">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                          )}
                        </div>

                        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Content</h4>
                          {loadingFile ? (
                            <div className="flex items-center gap-2 text-gray-600 text-xs py-4">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                            </div>
                          ) : fileContent ? (
                            <pre className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                              {fileContent.slice(0, 2000)}{fileContent.length > 2000 ? '\n…' : ''}
                            </pre>
                          ) : (
                            <p className="text-xs text-gray-600">Couldn't load this file's content.</p>
                          )}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center justify-center h-full text-gray-600 text-sm"
                      >
                        ← Click a file to view its contents
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}

function TreeNode({
  entry, depth, expanded, onToggle, onSelect, selected,
}: {
  entry: FileTreeNode; depth: number; expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (file: FileTreeNode) => void;
  selected: FileTreeNode | null;
}) {
  const isFolder = entry.type === 'folder';
  const isExpanded = expanded.has(entry.path);
  const isSelected = selected?.path === entry.path;

  return (
    <div>
      <button
        onClick={() => isFolder ? onToggle(entry.path) : onSelect(entry)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-all hover:bg-white/[0.04] ${
          isSelected ? 'bg-cyan-500/10 text-cyan-300' : 'text-gray-400'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isFolder ? (
          isExpanded ? <ChevronDown className="w-3 h-3 text-gray-600 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />
        ) : (
          <div className="w-3" />
        )}
        {isFolder ? (
          <Folder className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        ) : (
          <FileCode className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isFolder && isExpanded && entry.children && (
        <div>
          {entry.children.map(child => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selected={selected}
            />
          ))}
        </div>
      )}
    </div>
  );
}
