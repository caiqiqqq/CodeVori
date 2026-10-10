/** Serializes cold activation and destructive maintenance, never a long Agent turn. */
export class SessionLifecycleGate {
  private readonly tails = new Map<string, Promise<unknown>>();
  async run<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.tails.set(id, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(id) === next) this.tails.delete(id);
    }
  }
}
