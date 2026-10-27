import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useCallback,
  type ReactNode,
  type RefObject,
} from "react";

type ViewValue = string | number | boolean;
const views = new Map<string, Record<string, ViewValue>>();
const Scope = createContext<string | null>(null);

/** 只保存轻量查看偏好；renderer 内存不广播，窗口、远程身份与会话互不覆盖。 */
export function DocumentViewStateProvider({
  stateKey,
  children,
}: {
  stateKey: string;
  children: ReactNode;
}) {
  return (
    <Scope.Provider key={stateKey} value={stateKey}>
      {children}
    </Scope.Provider>
  );
}

export function readDocumentViewState(key: string, field: string): ViewValue | undefined {
  return views.get(key)?.[field];
}

function write(key: string | null, field: string, value: ViewValue) {
  if (!key) return;
  const state = views.get(key) ?? {};
  state[field] = value;
  views.delete(key);
  views.set(key, state);
  // 不能让已关闭文档的查看偏好无限增长；不持有正文、二进制或渲染节点。
  while (views.size > 128) views.delete(views.keys().next().value!);
}

export function useDocumentViewScope() {
  return useContext(Scope);
}

export function useDocumentViewState<T extends ViewValue>(field: string, fallback: T) {
  const key = useContext(Scope);
  const [value, setValue] = useState<T>(
    () => (key ? (readDocumentViewState(key, field) as T | undefined) : undefined) ?? fallback,
  );
  const update = useCallback(
    (next: T | ((previous: T) => T)) =>
      setValue((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next;
        write(key, field, resolved);
        return resolved;
      }),
    [key, field],
  );
  return [value, update] as const;
}

export function useDocumentScroll(ref: RefObject<HTMLElement | null>, field: string) {
  const key = useContext(Scope);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !key) return;
    let restoring = true;
    let layoutCommitted = false;
    const top = Number(readDocumentViewState(key, `${field}:top`) ?? 0);
    const left = Number(readDocumentViewState(key, `${field}:left`) ?? 0);
    const observer = new MutationObserver(() => {
      observeSize();
      restore();
    });
    const resize = new ResizeObserver(() => restore());
    const observeSize = () => {
      resize.observe(element);
      if (element.firstElementChild) resize.observe(element.firstElementChild);
    };
    const restore = () => {
      if (!restoring || element.clientHeight === 0) return;
      element.scrollTop = top;
      element.scrollLeft = left;
      if (
        layoutCommitted &&
        Math.abs(element.scrollTop - top) < 1 &&
        Math.abs(element.scrollLeft - left) < 1
      ) {
        restoring = false;
        observer.disconnect();
        resize.disconnect();
      }
    };
    const save = () => {
      if (restoring || element.clientHeight === 0) return;
      write(key, `${field}:top`, element.scrollTop);
      write(key, `${field}:left`, element.scrollLeft);
    };
    const userIntent = () => {
      restoring = false;
      observer.disconnect();
      resize.disconnect();
    };
    // 内容与适配缩放均异步就绪，观察真实滚动区域；用户主动滚动后不再抢回旧位置。
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    observeSize();
    restore();
    // 第三方 viewer 在 passive effect 中按工作表初始化滚动；首帧布局完成后才结束恢复。
    const frame = requestAnimationFrame(() => {
      layoutCommitted = true;
      restore();
    });
    element.addEventListener("scroll", save);
    element.addEventListener("wheel", userIntent, { passive: true });
    element.addEventListener("pointerdown", userIntent);
    element.addEventListener("keydown", userIntent);
    return () => {
      save();
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      element.removeEventListener("scroll", save);
      element.removeEventListener("wheel", userIntent);
      element.removeEventListener("pointerdown", userIntent);
      element.removeEventListener("keydown", userIntent);
    };
  }, [field, key, ref]);
}
