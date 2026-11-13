/** RPC operations share a lease so an awaited call never loses its mutable session owner. */
export function createAcpCacheLease(collect: () => void) {
  let globalOperations = 0;
  const operations = new Map<string, number>();
  return {
    idle: (id: string) => globalOperations === 0 && !operations.has(id),
    wrap<T extends object>(service: T): T {
      return new Proxy(service, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const input = args[0];
            const id =
              input && typeof input === "object" && "id" in input && typeof input.id === "string"
                ? input.id
                : undefined;
            if (id === undefined) globalOperations++;
            else operations.set(id, (operations.get(id) ?? 0) + 1);
            const release = () => {
              if (id === undefined) globalOperations--;
              else {
                const count = operations.get(id)! - 1;
                if (count) operations.set(id, count);
                else operations.delete(id);
              }
              collect();
            };
            // 修复原因：只看 load/write Map 会漏掉已取到 owner 后仍在 await 的 RPC；
            // 租约在调用前同步取得，成功、拒绝与同步异常都在最后一个调用结束后回收。
            let result: unknown;
            try {
              result = Reflect.apply(value, receiver, args);
            } catch (error) {
              release();
              throw error;
            }
            if (result instanceof Promise) return result.finally(release);
            release();
            return result;
          };
        },
      });
    },
  };
}
