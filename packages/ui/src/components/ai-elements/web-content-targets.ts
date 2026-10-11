import { defaultRehypePlugins } from "streamdown";
import type { PluggableList } from "unified";

interface WebContentNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: WebContentNode[];
}

interface WebContentTargetOptions {
  contextEpoch: number;
  resolveUrl: (source: string) => string | null;
}

function rewriteWebContentTargets({ resolveUrl }: WebContentTargetOptions) {
  return (tree: WebContentNode) => {
    const visit = (node: WebContentNode) => {
      const property = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : null;
      if (node.type === "element" && property && typeof node.properties?.[property] === "string") {
        const resolved = resolveUrl(node.properties[property]);
        if (resolved) node.properties[property] = resolved;
        else delete node.properties[property];
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export function createWebContentRehypePlugins(
  context: Pick<WebContentTargetOptions, "resolveUrl">,
  contextEpoch: number,
): PluggableList {
  // Streamdown 按插件名和序列化参数缓存解析器，匿名闭包会串用旧仓库的 resolver。
  // 复用 Markdown 的上下文 epoch 区分 Host/账号/议题；回调仍只属于当前上下文。
  const options: WebContentTargetOptions = { contextEpoch, resolveUrl: context.resolveUrl };
  return [
    // HTML img/a 要先展开再解析地址，最后仍由原有 sanitize/harden 移除不安全内容。
    defaultRehypePlugins.raw!,
    [rewriteWebContentTargets, options],
    defaultRehypePlugins.sanitize!,
    defaultRehypePlugins.harden!,
  ];
}
