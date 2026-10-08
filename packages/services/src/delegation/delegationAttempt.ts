import type { DelegationTask, DelegationResult } from "@zcode/shared";
import type { WorkTaskExecutionContext } from "../session/contract.js";
import type { DelegationRepository } from "./delegationRepository.js";

export async function executeDelegationAttempt(
  task: DelegationTask,
  abort: AbortController,
  repo: DelegationRepository,
  owner: string,
  execute: (task: DelegationTask, context: WorkTaskExecutionContext) => Promise<DelegationResult>,
  disposed: () => boolean,
  changed: () => void,
) {
  const sequence = task.attempts.at(-1)!.sequence;
  const update: WorkTaskExecutionContext["update"] = async (patch) =>
    repo.transaction(() => {
      const current = repo.get(task.id)!;
      if (
        abort.signal.aborted ||
        current.owner !== owner ||
        (current.leaseUntil ?? 0) <= Date.now() ||
        current.attempts.at(-1)?.sequence !== sequence
      )
        return false;
      if (patch.session) current.session = patch.session;
      if (patch.worktree) current.worktree = patch.worktree;
      if (patch.status) {
        current.status = patch.status;
        current.attempts.at(-1)!.status = patch.status;
      }
      current.updatedAt = Date.now();
      repo.put(current);
      changed();
      return true;
    });
  let result: DelegationResult | undefined;
  let error: string | undefined;
  try {
    result = await execute(task, { signal: abort.signal, update });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  if (disposed()) return;
  repo.transaction(() => {
    const current = repo.get(task.id)!;
    if (
      current.owner !== owner ||
      (current.leaseUntil ?? 0) <= Date.now() ||
      current.attempts.at(-1)?.sequence !== sequence ||
      abort.signal.aborted
    )
      return;
    const attempt = current.attempts.at(-1)!;
    current.status = error ? "failed" : "completed";
    current.updatedAt = Date.now();
    attempt.status = current.status;
    attempt.endedAt = current.updatedAt;
    attempt.error = error;
    attempt.result ??= result;
    attempt.delivery = repo.parent(current.rootParent).suspended ? "suppressed" : "pending";
    delete current.owner;
    delete current.leaseUntil;
    repo.put(current);
  });
  changed();
}
