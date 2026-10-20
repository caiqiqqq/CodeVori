import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IGitService } from "@zcode/services";
import {
  FORGE_IMAGE_UPLOAD_MAX_BYTES,
  createUuid,
  type ForgeImageUploadCapability,
  type ForgeTargetRequest,
} from "@zcode/shared";
import { forgeErrorId } from "@/lib/forgePanel.js";

export interface ForgeDraftImage {
  id: string;
  file: File;
  preview: string;
  state: "uploading" | "failed" | "uploaded";
  error?: string;
  url?: string;
}
export function forgeImageMarkdown(filename: string, url: string) {
  return `![${filename.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ")}](${url})`;
}

export function useForgeImageUploads(
  gitService: IGitService,
  target: ForgeTargetRequest,
  onUploaded: (file: File, url: string) => void,
) {
  const [images, setImages] = useState<ForgeDraftImage[]>([]);
  const [capability, setCapability] = useState<ForgeImageUploadCapability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const entries = useRef<ForgeDraftImage[]>([]);
  const generation = useRef(0);
  const chain = useRef(Promise.resolve());
  const callback = useRef(onUploaded);
  callback.current = onUploaded;
  const publish = (next: ForgeDraftImage[]) => {
    entries.current = next;
    setImages(next);
  };
  useLayoutEffect(() => {
    generation.current += 1;
    publish([]);
    setCapability(null);
    setError(null);
    chain.current = Promise.resolve();
    return () => {
      generation.current += 1;
      for (const entry of entries.current) URL.revokeObjectURL(entry.preview);
      entries.current = [];
    };
  }, [gitService, target]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => gitService.getForgeImageUploadCapability(target))
      .then(
        (value) => {
          if (alive) {
            setCapability(value);
            setError(null);
          }
        },
        (reason) => {
          if (alive) setError(forgeErrorId(reason));
        },
      );
    return () => {
      alive = false;
    };
  }, [gitService, target, revision]);

  const enqueue = (entry: ForgeDraftImage) => {
    const current = generation.current;
    const requestId = createUuid();
    const exists = () =>
      current === generation.current && entries.current.some((image) => image.id === entry.id);
    // 原生上传按当前草稿串行，避免同时弹出多个登录窗口；这是未提交草稿，不是 Agent accepted queue。
    chain.current = chain.current
      .catch(() => {})
      .then(async () => {
        if (!exists()) return;
        try {
          const dataBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("FORGE_INVALID_MEDIA"));
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.readAsDataURL(entry.file);
          });
          if (!exists()) return;
          const result = await gitService.uploadForgeImage({
            ...target,
            requestId,
            filename: entry.file.name,
            mediaType: entry.file.type as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            totalBytes: entry.file.size,
            dataBase64,
          });
          if (!exists()) return;
          publish(
            entries.current.map((image) =>
              image.id === entry.id
                ? { ...image, state: "uploaded", url: result.url, error: undefined }
                : image,
            ),
          );
          callback.current(entry.file, result.url);
        } catch (reason) {
          if (exists())
            publish(
              entries.current.map((image) =>
                image.id === entry.id
                  ? { ...image, state: "failed", error: forgeErrorId(reason) }
                  : image,
              ),
            );
        }
      });
  };
  const add = (files: File[]) => {
    if (!capability?.supported) return;
    if (entries.current.length + files.length > 8) {
      setError("UPLOAD_LIMIT");
      return;
    }
    if (
      files.some(
        (file) =>
          !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) ||
          file.size === 0 ||
          file.size > FORGE_IMAGE_UPLOAD_MAX_BYTES,
      )
    ) {
      setError("UPLOAD_INVALID_FILE");
      return;
    }
    setError(null);
    const next = files.map((file) => ({
      id: createUuid(),
      file,
      preview: URL.createObjectURL(file),
      state: "uploading" as const,
    }));
    publish([...entries.current, ...next]);
    next.forEach(enqueue);
  };
  return {
    images,
    capability,
    error,
    add,
    blocked: images.some((image) => image.state !== "uploaded"),
    retryCapability: () => {
      setError(null);
      setRevision((value) => value + 1);
    },
    retry: (id: string) => {
      const image = entries.current.find((entry) => entry.id === id && entry.state === "failed");
      if (!image) return;
      const next = { ...image, state: "uploading" as const, error: undefined };
      publish(entries.current.map((entry) => (entry.id === id ? next : entry)));
      enqueue(next);
    },
    remove: (id: string) => {
      const image = entries.current.find((entry) => entry.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      publish(entries.current.filter((entry) => entry.id !== id));
      return image;
    },
  };
}
