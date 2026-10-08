/** Serializes short Host admission/queue operations, never the Agent's long prompt. */
export class AcpQueueGate {
  private readonly pending = new Map<string, Promise<unknown>>();

  async settle(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }

  async run<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(id, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(id) === next) this.pending.delete(id);
    }
  }
}
