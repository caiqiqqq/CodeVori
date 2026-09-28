import { Eye, EyeOff, RefreshCw, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import type { AcpCodexConfig, AcpCodexModel } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function AcpCodexConfigEditor({ service }: { service: IAcpService }) {
  const { intl } = useZCodeIntl();
  const label = (key: string) => intl.formatMessage({ id: `settings.acpAgents.codex.${key}` });
  const [baseline, setBaseline] = useState<AcpCodexConfig | null>(null);
  const [draft, setDraft] = useState<AcpCodexConfig | null>(null);
  const [models, setModels] = useState<AcpCodexModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelLoading, setModelLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    let alive = true;
    void service.readCodexConfig().then(
      (next) => {
        if (!alive) return;
        setBaseline(next);
        setDraft(next);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setError(label("readFailed"));
        setLoading(false);
      },
    );
    void service.listCodexModels().then(
      (next) => {
        if (!alive) return;
        setModels(next);
        setModelError(null);
        setModelLoading(false);
      },
      () => {
        if (!alive) return;
        setModelError(label("modelsFailed"));
        setModelLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [service]);

  const change = (patch: Partial<AcpCodexConfig>) => {
    revision.current++;
    setError(null);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const reload = () => {
    setLoading(true);
    setError(null);
    const at = ++revision.current;
    void service.readCodexConfig().then(
      (next) => {
        if (revision.current !== at) return;
        setBaseline(next);
        setDraft(next);
        setLoading(false);
      },
      () => {
        if (revision.current === at) {
          setLoading(false);
          setError(label("readFailed"));
        }
      },
    );
  };
  const refreshModels = () => {
    setModelLoading(true);
    setModelError(null);
    void service.listCodexModels().then(
      (next) => {
        setModels(next);
        setModelLoading(false);
      },
      () => {
        setModelError(label("modelsFailed"));
        setModelLoading(false);
      },
    );
  };
  const save = async () => {
    if (!draft || saving) return;
    const at = revision.current;
    setSaving(true);
    setError(null);
    try {
      const next = await service.updateCodexConfig({
        expectedVersion: draft.version,
        authMode: draft.authMode,
        apiUrl: draft.apiUrl,
        apiKey: draft.apiKey,
        model: draft.model,
      });
      // 修复原因：异步保存期间的用户输入不能被旧回执覆盖，需保留新的草稿。
      setBaseline(next);
      setDraft((current) =>
        revision.current === at ? next : current ? { ...current, version: next.version } : current,
      );
    } catch {
      // 错误可能来自原生文件与凭据，页面只展示不含敏感值的统一提示。
      setError(label("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="space-y-3 border-t border-border pt-4"
      data-testid="acp-codex-native-config"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-ui-base font-medium">{label("title")}</h4>
        <Button size="sm" variant="outline" disabled={loading || saving} onClick={reload}>
          {label("reload")}
        </Button>
      </div>
      {loading ? <p className="text-ui-sm text-foreground-subtle">{label("loading")}</p> : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      {draft ? (
        <>
          <div className="space-y-1.5">
            <label htmlFor="acp-codex-auth-mode" className="text-ui-sm text-foreground-subtle">
              {label("authMode")}
            </label>
            <Select
              value={draft.authMode}
              onValueChange={(value) => change({ authMode: value as AcpCodexConfig["authMode"] })}
            >
              <SelectTrigger id="acp-codex-auth-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="subscription">{label("subscription")}</SelectItem>
                <SelectItem value="custom">{label("custom")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.authMode === "subscription" ? (
            <p className="break-words text-ui-sm text-foreground-subtle">
              {draft.hasSubscriptionCredentials ? label("signedIn") : label("loginHint")}
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="acp-codex-api-url" className="text-ui-sm text-foreground-subtle">
                  API URL
                </label>
                <Input
                  id="acp-codex-api-url"
                  type="url"
                  value={draft.apiUrl}
                  onChange={(event) => change({ apiUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="acp-codex-api-key" className="text-ui-sm text-foreground-subtle">
                  API Key
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="acp-codex-api-key"
                    type={showKey ? "text" : "password"}
                    value={draft.apiKey}
                    onChange={(event) => change({ apiKey: event.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={label(showKey ? "hide" : "show")}
                    onClick={() => setShowKey((value) => !value)}
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="acp-codex-default-model"
                className="text-ui-sm text-foreground-subtle"
              >
                {label("models")}
              </label>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={label("refreshModels")}
                onClick={refreshModels}
                disabled={modelLoading}
              >
                <RefreshCw className={`size-4 ${modelLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            {modelLoading ? (
              <p className="text-ui-sm text-foreground-subtle">{label("loadingModels")}</p>
            ) : null}
            {modelError ? (
              <p role="alert" className="text-ui-sm text-destructive">
                {modelError}
              </p>
            ) : null}
            <Input
              id="acp-codex-default-model"
              value={draft.model}
              onChange={(event) => change({ model: event.target.value })}
              placeholder={label("nativeModel")}
              spellCheck={false}
            />
            {models.length ? (
              <div
                className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5"
                aria-label={label("models")}
              >
                {models.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    aria-pressed={draft.model === item.slug}
                    onClick={() => change({ model: item.slug })}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <Star
                      className={`size-4 shrink-0 ${draft.model === item.slug ? "fill-warning text-warning" : "text-foreground-subtlest"}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="max-w-[45%] truncate font-mono text-ui-xs text-foreground-subtle">
                      {item.slug}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-ui-sm text-foreground-subtle">{label("modelsHint")}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              saving ||
              !baseline ||
              JSON.stringify(draft) === JSON.stringify(baseline) ||
              (draft.authMode === "custom" && !draft.apiUrl.trim())
            }
            onClick={() => void save()}
          >
            {label("save")}
          </Button>
          <p className="text-ui-sm text-foreground-subtle">{label("restartHint")}</p>
        </>
      ) : null}
    </section>
  );
}
