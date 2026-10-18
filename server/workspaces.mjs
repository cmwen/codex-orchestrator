import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';

const excluded = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'target',
  'out',
  '__pycache__',
  '.git',
  '.hg',
  '.svn',
  '.orchestrator',
  '.aws',
  '.ssh',
  '.codex',
  '.agents',
]);
const sensitive =
  /(?:^\.env(?:\.|$)|credentials|secrets?|private[-_]?key|\.pem$|\.key$|\.p12$|\.keystore$)/i;
const documentation =
  /^(?:agents|readme|architecture|contributing)(?:\.md|\.txt)?$/i;
const manifests = new Set([
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'Gemfile',
  'composer.json',
]);
const maxEntries = 2000,
  maxFiles = 240,
  maxDepth = 4,
  maxContext = 48000;
const inside = (root, target) =>
  target === root || target.startsWith(root + path.sep);
async function rootPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new Error(
      'Enter an absolute workspace path on the companion computer.',
    );
  const root = await realpath(value);
  if (!(await stat(root)).isDirectory())
    throw new Error('Workspace must be a directory.');
  return root;
}
async function readBounded(file, limit) {
  // Do not follow file symlinks, block on FIFOs, or load whole large files.
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated: info.size > bytesRead,
    };
  } finally {
    await handle.close();
  }
}
async function walk(root, depthLimit = maxDepth) {
  const files = [],
    directories = [],
    queue = [{ relative: '', depth: 0, rules: [] }];
  let visited = 0,
    truncated = false;
  while (queue.length && visited < maxEntries && files.length < maxFiles) {
    const current = queue.shift();
    const dir = path.join(root, current.relative);
    let entries;
    try {
      entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      if (current.depth === 0) throw error;
      continue;
    }
    const rules = [...current.rules];
    if (entries.some((e) => e.name === '.gitignore' && e.isFile())) {
      const content = await readBounded(path.join(dir, '.gitignore'), 16000);
      if (content)
        rules.push({
          prefix: current.relative,
          matcher: ignore().add(content.text),
        });
    }
    directories.push({
      relative: current.relative,
      entries: entries.filter((e) => !e.isSymbolicLink()).map((e) => e.name),
    });
    for (const entry of entries) {
      if (++visited > maxEntries || files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const relative = path.posix.join(current.relative, entry.name);
      if (
        excluded.has(entry.name) ||
        sensitive.test(entry.name) ||
        entry.name.startsWith('.')
      )
        continue;
      if (
        rules.some((rule) =>
          rule.matcher.ignores(
            (rule.prefix ? relative.slice(rule.prefix.length + 1) : relative) +
              (entry.isDirectory() ? '/' : ''),
          ),
        )
      )
        continue;
      if (entry.isSymbolicLink()) {
        if (
          documentation.test(entry.name) &&
          !inside(root, await realpath(path.join(root, relative)))
        )
          throw new Error(`${relative} links outside the workspace.`);
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < depthLimit)
          queue.push({ relative, depth: current.depth + 1, rules });
        else truncated = true;
      } else if (entry.isFile()) files.push(relative);
    }
  }
  return {
    files,
    directories,
    truncated: truncated || queue.length > 0,
    visited,
  };
}
export async function describeWorkspace(input) {
  const root = await rootPath(input.path);
  const scan = await walk(root);
  const documents = [];
  let bytes = 0;
  // Prefer root ownership documents, then nested project docs, then package summaries.
  const candidates = scan.files
    .filter(
      (file) =>
        documentation.test(path.basename(file)) ||
        file === 'package.json' ||
        file.endsWith('/package.json'),
    )
    .sort(
      (a, b) =>
        a.split('/').length - b.split('/').length ||
        Number(path.basename(a) === 'package.json') -
          Number(path.basename(b) === 'package.json') ||
        a.localeCompare(b),
    );
  for (const name of candidates) {
    if (bytes >= maxContext) break;
    const resolved = path.join(root, name);
    if (!inside(root, await realpath(resolved)))
      throw new Error(`${name} links outside the workspace.`);
    const content = await readBounded(
      resolved,
      Math.min(12000, maxContext - bytes),
    );
    if (!content) continue;
    let text = content.text;
    if (path.basename(name) === 'package.json') {
      try {
        const data = JSON.parse(text);
        text = JSON.stringify({
          name: data.name,
          description: data.description,
          workspaces: data.workspaces,
          scripts: Object.keys(data.scripts || {}),
          dependencies: Object.keys(data.dependencies || {}),
          devDependencies: Object.keys(data.devDependencies || {}),
        });
      } catch {
        continue;
      }
    }
    bytes += Buffer.byteLength(text);
    documents.push({ name, text, truncated: content.truncated });
  }
  return {
    id: input.id || randomUUID(),
    name: String(input.name || path.basename(root)).slice(0, 100),
    path: root,
    documents,
    files: scan.files,
    repository: {
      kind: scan.directories[0].entries.includes('.git') ? 'git' : 'folder',
      manifests: scan.files.filter((file) =>
        manifests.has(path.basename(file)),
      ),
    },
    context: {
      bytes,
      truncated: scan.truncated || candidates.length > documents.length,
    },
    indexedAt: new Date().toISOString(),
  };
}
export async function discoverWorkspaces(value) {
  const root = await rootPath(value);
  const scan = await walk(root, 3);
  const candidates = scan.directories
    .filter((dir) =>
      dir.entries.some((name) => name === '.git' || manifests.has(name)),
    )
    .slice(0, 40)
    .map((dir) => ({
      name: path.basename(path.join(root, dir.relative)),
      path: path.join(root, dir.relative),
      kind: dir.entries.includes('.git') ? 'git' : 'project',
    }));
  return {
    root,
    candidates,
    truncated: scan.truncated || candidates.length >= 40,
  };
}
