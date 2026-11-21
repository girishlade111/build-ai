"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2, PlugZap, Trash2, X } from "lucide-react";
import type { Locale } from "@ladestack/i18n";
import { providerStrings, type ProviderStrings } from "../i18n/providers";
import { testConnection, type ConnectError, type ModelInfo } from "../providers/connect";
import { looksLikeKey, providerIds, providers, type ProviderId } from "../providers/registry";
import { setSession } from "../providers/session";
import { useProviderSession } from "../providers/useProviderSession";
import { ActionButton, ShimmerButton } from "./ui";
import styles from "./ProviderSetup.module.css";

const errorKey: Record<ConnectError | "bad-key", keyof ProviderStrings> = {
  "bad-key": "badKey",
  "invalid-key": "invalidKey",
  billing: "billing",
  "rate-limit": "rateLimit",
  unavailable: "unavailable",
  network: "network",
  timeout: "timeout",
  "no-models": "noModels",
  unexpected: "unexpected",
};

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

/** Header chip + dialog for BYOK setup (PRD A.17, BYOK-01..07). Calls go browser → provider. */
export function ProviderSetup({ locale, idleLabel }: { locale: Locale; idleLabel: string }) {
  const t = providerStrings[locale];
  const session = useProviderSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const ids = useId();

  const [provider, setProvider] = useState<ProviderId>(session?.provider ?? "openrouter");
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConnectError | "bad-key" | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [model, setModel] = useState("");

  function open() {
    setProvider(session?.provider ?? "openrouter");
    setKey("");
    setReveal(false);
    setError(null);
    setModels(null);
    setModel(session?.model ?? "");
    dialog.current?.showModal();
  }

  function close() {
    abort.current?.abort();
    setKey(""); // don't keep an unsaved key around in component state
    dialog.current?.close();
  }

  function chooseProvider(id: ProviderId) {
    setProvider(id);
    setModels(null);
    setError(null);
  }

  async function test(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!looksLikeKey(trimmed)) {
      setError("bad-key");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setError(null);
    setModels(null);
    const result = await testConnection(provider, trimmed, { signal: abort.current.signal });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Tool-capable models first: the builder agent needs tool calling.
    const sorted = [...result.models].sort(
      (a, b) => Number(b.tools === true) - Number(a.tools === true),
    );
    setModels(sorted);
    setModel(sorted.some((m) => m.id === model) ? model : sorted[0]!.id);
  }

  function save() {
    if (!models || !model) return;
    const inputs = models.find((m) => m.id === model)?.inputs;
    setSession({ provider, key: key.trim(), model, ...(inputs ? { inputs } : {}) });
    close();
  }

  function forget() {
    setSession(null);
    close();
  }

  const name = providers[provider].name;
  return (
    <>
      <button type="button" className={styles.trigger} onClick={open} data-connected={!!session}>
        {session ? (
          <span className={styles.liveDot} aria-hidden="true" />
        ) : (
          <KeyRound size={14} aria-hidden="true" />
        )}
        <span className={styles.triggerLabel}>
          {session
            ? fill(t.connected, { provider: providers[session.provider].name, model: session.model })
            : idleLabel}
        </span>
      </button>

      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={`${ids}-title`}
        onClose={() => abort.current?.abort()}
      >
        <form className={styles.form} onSubmit={test}>
          <div className={styles.dialogHeader}>
            <div>
              <h2 id={`${ids}-title`} className={styles.title}>
                {t.title}
              </h2>
              <p className={styles.text} style={{ marginTop: 4 }}>
                {t.intro}
              </p>
            </div>
            <button
              type="button"
              className={styles.closeIconBtn}
              aria-label={t.close}
              onClick={close}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <fieldset className={styles.providers}>
            <legend className={styles.label}>{t.provider}</legend>
            {providerIds.map((id) => (
              <label key={id} className={styles.option}>
                <input
                  type="radio"
                  name={`${ids}-provider`}
                  checked={provider === id}
                  onChange={() => chooseProvider(id)}
                />
                <span>{providers[id].name}</span>
                {provider === id ? (
                  <Check size={14} className={styles.optionCheck} aria-hidden="true" />
                ) : null}
              </label>
            ))}
          </fieldset>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${ids}-key`}>
              {t.key}
            </label>
            <div className={styles.keyRow}>
              <input
                id={`${ids}-key`}
                className={styles.input}
                type={reveal ? "text" : "password"}
                value={key}
                placeholder="sk-..."
                onChange={(e) => {
                  setKey(e.target.value);
                  setModels(null);
                  setError(null);
                }}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={`${ids}-keynote`}
                aria-invalid={error === "bad-key" || error === "invalid-key"}
              />
              <ActionButton
                type="button"
                variant="outline"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? t.hide : t.show}
              >
                {reveal ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                <span>{reveal ? t.hide : t.show}</span>
              </ActionButton>
            </div>
            <p id={`${ids}-keynote`} className={styles.small}>
              {t.keyNote}{" "}
              <a href={providers[provider].keyUrl} target="_blank" rel="noopener noreferrer">
                {fill(t.getKey, { provider: name })}
              </a>
            </p>
          </div>

          <div className={styles.testRow}>
            <ActionButton type="submit" variant="secondary" disabled={busy || key.trim() === ""}>
              {busy ? (
                <Loader2 size={14} aria-hidden="true" />
              ) : (
                <PlugZap size={14} aria-hidden="true" />
              )}
              <span>{busy ? t.testing : t.test}</span>
            </ActionButton>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {t[errorKey[error]]}
            </p>
          ) : null}

          {models ? (
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`${ids}-model`}>
                {t.model}
              </label>
              <select
                id={`${ids}-model`}
                className={styles.input}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-describedby={`${ids}-modelhint`}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.tools ? `${m.label} · ${t.tools}` : m.label}
                  </option>
                ))}
              </select>
              <p id={`${ids}-modelhint`} className={styles.small}>
                {t.modelHint}
              </p>
            </div>
          ) : null}

          <div className={styles.actions}>
            {session ? (
              <ActionButton type="button" variant="danger" compact onClick={forget}>
                <Trash2 size={13} aria-hidden="true" />
                <span>{t.remove}</span>
              </ActionButton>
            ) : null}
            <span className={styles.spacer} />
            <ActionButton type="button" variant="ghost" onClick={close}>
              {t.close}
            </ActionButton>
            <ShimmerButton type="button" onClick={save} disabled={!models || !model}>
              {t.save}
            </ShimmerButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
