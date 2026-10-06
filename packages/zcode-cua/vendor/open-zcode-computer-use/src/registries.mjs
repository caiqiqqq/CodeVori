export class RegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

class BoundedRegistry {
  constructor({ prefix, maxEntries, ttlMs, now = Date.now }) {
    this.prefix = prefix;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    this.counter = 0;
    this.entries = new Map();
    this.tombstones = new Map();
  }

  issue(value) {
    const id = `${this.prefix}-${++this.counter}`;
    const entry = {
      ...value,
      id,
      createdAt: this.now(),
      status: "live",
    };
    this.entries.set(id, entry);
    this.evict();
    return entry;
  }

  get(id) {
    const tombstone = this.tombstones.get(id);
    if (tombstone) {
      throw new RegistryError(tombstone, `${id} is ${tombstone}; observe again`);
    }
    const entry = this.entries.get(id);
    if (!entry) {
      throw new RegistryError("unknown", `${id} is unknown to this session`);
    }
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(id);
      this.remember(id, "expired");
      throw new RegistryError("expired", `${id} expired; observe again`);
    }
    if (entry.status !== "live") {
      throw new RegistryError(entry.status, `${id} is ${entry.status}; observe again`);
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  peek(id) {
    try {
      return this.get(id);
    } catch {
      return null;
    }
  }

  consume(id, status = "spent") {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.remember(id, status);
  }

  supersedeWhere(predicate) {
    for (const [id, entry] of this.entries) {
      if (!predicate(entry)) continue;
      this.entries.delete(id);
      this.remember(id, "superseded");
    }
  }

  clear(status = "stopped") {
    for (const id of this.entries.keys()) {
      this.remember(id, status);
    }
    this.entries.clear();
  }

  remember(id, reason) {
    this.tombstones.delete(id);
    this.tombstones.set(id, reason);
    while (this.tombstones.size > this.maxEntries * 4) {
      this.tombstones.delete(this.tombstones.keys().next().value);
    }
  }

  evict() {
    while (this.entries.size > this.maxEntries) {
      const id = this.entries.keys().next().value;
      this.entries.delete(id);
      this.remember(id, "evicted");
    }
  }
}

export class StateRegistry extends BoundedRegistry {
  constructor(options = {}) {
    super({
      prefix: "s",
      maxEntries: options.maxEntries ?? 8,
      ttlMs: options.ttlMs ?? 10 * 60_000,
      now: options.now,
    });
  }

  issueState(value) {
    this.supersedeWhere(
      (entry) =>
        entry.target.pid === value.target.pid &&
        entry.target.windowId === value.target.windowId,
    );
    const entry = this.issue(value);
    entry.state_id = entry.id;
    return entry;
  }
}

export class FrameRegistry extends BoundedRegistry {
  constructor(options = {}) {
    super({
      prefix: "f",
      maxEntries: options.maxEntries ?? 16,
      ttlMs: options.ttlMs ?? 10 * 60_000,
      now: options.now,
    });
    this.latestId = null;
  }

  issueFrame(value) {
    const entry = this.issue(value);
    entry.frame_id = entry.id;
    if (entry.actionable !== false) this.latestId = entry.id;
    return entry;
  }

  latest() {
    if (!this.latestId) {
      throw new RegistryError("missing_frame", "No actionable image frame is available");
    }
    return this.get(this.latestId);
  }

  resolve(id) {
    return id ? this.get(id) : this.latest();
  }

  consume(id, status = "spent") {
    super.consume(id, status);
    if (this.latestId === id) this.latestId = null;
  }

  clear(status = "stopped") {
    super.clear(status);
    this.latestId = null;
  }
}

export class ActionQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => {});
    return result;
  }
}
