'use client';

/**
 * The accuracy screen: test cases, a run button, and what broke.
 *
 * Built around one question — "is the assistant getting better or
 * worse?" — because before this there was no way to ask it. Somebody
 * would notice a bad reply, edit the prompt, and nobody found out what
 * else moved.
 *
 * The pass rate is the headline, but the failures are the point, so a
 * failed case shows the grader's reason and the reply it actually gave,
 * inline, without a second click.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Play, Plus, Trash2, CheckCircle2, XCircle, Sparkles, FlaskConical,
  UserCheck, Loader2, ChevronDown,
} from 'lucide-react';
import { AiButton, AiCard, AiCardHeader, AiIconTile, AiInput, AiLabel, AiHint, AiBadge, AiNotice } from './ui-kit';
import { Switch } from '@/components/ui/switch';

type EvalCase = {
  id: string;
  question: string;
  expected: string | null;
  expect_handoff: boolean;
  category: string | null;
  notes: string | null;
  enabled: boolean;
};

type EvalRun = {
  id: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  label: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type EvalResult = {
  id: string;
  case_id: string;
  passed: boolean;
  reply: string | null;
  handed_off: boolean;
  confidence: number | null;
  verdict: string | null;
  latency_ms: number | null;
};

export function EvalTab({ configured }: { configured: boolean }) {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [newQuestion, setNewQuestion] = useState('');
  const [newExpected, setNewExpected] = useState('');
  const [newExpectHandoff, setNewExpectHandoff] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-config/eval');
      if (!res.ok) return;
      const data = await res.json();
      setCases(data.cases ?? []);
      setRuns(data.runs ?? []);
      setResults(data.results ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setError('');
    const res = await fetch('/api/ai-config/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'That did not work.');
      return false;
    }
    await load();
    return true;
  };

  const runSuite = async () => {
    setRunning(true);
    try {
      await post({ action: 'run' });
    } finally {
      setRunning(false);
    }
  };

  const addCase = async () => {
    if (!newQuestion.trim()) return;
    setAdding(true);
    try {
      const ok = await post({
        action: 'create_case',
        question: newQuestion,
        expected: newExpected || null,
        expect_handoff: newExpectHandoff,
      });
      if (ok) {
        setNewQuestion('');
        setNewExpected('');
        setNewExpectHandoff(false);
      }
    } finally {
      setAdding(false);
    }
  };

  const latest = runs[0];
  const previous = runs[1];
  const passRate = latest && latest.total > 0 ? Math.round((latest.passed / latest.total) * 100) : null;
  const previousRate =
    previous && previous.total > 0 ? Math.round((previous.passed / previous.total) * 100) : null;
  const delta = passRate !== null && previousRate !== null ? passRate - previousRate : null;

  const resultFor = (caseId: string) => results.find((r) => r.case_id === caseId);
  const enabledCount = cases.filter((c) => c.enabled).length;

  if (!configured) {
    return (
      <AiCard>
        <div className="p-5">
          <AiNotice tone="info" icon={<FlaskConical className="h-4 w-4" />}>
            Set up the assistant first. Tests run against your live settings, so there needs to be something to test.
          </AiNotice>
        </div>
      </AiCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Score + run ── */}
      <AiCard>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <AiIconTile tint="violet">
              <FlaskConical className="h-5 w-5" />
            </AiIconTile>
            <div className="min-w-0">
              {passRate === null ? (
                <>
                  <p className="text-[15px] font-semibold text-slate-900">Not measured yet</p>
                  <p className="text-[12.5px] text-slate-500">
                    {enabledCount > 0
                      ? `${enabledCount} test${enabledCount === 1 ? '' : 's'} ready to run.`
                      : 'Add some tests, or load the starter set below.'}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[28px] font-semibold leading-none tabular-nums text-slate-900">
                      {passRate}%
                    </span>
                    <span className="text-[13px] text-slate-500">
                      {latest.passed} of {latest.total} passed
                    </span>
                    {delta !== null && delta !== 0 && (
                      <AiBadge tone={delta > 0 ? 'emerald' : 'rose'}>
                        {delta > 0 ? '+' : ''}{delta} vs last run
                      </AiBadge>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Last run {new Date(latest.started_at).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {cases.length === 0 && (
              <AiButton tone="outline" onClick={() => void post({ action: 'seed' })}>
                <Sparkles className="h-3.5 w-3.5" />
                Load 30 starter tests
              </AiButton>
            )}
            <AiButton onClick={() => void runSuite()} disabled={running || enabledCount === 0}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {running ? 'Running…' : 'Run all tests'}
            </AiButton>
          </div>
        </div>

        {running && (
          <div className="border-t border-slate-100 px-5 py-3">
            <AiHint>
              Running {enabledCount} tests one at a time against your live settings. This takes a couple of
              minutes and uses tokens — the same as {enabledCount} real conversations.
            </AiHint>
          </div>
        )}

        {error && (
          <div className="border-t border-slate-100 px-5 py-3">
            <AiNotice tone="error" icon={<XCircle className="h-4 w-4" />}>{error}</AiNotice>
          </div>
        )}

        {latest?.error && (
          <div className="border-t border-slate-100 px-5 py-3">
            <AiNotice tone="error" icon={<XCircle className="h-4 w-4" />}>
              The last run stopped early: {latest.error}
            </AiNotice>
          </div>
        )}
      </AiCard>

      {/* ── Add a test ── */}
      <AiCard>
        <div className="p-5">
          <AiCardHeader
            title="Add a test"
            subtitle="A question a customer really asks, and what a correct answer must say."
          />
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <AiLabel htmlFor="eval-question">Question</AiLabel>
              <AiInput
                id="eval-question"
                placeholder="What is the fee for the diploma course?"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <AiLabel htmlFor="eval-expected">Correct answer must say</AiLabel>
              <AiInput
                id="eval-expected"
                placeholder="₹45,000 for the full year"
                value={newExpected}
                onChange={(e) => setNewExpected(e.target.value)}
                disabled={newExpectHandoff}
              />
              <AiHint>
                Graded on meaning, not wording — &ldquo;₹45,000&rdquo; and &ldquo;forty-five thousand&rdquo; both
                pass. Leave blank to only check that it answers without inventing anything.
              </AiHint>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-800">This should go to a person</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                  For refunds, complaints, discounts — anything the assistant must not decide. Without a few of
                  these, a test suite only rewards answering confidently.
                </p>
              </div>
              <Switch checked={newExpectHandoff} onCheckedChange={setNewExpectHandoff} />
            </div>
            <AiButton onClick={() => void addCase()} disabled={adding || !newQuestion.trim()}>
              <Plus className="h-3.5 w-3.5" />
              Add test
            </AiButton>
          </div>
        </div>
      </AiCard>

      {/* ── The cases ── */}
      <AiCard>
        <div className="p-5">
          <AiCardHeader
            title={`Tests (${cases.length})`}
            subtitle="Turn one off to skip it without losing it."
          />
        </div>

        {loading ? (
          <div className="px-5 pb-5 text-[13px] text-slate-500">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="px-5 pb-5">
            <AiHint>No tests yet. Load the starter set above and edit them to match your business.</AiHint>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {cases.map((c) => {
              const result = resultFor(c.id);
              const isOpen = expanded === c.id;
              return (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0">
                      {!result ? (
                        <span className="block h-4 w-4 rounded-full ring-1 ring-slate-200" />
                      ) : result.passed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-600" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-medium text-slate-800">{c.question}</p>
                        {c.expect_handoff && (
                          <AiBadge tone="slate">
                            <UserCheck className="h-3 w-3" />
                            Should escalate
                          </AiBadge>
                        )}
                        {c.category && <AiBadge tone="slate">{c.category}</AiBadge>}
                      </div>

                      {c.expected && (
                        <p className="mt-0.5 truncate text-[11.5px] text-slate-500">Must say: {c.expected}</p>
                      )}

                      {result && !result.passed && result.verdict && (
                        <p className="mt-1 text-[12px] leading-relaxed text-rose-700">{result.verdict}</p>
                      )}

                      {result?.reply && (
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : c.id)}
                          className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-[#4A5AE8] hover:underline"
                        >
                          <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          {isOpen ? 'Hide the reply' : 'See what it replied'}
                        </button>
                      )}

                      {isOpen && result?.reply && (
                        <div className="mt-2 whitespace-pre-wrap rounded-xl bg-[#F7F8FC] p-3 text-[12.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200/70">
                          {result.reply}
                          {result.confidence !== null && (
                            <span className="mt-2 block text-[11px] text-slate-500">
                              Confidence {result.confidence.toFixed(2)}
                              {result.latency_ms ? ` · ${(result.latency_ms / 1000).toFixed(1)}s` : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Switch
                        checked={c.enabled}
                        onCheckedChange={(v) => void post({ action: 'update_case', id: c.id, enabled: v })}
                      />
                      <button
                        type="button"
                        aria-label={`Delete test: ${c.question}`}
                        onClick={() => void post({ action: 'delete_case', id: c.id })}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AiCard>
    </div>
  );
}
