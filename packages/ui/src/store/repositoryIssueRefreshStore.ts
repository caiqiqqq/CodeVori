import { createStore } from "zustand/vanilla";

/** 只发布失效信号；议题和关联任务仍由 Host 持有。 */
export const repositoryIssueRefreshStore = createStore<{
  revision: number;
  invalidate(): void;
}>((set) => ({
  revision: 0,
  invalidate: () => set((state) => ({ revision: state.revision + 1 })),
}));
