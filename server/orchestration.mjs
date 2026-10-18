import { Effect } from 'effect';
import { attempt, runRouting } from './effects.mjs';
import { decideEffect } from './router.mjs';
import { describeWorkspace } from './workspaces.mjs';

export function routeTask(options) {
  const workflow = Effect.gen(function* () {
    const workspaces = yield* Effect.forEach(
      options.registered,
      (workspace) =>
        attempt('workspace-context', () => describeWorkspace(workspace)),
      { concurrency: 4 },
    );
    const models = yield* attempt('codex-catalog', () =>
      options.codex.models(),
    );
    const decision = yield* decideEffect({ ...options, workspaces, models });
    return { workspaces, decision };
  });
  return runRouting(workflow, options.signal);
}
