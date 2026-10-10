import { realpath, stat, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export async function describeWorkspace(input) {
  if (typeof input.path !== 'string' || !path.isAbsolute(input.path))
    throw new Error(
      'Enter an absolute workspace path on the companion computer.',
    );
  const root = await realpath(input.path);
  if (!(await stat(root)).isDirectory())
    throw new Error('Workspace must be a directory.');
  const entries = await readdir(root);
  const documents = [];
  for (const pattern of [/^agents\.md$/i, /^readme(?:\.md|\.txt)?$/i]) {
    const name = entries.find((entry) => pattern.test(entry));
    if (!name) continue;
    const resolved = await realpath(path.join(root, name));
    if (path.dirname(resolved) !== root)
      throw new Error(`${name} links outside the workspace.`);
    const file = await open(resolved, 'r');
    try {
      if (!(await file.stat()).isFile()) continue;
      const buffer = Buffer.alloc(12000);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      documents.push({
        name,
        text: buffer.subarray(0, bytesRead).toString('utf8'),
      });
    } finally {
      await file.close();
    }
  }
  return {
    id: input.id || randomUUID(),
    name: String(input.name || path.basename(root)).slice(0, 100),
    path: root,
    documents,
    indexedAt: new Date().toISOString(),
  };
}
