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
  UserCheck, Loader2, ChevronDown, MessagesSquare, Pencil, ShieldCheck, AlertTriangle, Search, HelpCircle,
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
  must_include: string[] | null;
  must_not_include: string[] | null;
};

type QualityReport = {
  days: number;
  ai_replies: number;
  caught: number;
  unsupported: number;
  table_searches: number;
  handovers: Array<{ reason: string; count: number }>;
  caught_items: Array<{ text: string; count: number }>;
  no_knowledge: Array<{ question: string; count: number }>;
};

type RealQuestion = { question: string; count: number; last_at: string };

/** One phrase per line, as the exact checks store them. */
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

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
  const [newMustInclude, setNewMustInclude] = useState('');
  const [newMustNot, setNewMustNot] = useState('');
  const [adding, setAdding] = useState(false);

  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [suggestions, setSuggestions] = useState<RealQuestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ expected: '', mustInclude: '', mustNot: '' });

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

  useEffect(() => {
    if (!configured) return;
    fetch('/api/ai-config/eval?view=quality')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data && typeof data.ai_replies === 'number') setQuality(data); })
      .catch(() => {});
  }, [configured]);

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
        must_include: lines(newMustInclude),
        must_not_include: lines(newMustNot),
      });
      if (ok) {
        setNewQuestion('');
        setNewExpected('');
        setNewExpectHandoff(false);
        setNewMustInclude('');
        setNewMustNot('');
      }
    } finally {
      setAdding(false);
    }
  };

  const suggestFromChats = async () => {
    setSuggesting(true);
    setError('');
    try {
      const res = await fetch('/api/ai-config/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest_from_chats' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not read your chats.');
      setSuggestions(data.questions ?? []);
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your chats.');
    } finally {
      setSuggesting(false);
    }
  };

  const addPicked = async () => {
    const ok = await post({ action: 'add_questions', questions: [...picked] });
    if (ok) {
      setSuggestions(null);
      setPicked(new Set());
    }
  };

  const startEdit = (c: EvalCase) => {
    setEditing(c.id);
    setDraft({
      expected: c.expected ?? '',
      mustInclude: (c.must_include ?? []).join('\n'),
      mustNot: (c.must_not_include ?? []).join('\n'),
    });
  };

  const saveEdit = async (id: string) => {
    const ok = await post({
      action: 'update_case',
      id,
      expected: draft.expected || null,
      must_include: lines(draft.mustInclude),
      must_not_include: lines(draft.mustNot),
    });
    if (ok) setEditing(null);
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
      {/* ── Real conversations, last 7 days ── */}
      {quality && quality.ai_replies > 0 && (
        <AiCard>
          <div className="p-5">
            <AiCardHeader
              title={`Real conversations · last ${quality.days} days`}
              subtitle="What the assistant actually did with what customers sent — the tests below say how it does on questions you wrote."
            />
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <QualityTile icon={<MessagesSquare className="h-4 w-4" />} label="AI replies" value={quality.ai_replies} />
              <QualityTile
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Caught before sending"
                value={quality.caught}
                tone={quality.caught > 0 ? 'emerald' : 'slate'}
              />
              <QualityTile
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Lines found in no source"
                value={quality.unsupported}
                tone={quality.unsupported > 0 ? 'amber' : 'slate'}
              />
              <QualityTile icon={<Search className="h-4 w-4" />} label="Table searches" value={quality.table_searches} />
            </div>

            {quality.handovers.length > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
                Handed to a person:{' '}
                {quality.handovers.map((h) => `${h.reason.toLowerCase()} (${h.count})`).join(' · ')}
              </p>
            )}

            {quality.no_knowledge.length > 0 && (
              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800">
                  <HelpCircle className="h-3.5 w-3.5 text-amber-600" />
                  Asked, with nothing to answer from
                </p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  Add the answer to the knowledge base, or make it a test so you know when it is fixed.
                </p>
                <ul className="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                  {quality.no_knowledge.map((q) => (
                    <li key={q.question} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 break-words text-[12.5px] text-slate-700">{q.question}</span>
                      {q.count > 1 && <AiBadge tone="slate">{q.count}×</AiBadge>}
                      <button
                        type="button"
                        onClick={() => void post({ action: 'add_questions', questions: [q.question] })}
                        className="shrink-0 text-[11.5px] font-medium text-[#4A5AE8] hover:underline"
                      >
                        Make it a test
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {quality.caught_items.length > 0 && (
              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Kept out of replies
                </p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  Listed by the assistant but in none of your data. If one of these is real, add it to your knowledge.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {quality.caught_items.map((c) => (
                    <li key={c.text} className="rounded-lg bg-slate-50 px-2 py-1 text-[11.5px] text-slate-600 ring-1 ring-slate-200">
                      {c.text}{c.count > 1 ? ` · ${c.count}×` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </AiCard>
      )}

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
            {!newExpectHandoff && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <AiLabel htmlFor="eval-must-include">Must include, word for word</AiLabel>
                  <textarea
                    id="eval-must-include"
                    rows={3}
                    placeholder={'Gold loan Appraisal\nStatutory Training Programme (STP) (M)'}
                    value={newMustInclude}
                    onChange={(e) => setNewMustInclude(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-[#5B6CF9] focus:ring-2 focus:ring-[#5B6CF9]/15"
                  />
                </div>
                <div className="space-y-1.5">
                  <AiLabel htmlFor="eval-must-not">Must not include</AiLabel>
                  <textarea
                    id="eval-must-not"
                    rows={3}
                    placeholder={'Leadership and Good Governance'}
                    value={newMustNot}
                    onChange={(e) => setNewMustNot(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-[#5B6CF9] focus:ring-2 focus:ring-[#5B6CF9]/15"
                  />
                </div>
                <div className="sm:col-span-2">
                  <AiHint>
                    One per line. Checked exactly, before any grading: every name on the left must be in the reply
                    and none on the right — so a list that leaves one out, or adds one that does not exist, fails.
                  </AiHint>
                </div>
              </div>
            )}
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
            <div className="flex flex-wrap gap-2">
              <AiButton onClick={() => void addCase()} disabled={adding || !newQuestion.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Add test
              </AiButton>
              <AiButton tone="outline" onClick={() => void suggestFromChats()} disabled={suggesting}>
                {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessagesSquare className="h-3.5 w-3.5" />}
                Add from real chats
              </AiButton>
            </div>

            {suggestions && (
              <div className="rounded-2xl ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
                  <p className="text-[12.5px] font-semibold text-slate-800">
                    {suggestions.length > 0 ? 'Asked by customers in the last 30 days' : 'No new questions in the last 30 days'}
                  </p>
                  <button type="button" onClick={() => setSuggestions(null)} className="text-[11.5px] text-slate-500 hover:text-slate-800">
                    Close
                  </button>
                </div>
                {suggestions.length > 0 && (
                  <>
                    <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {suggestions.map((q) => (
                        <li key={q.question}>
                          <label className="flex cursor-pointer items-start gap-3 px-4 py-2 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={picked.has(q.question)}
                              onChange={(e) =>
                                setPicked((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(q.question);
                                  else next.delete(q.question);
                                  return next;
                                })
                              }
                              className="mt-0.5 accent-[#5B6CF9]"
                            />
                            <span className="min-w-0 flex-1 break-words text-[12.5px] text-slate-700">{q.question}</span>
                            {q.count > 1 && <AiBadge tone="slate">{q.count}×</AiBadge>}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5">
                      <AiHint>Messages with a phone number, email or ID number are never offered.</AiHint>
                      <AiButton onClick={() => void addPicked()} disabled={picked.size === 0}>
                        <Plus className="h-3.5 w-3.5" />
                        Add {picked.size || ''} as tests
                      </AiButton>
                    </div>
                  </>
                )}
              </div>
            )}
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
                      {(c.must_include?.length ?? 0) > 0 && (
                        <p className="mt-0.5 break-words text-[11.5px] text-slate-500">
                          Must include: {c.must_include!.join(' · ')}
                        </p>
                      )}
                      {(c.must_not_include?.length ?? 0) > 0 && (
                        <p className="mt-0.5 break-words text-[11.5px] text-slate-500">
                          Must not include: {c.must_not_include!.join(' · ')}
                        </p>
                      )}
                      {!c.expect_handoff && !c.expected && !(c.must_include?.length) && c.category === 'from chats' && (
                        <p className="mt-0.5 text-[11.5px] text-amber-700">Asked by a customer — add what a correct answer must say.</p>
                      )}

                      {editing === c.id && (
                        <div className="mt-2 space-y-2 rounded-xl bg-[#F7F8FC] p-3 ring-1 ring-slate-200/70">
                          <AiInput
                            aria-label="Correct answer must say"
                            placeholder="Correct answer must say…"
                            value={draft.expected}
                            onChange={(e) => setDraft((d) => ({ ...d, expected: e.target.value }))}
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <textarea
                              aria-label="Must include, one per line"
                              rows={3}
                              placeholder="Must include, one per line"
                              value={draft.mustInclude}
                              onChange={(e) => setDraft((d) => ({ ...d, mustInclude: e.target.value }))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#5B6CF9]"
                            />
                            <textarea
                              aria-label="Must not include, one per line"
                              rows={3}
                              placeholder="Must not include, one per line"
                              value={draft.mustNot}
                              onChange={(e) => setDraft((d) => ({ ...d, mustNot: e.target.value }))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#5B6CF9]"
                            />
                          </div>
                          <div className="flex gap-2">
                            <AiButton onClick={() => void saveEdit(c.id)}>Save</AiButton>
                            <AiButton tone="ghost" onClick={() => setEditing(null)}>Cancel</AiButton>
                          </div>
                        </div>
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
                      {!c.expect_handoff && editing !== c.id && (
                        <button
                          type="button"
                          aria-label={`Edit test: ${c.question}`}
                          onClick={() => startEdit(c)}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
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

function QualityTile({
  icon,
  label,
  value,
  tone = 'slate',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'slate' | 'emerald' | 'amber';
}) {
  const tint =
    tone === 'emerald' ? 'text-emerald-700 bg-emerald-50' : tone === 'amber' ? 'text-amber-800 bg-amber-50' : 'text-slate-600 bg-slate-50';
  return (
    <div className="rounded-xl p-3 ring-1 ring-slate-200/80">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${tint}`}>{icon}</span>
      <p className="mt-2 text-[20px] font-semibold leading-none tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-[11.5px] text-slate-500">{label}</p>
    </div>
  );
}
