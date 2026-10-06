import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function textContent(value) {
  return {
    type: "text",
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  };
}

export function toolResult(value, extra = {}) {
  return {
    content: [textContent(value)],
    ...extra,
  };
}

export function toolError(error, details) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [textContent(message)],
    ...(details ? { structuredContent: details } : {}),
  };
}

export async function imageResult({ path, format = "png", imageRef, text = null }) {
  const bytes = await readFile(path);
  const normalized = format === "jpg" ? "jpeg" : format;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (imageRef.sha256 && imageRef.sha256 !== `sha256:${sha256}`) {
    throw new Error("Image integrity check failed");
  }
  return {
    content: [
      {
        type: "image",
        data: bytes.toString("base64"),
        mimeType: `image/${normalized}`,
      },
      textContent({ image_ref: imageRef }),
      ...(text ? [textContent(text)] : []),
    ],
    _meta: {
      "open.zcode.cua/frame-integrity-v1": {
        frame_id: imageRef.frame_id,
        width: imageRef.width,
        height: imageRef.height,
        media_type: `image/${normalized}`,
        sha256,
      },
    },
  };
}

export function actionReceipt({
  actionSent,
  dispatchStatus,
  path = "none",
  effect = "unverifiable",
  retryAction = false,
}) {
  return {
    schema_version: "open-zcode-cua-action-receipt-v1",
    action_sent: actionSent,
    dispatch_status: dispatchStatus,
    path,
    effect,
    retry_action: retryAction,
  };
}
