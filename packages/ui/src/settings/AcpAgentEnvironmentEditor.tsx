import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { ACP_AGENT_MODEL_ENV, type AcpAgentInfo } from "@zcode/shared";
import type { IAcpService } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useAcpGeminiProviders } from "@/hooks/useAcpGeminiProviders.js";
import { useAcpAgentModels } from "@/hooks/useAcpAgentModels.js";
import { AcpModelPicker } from "@/settings/AcpModelPicker.js";
import { AcpGeminiProviderControls } from "@/settings/AcpGeminiProviderControls.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ACP_AGENT_ENV_FIELDS,
  acpEnvValue,
  inferAcpGeminiAuthMode,
  patchAcpEnvText,
  acpQoderLoginCommand,
  normalizeAcpAgentEnvText,
  patchAcpAgentFieldText,
  type AcpEnvField,
} from "@/settings/acpAgentEnvironment.js";

/** Connection fields project the complete draft, including saved keys without a visible field. */
export function AcpAgentEnvironmentEditor({
  info,
  service,
  text,
  defaultModel,
  onDefaultModelChange,
  changed,
  busy,
  onChange,
  onSave,
}: {
  info: AcpAgentInfo;
  service: IAcpService | null;
  text: string;
  defaultModel: string;
  onDefaultModelChange: (value: string) => void;
  changed: boolean;
  busy: boolean;
  onChange: (text: string) => void;
  onSave: (text: string) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const label = (key: string) => intl.formatMessage({ id: `settings.acpAgents.env.${key}` });
  const method = info.agent === "antigravity" ? acpEnvValue(text, "AGY_AUTH_METHOD") : "";
  const geminiMethod = info.agent === "gemini" ? inferAcpGeminiAuthMode(text) : "";
  const providers = useAcpGeminiProviders(info.agent === "gemini" ? service : null);
  const models = useAcpAgentModels(service, info.agent);
  const modelKey = ACP_AGENT_MODEL_ENV[info.agent];
  const modelLabel = (key: string) =>
    intl.formatMessage({ id: `settings.acpAgents.models.${key}` });
  const selectedProvider = providers.view?.providers.find(
    (provider) => provider.id === acpEnvValue(text, "ZCODE_GEMINI_PROVIDER_ID"),
  );
  const providerMode = geminiMethod === "model_provider";
  const editorBusy = busy || providers.saving;
  const fields: readonly AcpEnvField[] = ACP_AGENT_ENV_FIELDS[info.agent].filter((field) => {
    if (field.key === modelKey) return false;
    if (info.agent === "gemini") {
      if (field.key === "ZCODE_GEMINI_AUTH_MODE" || field.key === "GEMINI_MODEL") return true;
      if (field.key === "GOOGLE_GEMINI_BASE_URL") return geminiMethod === "custom" || providerMode;
      if (field.key === "GEMINI_API_KEY")
        return ["custom", "gemini_api_key", "model_provider"].includes(geminiMethod);
      if (field.key === "GOOGLE_API_KEY") return geminiMethod === "vertex_api_key";
      if (field.key === "GOOGLE_APPLICATION_CREDENTIALS")
        return geminiMethod === "vertex_service_account";
      return geminiMethod.startsWith("vertex_");
    }
    if (info.agent !== "antigravity" || field.key === "AGY_AUTH_METHOD") return true;
    if (field.key === "GEMINI_API_KEY") return method === "gemini-api-key";
    if (field.key === "GOOGLE_API_KEY") return method === "agent-platform";
    if (field.key === "GOOGLE_CLOUD_PROJECT" || field.key === "GOOGLE_CLOUD_LOCATION")
      return (
        method === "oauth-business" ||
        (method === "agent-platform" && !acpEnvValue(text, "GOOGLE_API_KEY").trim())
      );
    return true;
  });
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const update = (next: string) => {
    setError(null);
    onChange(next);
  };

  return (
    <section className="space-y-3 border-t border-border pt-4" data-testid="acp-agent-environment">
      <h4 className="text-ui-base font-medium">{label("title")}</h4>
      <p className="text-ui-sm text-foreground-subtle">{label(`hint.${info.agent}`)}</p>
      {info.agent === "qoder" ? (
        <div className="space-y-1.5">
          <p className="text-ui-sm text-foreground-subtle">{label("qoderLogin")}</p>
          <code
            className="block break-all rounded-lg bg-surface px-3 py-2 font-mono text-ui-sm"
            data-testid="acp-qoder-login-command"
          >
            {acpQoderLoginCommand(info)}
          </code>
        </div>
      ) : null}
      {/* 修复原因：原始变量区与连接字段重复且明文展示凭据；完整草稿仍保留隐藏的已有键。 */}
      {fields.length ? (
        <h5 className="text-ui-sm font-medium">
          {label(info.agent === "gemini" ? "geminiTitle" : "common")}
        </h5>
      ) : null}
      {fields.map((field) => {
        const id = `acp-env-${info.agent}-${field.key}`;
        const projected =
          providerMode &&
          ["GEMINI_MODEL", "GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"].includes(field.key);
        const value = projected
          ? ((field.key === "GEMINI_MODEL"
              ? selectedProvider?.model
              : field.key === "GEMINI_API_KEY"
                ? selectedProvider?.apiKey
                : selectedProvider?.apiUrl) ?? "")
          : acpEnvValue(text, field.key);
        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={id} className="text-ui-sm text-foreground-subtle">
              {label(field.label)}
              <code className="ml-2 break-all font-mono text-ui-xs">{field.key}</code>
            </label>
            <div className="flex items-center gap-2">
              {field.options ? (
                <Select
                  value={info.agent === "gemini" ? geminiMethod : value || "__default__"}
                  disabled={editorBusy}
                  onValueChange={(next) => {
                    let draft = patchAcpEnvText(
                      text,
                      field.key,
                      next === "__default__" ? "" : next,
                    );
                    if (
                      next === "model_provider" &&
                      !acpEnvValue(draft, "ZCODE_GEMINI_PROVIDER_ID") &&
                      providers.view?.providers[0]
                    )
                      draft = patchAcpEnvText(
                        draft,
                        "ZCODE_GEMINI_PROVIDER_ID",
                        providers.view.providers[0].id,
                      );
                    update(normalizeAcpAgentEnvText(info.agent, draft));
                  }}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {info.agent !== "gemini" ? (
                      <SelectItem value="__default__">{label("default")}</SelectItem>
                    ) : null}
                    {field.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {label(`method.${option}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  type={field.secret && !shown[field.key] ? "password" : "text"}
                  value={value}
                  readOnly={projected}
                  disabled={editorBusy}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    update(patchAcpAgentFieldText(info.agent, text, field.key, event.target.value))
                  }
                  placeholder={
                    info.agent === "gemini" && field.key === "GEMINI_MODEL"
                      ? "gemini-3-pro-preview"
                      : label("optional")
                  }
                />
              )}
              {field.secret ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label(shown[field.key] ? "hide" : "show")}
                  onClick={() =>
                    setShown((previous) => ({ ...previous, [field.key]: !previous[field.key] }))
                  }
                >
                  {shown[field.key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              ) : null}
            </div>
            {info.agent === "gemini" && field.key === "ZCODE_GEMINI_AUTH_MODE" ? (
              <>
                <p className="text-ui-sm text-foreground-subtle" data-testid="acp-gemini-auth-hint">
                  {label(`geminiHint.${geminiMethod}`)}
                </p>
                {providerMode ? (
                  <AcpGeminiProviderControls
                    providers={providers}
                    selectedId={acpEnvValue(text, "ZCODE_GEMINI_PROVIDER_ID")}
                    onSelect={(id) =>
                      update(
                        normalizeAcpAgentEnvText(
                          "gemini",
                          patchAcpEnvText(text, "ZCODE_GEMINI_PROVIDER_ID", id),
                        ),
                      )
                    }
                  />
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
      <AcpModelPicker
        id={modelKey ? `acp-env-${info.agent}-${modelKey}` : `acp-default-model-${info.agent}`}
        value={
          providerMode
            ? (selectedProvider?.model ?? "")
            : modelKey
              ? acpEnvValue(text, modelKey)
              : defaultModel
        }
        models={models.models}
        loading={models.loading}
        error={models.error ? modelLabel("failed") : null}
        disabled={editorBusy || !service}
        readOnly={providerMode || (!modelKey && !info.defaultModelSupported)}
        onRefresh={() => void models.reload()}
        onChange={(value) => {
          setError(null);
          if (modelKey) update(patchAcpAgentFieldText(info.agent, text, modelKey, value));
          else onDefaultModelChange(value);
        }}
        labels={{
          title: modelLabel("title"),
          refresh: modelLabel("refresh"),
          loading: modelLabel("loading"),
          placeholder: label("optional"),
          empty: modelLabel("empty"),
          hint: modelLabel(
            providerMode
              ? "providerHint"
              : !modelKey && !info.defaultModelSupported
                ? "oldHost"
                : modelKey
                  ? "envHint"
                  : "hint",
          ),
        }}
      />
      {info.agent === "gemini" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            platform.openExternal("https://geminicli.com/docs/get-started/authentication/")
          }
        >
          {label("geminiAuthDocs")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          !changed || editorBusy || (providerMode && (!selectedProvider || providers.loading))
        }
        onClick={() => {
          setError(null);
          void onSave(text).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        {info.agent === "gemini"
          ? label("saveGemini")
          : intl.formatMessage({ id: "settings.acpAgents.save" })}
      </Button>
      <p className="text-ui-sm text-foreground-subtle">{label("clearHint")}</p>
    </section>
  );
}
