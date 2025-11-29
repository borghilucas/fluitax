'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/api';
import { Button } from '@/ui/button';

type HealthResponse = Record<string, unknown>;

export default function HealthPage() {
  const [result, setResult] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const apiHost = process.env.NEXT_PUBLIC_API_HOST?.trim() ?? '';

  const handlePing = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchJson<HealthResponse>('/health');
      setResult(response);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Nao foi possivel contatar a API.';
      setError(message);
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 [grid-template-columns:minmax(0,1.2fr)_minmax(0,320px)]">
        <p className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          A API configurada via <code className="rounded bg-[var(--color-gray-100)] px-1 py-0.5 text-[0.8rem]">NEXT_PUBLIC_API_HOST</code> é consultada diretamente com <code className="rounded bg-[var(--color-gray-100)] px-1 py-0.5 text-[0.8rem]">fetch</code>. Utilize o ping abaixo para validar conectividade e payload.
        </p>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          <strong className="block text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]/80">
            API Base URL
          </strong>
          <span className="font-mono text-sm text-[var(--color-text-primary)]">
            {apiHost || '-- não configurado --'}
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handlePing} disabled={isLoading}>
          {isLoading ? 'Consultando...' : 'Ping API'}
        </Button>
        <span className="text-xs text-[var(--color-text-secondary)]/80">
          Retorna o JSON de <code className="rounded bg-[var(--color-gray-100)] px-1 py-0.5 text-[0.8rem]">/health</code>.
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]"
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <pre className="max-h-[420px] overflow-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[#0f172a] p-4 text-xs text-[var(--color-gray-100)] shadow-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
