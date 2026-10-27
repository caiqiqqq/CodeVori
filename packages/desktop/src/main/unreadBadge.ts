type AppBadgeSetter = (count: number) => void;

export function parseWindowUnreadCount(payload: unknown): number | null {
  if (typeof payload !== "number" || !Number.isInteger(payload) || payload < 0) {
    return null;
  }

  return payload;
}

export function sumWindowUnreadCounts(windowUnreadCountMap: ReadonlyMap<number, number>): number {
  let totalUnreadCount = 0;

  for (const unreadCount of windowUnreadCountMap.values()) {
    totalUnreadCount += unreadCount;
  }

  return totalUnreadCount;
}

export function formatWindowsUnreadDescription(count: number): string {
  const label = count > 9 ? "9+" : String(count);
  return `${label} unread task${count === 1 ? "" : "s"}`;
}

/** Electron bitmap pixels use BGRA order. */
export function createUnreadDotBitmap(base: Buffer, width: number, height: number): Buffer {
  const pixels = Buffer.from(base);
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.15));
  const centerX = width - radius - 1;
  const centerY = height - radius - 1;
  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y++) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
      const offset = (y * width + x) * 4;
      pixels[offset] = 40;
      pixels[offset + 1] = 45;
      pixels[offset + 2] = 225;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function supportsAppUnreadBadge(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "linux";
}

export function syncAppUnreadBadge(options: {
  platform: NodeJS.Platform;
  totalUnreadCount: number;
  setBadgeCount: AppBadgeSetter;
}): void {
  if (!supportsAppUnreadBadge(options.platform)) {
    return;
  }

  options.setBadgeCount(options.totalUnreadCount);
}
