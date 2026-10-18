import { Cause, Data, Effect, Exit } from 'effect';

export class RoutingError extends Data.TaggedError('RoutingError') {}

export const attempt = (stage, operation) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new RoutingError({
        stage,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

// Expose plain Error objects at the HTTP/session boundary while keeping tagged
// failures and interruption inside the Effect pipeline.
export async function runRouting(effect, signal) {
  const exit = await Effect.runPromiseExit(effect, { signal });
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}
