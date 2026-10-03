import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatEther, isAddress, parseEther } from 'viem';
import { contractTextError, previewProposal } from './lib/preview';
import { chooseAvailableRoundId } from './lib/round-selection';
import {
  DEPLOYMENT_TRANSACTION,
  STUDIONET_CONTRACT_ADDRESS,
  explorerContract,
  explorerTransaction,
} from './lib/public-config';
import type { Criterion, ProposalRecord, RoundRecord } from './types';
import type { WalletOption } from './lib/genlayer';

type View = 'rounds' | 'create' | 'apply' | 'agents';
type Notice = { tone: 'good' | 'bad' | 'info'; text: string; hash?: string } | null;
type HealthResponse = {
  ok: boolean;
  contract?: { version: string; roundCount: string; proposalCount: string };
};

const defaultCriteria: Criterion[] = [
  {
    id: 'impact',
    label: 'Public impact',
    description: 'Identify the people served, the problem solved, and a measurable public outcome.',
    weight: 55,
  },
  {
    id: 'delivery',
    label: 'Delivery confidence',
    description: 'Provide concrete milestones, ownership, acceptance tests, and meaningful delivery risks.',
    weight: 45,
  },
];

function shortAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function formatGen(value: string) {
  try {
    const formatted = Number(formatEther(BigInt(value)));
    return new Intl.NumberFormat('en', { maximumFractionDigits: 4 }).format(formatted);
  } catch {
    return '0';
  }
}

function formatDate(value: string) {
  const date = new Date(Number(value) * 1_000);
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function localDeadline(days = 30) {
  const value = new Date(Date.now() + days * 86_400_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function cleanSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export function errorText(error: unknown) {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, '');
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object' && 'message' in error
    && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim().replace(/^Error:\s*/, '');
  }
  return 'Something went wrong. Please try again.';
}

export function walletConnectionErrorText(error: unknown) {
  const detail = errorText(error);
  return detail === 'Something went wrong. Please try again.'
    ? 'Wallet connection failed. Unlock your wallet and approve this site, then try again.'
    : detail;
}

function errorNotice(error: unknown): Notice {
  const hash = error && typeof error === 'object' && 'hash' in error
    && typeof error.hash === 'string' ? error.hash : undefined;
  return { tone: 'bad', text: errorText(error), hash };
}

function requireContractText(value: string, label: string, minimum: number, maximum: number) {
  const error = contractTextError(value, label, minimum, maximum);
  if (error) throw new Error(error);
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><i />{status}</span>;
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      {notice.hash && <a href={explorerTransaction(notice.hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}
      <button type="button" onClick={onClose} aria-label="Dismiss message">×</button>
    </div>
  );
}

function CreateRoundForm({
  account,
  onNeedWallet,
  onComplete,
}: {
  account: string;
  onNeedWallet: () => Promise<string>;
  onComplete: () => Promise<void>;
}) {
  const [title, setTitle] = useState('Community tools sprint');
  const [roundKey, setRoundKey] = useState('community-tools-sprint');
  const [mission, setMission] = useState('Fund practical, open tools that make community work more useful, measurable, and sustainable.');
  const [deadline, setDeadline] = useState(localDeadline());
  const [appealDays, setAppealDays] = useState('7');
  const [minimumScore, setMinimumScore] = useState('60');
  const [winnerCount, setWinnerCount] = useState('1');
  const [payouts, setPayouts] = useState('100');
  const [pool, setPool] = useState('0');
  const [bond, setBond] = useState('0');
  const [reviewer, setReviewer] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>(defaultCriteria);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  function updateCriterion(index: number, field: keyof Criterion, value: string) {
    setCriteria((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, [field]: field === 'weight' ? Number(value) : value }
      : item));
  }

  function addCriterion() {
    if (criteria.length >= 6) return;
    setCriteria((current) => [...current, {
      id: `criterion-${current.length + 1}`,
      label: 'New criterion',
      description: 'Describe the evidence a strong proposal should provide for this criterion.',
      weight: 5,
    }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    try {
      requireContractText(title, 'Round title', 4, 100);
      requireContractText(mission, 'Mission', 24, 1_800);
      if (criteria.length < 2 || criteria.length > 6) throw new Error('Use 2–6 rubric criteria.');
      const ids = new Set<string>();
      for (const criterion of criteria) {
        const id = cleanSlug(criterion.id);
        if (!/^[a-z0-9](?:[a-z0-9-]{2,46}[a-z0-9])?$/.test(id) || ids.has(id)) {
          throw new Error('Criterion keys must be unique slugs of 4–48 characters.');
        }
        ids.add(id);
        requireContractText(criterion.label, `Criterion “${id}” label`, 3, 80);
        requireContractText(criterion.description, `Criterion “${id}” rule`, 16, 500);
        if (!Number.isInteger(criterion.weight) || criterion.weight < 5 || criterion.weight > 80) {
          throw new Error('Each criterion weight must be an integer from 5 to 80.');
        }
      }
      const weights = criteria.reduce((sum, item) => sum + item.weight, 0);
      if (weights !== 100) throw new Error('Criterion weights must total exactly 100.');
      const deadlineEpoch = Math.floor(new Date(deadline).getTime() / 1_000);
      const now = Math.floor(Date.now() / 1_000);
      if (!Number.isFinite(deadlineEpoch) || deadlineEpoch < now + 60 || deadlineEpoch > now + 180 * 86_400) {
        throw new Error('Deadline must be between one minute and 180 days from now.');
      }
      if (!Number.isInteger(Number(appealDays)) || Number(appealDays) < 1 || Number(appealDays) > 14) {
        throw new Error('Appeal window must be 1–14 days.');
      }
      if (!Number.isInteger(Number(winnerCount)) || Number(winnerCount) < 1 || Number(winnerCount) > 8) {
        throw new Error('Choose 1–8 winners.');
      }
      if (!Number.isInteger(Number(minimumScore)) || Number(minimumScore) < 25 || Number(minimumScore) > 95) {
        throw new Error('Minimum score must be an integer from 25 to 95.');
      }
      const payoutBps = payouts.split(',').map((item) => Math.round(Number(item.trim()) * 100));
      if (payoutBps.length !== Number(winnerCount) || payoutBps.some((item) => !Number.isInteger(item) || item <= 0)) {
        throw new Error('Enter one positive payout percentage per winner.');
      }
      if (payoutBps.reduce((sum, item) => sum + item, 0) !== 10_000) {
        throw new Error('Winner payout percentages must total 100.');
      }
      const poolAtto = parseEther(pool || '0');
      const bondAtto = parseEther(bond || '0');
      if (poolAtto < 0n || poolAtto > 10n ** 30n) throw new Error('Pool must be between 0 and 1 trillion test GEN.');
      if (bondAtto < 0n || bondAtto > poolAtto) throw new Error('Proposal bond cannot exceed the pool.');
      if (poolAtto === 0n && bondAtto !== 0n) throw new Error('Decision-only rounds must use a zero proposal bond.');
      const reviewerAddress = poolAtto > 0n ? reviewer.trim() : '0x0000000000000000000000000000000000000000';
      if (!isAddress(reviewerAddress)) throw new Error('Enter a valid EVM wallet address for the evidence reviewer.');
      const connected = account || await onNeedWallet();
      if (poolAtto > 0n && reviewerAddress.toLowerCase() === connected.toLowerCase()) {
        throw new Error('The reviewer must use a different wallet from the round creator.');
      }
      setBusy(true);
      setNotice({ tone: 'info', text: 'Confirm the round in your wallet.' });
      let submittedHash = '';
      const { createRound } = await import('./lib/genlayer');
      await createRound(connected, {
        roundKey: cleanSlug(roundKey),
        title: title.trim(),
        mission: mission.trim(),
        submissionDeadline: deadlineEpoch,
        appealSeconds: Math.round(Number(appealDays) * 86_400),
        winnerCount: Number(winnerCount),
        minimumScore: Number(minimumScore),
        proposalBondAtto: bondAtto,
        reviewer: reviewerAddress,
        criteria: criteria.map((item) => ({ ...item, id: cleanSlug(item.id) })),
        payoutBps,
        poolAtto,
      }, (hash) => {
        submittedHash = hash;
        setNotice({ tone: 'info', text: 'Round submitted. Waiting for validator finality…', hash });
      });
      await onComplete();
      setNotice({ tone: 'good', text: 'Your round is finalized and now public.', hash: submittedHash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="builder-form" onSubmit={submit}>
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <div className="form-grid two">
        <label>Round title<input value={title} minLength={4} maxLength={100} required onChange={(event) => {
          setTitle(event.target.value);
          setRoundKey(cleanSlug(event.target.value));
        }} /></label>
        <label>Unique key<input value={roundKey} minLength={4} maxLength={48} required pattern="[a-z0-9][a-z0-9-]{2,46}[a-z0-9]" onChange={(event) => setRoundKey(cleanSlug(event.target.value))} /></label>
      </div>
      <label>Mission<textarea value={mission} minLength={24} maxLength={1800} rows={3} required onChange={(event) => setMission(event.target.value)} /></label>
      <div className="form-grid four">
        <label>Deadline<input type="datetime-local" value={deadline} required onChange={(event) => setDeadline(event.target.value)} /></label>
        <label>Appeal days<input type="number" min="1" max="14" step="1" value={appealDays} required onChange={(event) => setAppealDays(event.target.value)} /></label>
        <label>Minimum score<input type="number" min="25" max="95" step="1" value={minimumScore} required onChange={(event) => setMinimumScore(event.target.value)} /></label>
        <label>Winners<input type="number" min="1" max="8" step="1" value={winnerCount} required onChange={(event) => setWinnerCount(event.target.value)} /></label>
      </div>
      <div className="form-grid three">
        <label>Pool (test GEN)<input inputMode="decimal" value={pool} required onChange={(event) => setPool(event.target.value)} /><small>Use 0 for a decision-only round.</small></label>
        <label>Proposal bond (test GEN)<input inputMode="decimal" value={bond} required onChange={(event) => setBond(event.target.value)} /></label>
        <label>Payouts (%)<input value={payouts} required onChange={(event) => setPayouts(event.target.value)} /><small>Example: 60, 30, 10</small></label>
      </div>
      <label>Evidence reviewer wallet<input value={reviewer} placeholder="0x…" required={Number(pool) > 0} disabled={Number(pool) === 0} onChange={(event) => setReviewer(event.target.value)} /><small>Required for a funded round. Choose a wallet you trust that is not yours or an applicant's. Its signature gates payouts, but does not prove claims true.</small></label>

      <div className="criteria-head">
        <div><span className="eyebrow">Weighted rubric</span><h3>What should validators look for?</h3></div>
        <div className="weight-total">{criteria.reduce((sum, item) => sum + item.weight, 0)} / 100</div>
      </div>
      <div className="criteria-editor">
        {criteria.map((criterion, index) => (
          <fieldset key={`${criterion.id}-${index}`}>
            <legend>Criterion {index + 1}</legend>
            <div className="form-grid criterion-row">
              <label>Key<input value={criterion.id} required onChange={(event) => updateCriterion(index, 'id', cleanSlug(event.target.value))} /></label>
              <label>Label<input value={criterion.label} minLength={3} maxLength={80} required onChange={(event) => updateCriterion(index, 'label', event.target.value)} /></label>
              <label>Weight<input type="number" min="5" max="80" value={criterion.weight} required onChange={(event) => updateCriterion(index, 'weight', event.target.value)} /></label>
            </div>
            <label>Scoring rule<textarea rows={2} minLength={16} maxLength={500} value={criterion.description} required onChange={(event) => updateCriterion(index, 'description', event.target.value)} /></label>
            {criteria.length > 2 && <button className="text-button danger" type="button" onClick={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove criterion</button>}
          </fieldset>
        ))}
      </div>
      {criteria.length < 6 && <button className="outline-button compact" type="button" onClick={addCriterion}>+ Add criterion</button>}
      <div className="form-submit">
        <p>Your wallet creates the round directly on StudioNet. GrantArena never holds a private key.</p>
        <button className="primary-button" disabled={busy} type="submit">{busy ? 'Waiting for finality…' : account ? 'Create public round' : 'Connect & create round'} <span>↗</span></button>
      </div>
    </form>
  );
}

function ProposalForm({
  rounds,
  initialRound,
  account,
  onNeedWallet,
  onComplete,
}: {
  rounds: RoundRecord[];
  initialRound: RoundRecord | null;
  account: string;
  onNeedWallet: () => Promise<string>;
  onComplete: (round: RoundRecord) => Promise<void>;
}) {
  const openRounds = rounds.filter((round) => round.status === 'OPEN' && Number(round.submissionDeadline) * 1_000 > Date.now());
  const [roundId, setRoundId] = useState(chooseAvailableRoundId(openRounds, initialRound?.roundId));
  const selected = openRounds.find((round) => round.roundId === roundId) ?? null;
  const [title, setTitle] = useState('');
  const [proposalKey, setProposalKey] = useState('');
  const [summary, setSummary] = useState('');
  const [requested, setRequested] = useState('0.05');
  const [evidence, setEvidence] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRoundId((current) => chooseAvailableRoundId(
      openRounds,
      initialRound && openRounds.some((round) => round.roundId === initialRound.roundId)
        ? initialRound.roundId : current,
    ));
  }, [initialRound?.roundId, rounds]);

  useEffect(() => {
    if (!selected) return;
    setAnswers(Object.fromEntries(selected.criteria.map((criterion) => [criterion.id, ''])));
  }, [selected?.roundId]);

  const preview = selected ? previewProposal({ criteria: selected.criteria, answers }) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!selected) return setNotice({ tone: 'bad', text: 'Choose an open round first.' });
    if (!preview?.valid) return setNotice({ tone: 'bad', text: preview?.errors[0] ?? 'Complete every criterion.' });
    try {
      requireContractText(title, 'Proposal title', 4, 100);
      requireContractText(summary, 'Proposal summary', 40, 2_400);
      const requestedAtto = parseEther(requested);
      if (requestedAtto <= 0n || requestedAtto > 10n ** 30n
        || (BigInt(selected.poolAtto) > 0n && requestedAtto > BigInt(selected.poolAtto))) {
        throw new Error('Requested amount must be positive and cannot exceed this round’s funded pool.');
      }
      const evidenceUrls = evidence.split('\n').map((item) => item.trim()).filter(Boolean);
      if (BigInt(selected.poolAtto) > 0n && evidenceUrls.length === 0) {
        throw new Error('Funded proposals need at least one HTTPS evidence URL for reviewer assessment.');
      }
      if (evidenceUrls.length > 5 || new Set(evidenceUrls).size !== evidenceUrls.length
        || evidenceUrls.some((url) => url.length > 500
          || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/.test(url))) {
        throw new Error('Use up to five unique HTTPS evidence URLs, one per line.');
      }
      const connected = account || await onNeedWallet();
      setBusy(true);
      let submittedHash = '';
      setNotice({ tone: 'info', text: 'Confirm the proposal in your wallet.' });
      const { submitProposal } = await import('./lib/genlayer');
      await submitProposal(connected, {
        roundId: BigInt(selected.roundId),
        proposalKey: cleanSlug(proposalKey || title),
        title: title.trim(),
        summary: summary.trim(),
        requestedAtto,
        answers,
        evidenceUrls,
        bondAtto: BigInt(selected.proposalBondAtto),
      }, (hash) => {
        submittedHash = hash;
        setNotice({ tone: 'info', text: 'Validators are reviewing the proposal…', hash });
      });
      await onComplete(selected);
      setNotice({ tone: 'good', text: 'Proposal finalized. Its score and explanation are now public.', hash: submittedHash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="builder-form" onSubmit={submit}>
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {openRounds.length === 0 ? (
        <div className="empty-state"><span>○</span><h3>No rounds are open</h3><p>Create a round or come back when a new one opens.</p></div>
      ) : (
        <>
          <label>Choose a round<select value={roundId} onChange={(event) => setRoundId(event.target.value)}>{openRounds.map((round) => <option key={round.roundId} value={round.roundId}>#{round.roundId} · {round.title}</option>)}</select></label>
          {selected && (
            <div className="selected-round-strip">
              <div><span>Mission</span><strong>{selected.mission}</strong></div>
              <div><span>Closes</span><strong>{formatDate(selected.submissionDeadline)}</strong></div>
              <div><span>Bond</span><strong>{formatGen(selected.proposalBondAtto)} GEN</strong></div>
            </div>
          )}
          <div className="form-grid two">
            <label>Proposal title<input value={title} minLength={4} maxLength={100} required onChange={(event) => {
              setTitle(event.target.value);
              setProposalKey(cleanSlug(event.target.value));
            }} /></label>
            <label>Proposal key<input value={proposalKey} minLength={4} maxLength={48} required onChange={(event) => setProposalKey(cleanSlug(event.target.value))} /></label>
          </div>
          <label>Short summary<textarea value={summary} minLength={40} maxLength={2400} rows={3} required onChange={(event) => setSummary(event.target.value)} /></label>
          <div className="form-grid two">
            <label>Requested amount (test GEN)<input inputMode="decimal" value={requested} required onChange={(event) => setRequested(event.target.value)} /></label>
            <label>Evidence URLs<textarea value={evidence} rows={2} placeholder={'https://github.com/your-project\nhttps://your-demo.example'} onChange={(event) => setEvidence(event.target.value)} /><small>Required for funded rounds; optional for decision-only rounds. One HTTPS URL per line, maximum 5. A reviewer must inspect the sources; links alone are not authenticated proof.</small></label>
          </div>
          <div className="answer-list">
            {selected?.criteria.map((criterion) => {
              const cap = preview?.deterministicCaps.find((item) => item.id === criterion.id)?.maxScore ?? 0;
              return (
                <label key={criterion.id}>
                  <span className="answer-label"><b>{criterion.label}</b><em>{criterion.weight}% weight · max {cap}/100 before review</em></span>
                  <small>{criterion.description}</small>
                  <textarea value={answers[criterion.id] ?? ''} maxLength={1800} rows={5} onChange={(event) => setAnswers((current) => ({ ...current, [criterion.id]: event.target.value }))} />
                </label>
              );
            })}
          </div>
          {preview && <div className={`preview-band ${preview.valid ? 'preview-ready' : ''}`}><span>Completeness ceiling</span><strong>{preview.maximumWeightedScore}/100</strong><small>{preview.note}</small></div>}
          <div className="form-submit">
            <p>AI validators choose categorical grades; the contract applies caps, weights, ranking, and payouts.</p>
            <button className="primary-button" disabled={busy} type="submit">{busy ? 'Validators are working…' : account ? 'Submit for consensus' : 'Connect & submit'} <span>↗</span></button>
          </div>
        </>
      )}
    </form>
  );
}

function ProposalCard({ proposal, round }: { proposal: ProposalRecord; round: RoundRecord }) {
  const attested = proposal.attestedAt !== '0' && proposal.attestedDigest === proposal.evidenceDigest;
  return (
    <article className="proposal-card">
      <div className="proposal-score"><strong>{proposal.weightedScore}</strong><span>/100</span></div>
      <div className="proposal-copy">
        <div className="proposal-title-line"><h4>{proposal.title}</h4><StatusPill status={proposal.status} /></div>
        <p>{proposal.evaluationSummary}</p>
        <div className="grade-row">
          {proposal.grades.map((grade, index) => <span key={`${grade}-${index}`}><b>{round.criteria[index]?.label ?? `Criterion ${index + 1}`}</b>{grade}</span>)}
        </div>
        <div className="proposal-meta">
          <span>by {shortAddress(proposal.proposer)}</span><span>asks {formatGen(proposal.requestedAtto)} GEN</span>
          {proposal.rank > 0 && <span>rank #{proposal.rank}</span>}
          {BigInt(proposal.awardAtto) > 0n && <span>award {formatGen(proposal.awardAtto)} GEN</span>}
          {BigInt(round.poolAtto) > 0n && <span>{attested ? `Evidence attested by ${shortAddress(proposal.attestedBy)}` : round.status === 'FINALIZED' ? 'Not attested; no award' : 'Evidence awaiting reviewer attestation'}</span>}
        </div>
        <details className="proposal-evidence"><summary>Evidence and review record</summary>
          <p>Applicant-provided links are not authenticated by GrantArena. The named reviewer is responsible for checking them before signing.</p>
          {proposal.evidenceUrls.length > 0 ? <ul>{proposal.evidenceUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul> : <p>No links submitted.</p>}
          <p><b>Proposal digest:</b> <code>{proposal.evidenceDigest}</code></p>
          {attested && <p><b>Reviewer note:</b> {proposal.attestationNote} · {formatDate(proposal.attestedAt)}</p>}
        </details>
      </div>
    </article>
  );
}

function AgentPanel() {
  const origin = typeof window === 'undefined' ? 'https://your-site.vercel.app' : window.location.origin;
  const curl = `curl "${origin}/api/rounds?latest=1&limit=20"`;
  const tool = `const result = await fetch("${origin}/api/proposals?round=1");\nconst { proposals } = await result.json();`;
  return (
    <div className="agent-grid">
      <div className="agent-intro">
        <span className="eyebrow">No API key required</span>
        <h3>Give an agent public grant intelligence.</h3>
        <p>Agents can discover rounds, compare scores, read applicant-supplied evidence links, and run a deterministic completeness check over HTTPS. A wallet signature is still required for anything that changes on-chain state.</p>
        <div className="agent-rules"><span>Public reads</span><b>Keyless</b><span>Consensus writes</span><b>Wallet-signed</b><span>Source of truth</span><b>StudioNet</b></div>
        <a className="outline-button" href="/api/openapi" target="_blank" rel="noreferrer">OpenAPI document ↗</a>
      </div>
      <div className="code-stack">
        <div className="code-card"><div><span /><span /><span /><b>shell</b></div><pre>{curl}</pre></div>
        <div className="code-card"><div><span /><span /><span /><b>javascript</b></div><pre>{tool}</pre></div>
        <div className="endpoint-list">
          <a href="/api/health" target="_blank" rel="noreferrer"><code>GET /api/health</code><span>contract health</span></a>
          <a href="/api/rounds?latest=1&limit=20" target="_blank" rel="noreferrer"><code>GET /api/rounds</code><span>funding rounds</span></a>
          <a href="/api/proposals?round=1" target="_blank" rel="noreferrer"><code>GET /api/proposals</code><span>scores + evidence</span></a>
          <a href="/api/openapi" target="_blank" rel="noreferrer"><code>POST /api/preview</code><span>pre-submit check</span></a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('rounds');
  const [account, setAccount] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [oldestOffset, setOldestOffset] = useState(0);
  const [olderLoading, setOlderLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [claimableAtto, setClaimableAtto] = useState('0');
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [walletSelecting, setWalletSelecting] = useState(false);
  const walletObserverCleanup = useRef<(() => void) | null>(null);
  const pendingWallet = useRef<{
    promise: Promise<string>;
    resolve: (account: string) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const selectedRound = rounds.find((round) => round.roundId === selectedId) ?? rounds.at(-1) ?? null;

  const loadRounds = useCallback(async () => {
    const stamp = Date.now();
    const [healthResponse, roundsResponse] = await Promise.all([
      fetch(`/api/health?t=${stamp}`, { headers: { Accept: 'application/json' } }),
      fetch(`/api/rounds?latest=1&limit=20&t=${stamp}`, { headers: { Accept: 'application/json' } }),
    ]);
    if (!healthResponse.ok || !roundsResponse.ok) throw new Error('The StudioNet read service is temporarily unavailable.');
    const healthData = await healthResponse.json() as HealthResponse;
    const roundsData = await roundsResponse.json() as { rounds: RoundRecord[]; offset: number };
    setHealth(healthData);
    setRounds(roundsData.rounds);
    setOldestOffset(roundsData.offset);
    setSelectedId((current) => roundsData.rounds.some((round) => round.roundId === current)
      ? current : roundsData.rounds.at(-1)?.roundId || '');
  }, []);

  async function loadOlderRounds() {
    if (olderLoading || oldestOffset <= 0) return;
    setOlderLoading(true);
    try {
      const offset = Math.max(0, oldestOffset - 20);
      const limit = oldestOffset - offset;
      const response = await fetch(`/api/rounds?offset=${offset}&limit=${limit}&t=${Date.now()}`);
      if (!response.ok) throw new Error('Could not load older rounds.');
      const data = await response.json() as { rounds: RoundRecord[] };
      setRounds((current) => [...data.rounds, ...current]);
      setOldestOffset(offset);
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setOlderLoading(false);
    }
  }

  const loadProposals = useCallback(async (roundId: string) => {
    if (!roundId) return setProposals([]);
    const response = await fetch(`/api/proposals?round=${roundId}&t=${Date.now()}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Could not load this round’s proposals.');
    const data = await response.json() as { proposals: ProposalRecord[] };
    setProposals(data.proposals);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRounds().catch((error) => setNotice(errorNotice(error))).finally(() => setLoading(false));
  }, [loadRounds]);

  useEffect(() => {
    if (!selectedRound) return setProposals([]);
    loadProposals(selectedRound.roundId).catch((error) => setNotice(errorNotice(error)));
  }, [selectedRound?.roundId, loadProposals]);

  useEffect(() => () => walletObserverCleanup.current?.(), []);

  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setClaimableAtto('0');
      return;
    }
    setClaimableAtto('0');
    import('./lib/genlayer')
      .then(({ readClaimable }) => readClaimable(account))
      .then((amount) => { if (!cancelled) setClaimableAtto(amount); })
      .catch(() => { if (!cancelled) setClaimableAtto('0'); });
    return () => { cancelled = true; };
  }, [account, rounds]);

  const connect = useCallback(async () => {
    try {
      if (pendingWallet.current) return pendingWallet.current.promise;
      const { discoverWallets } = await import('./lib/genlayer');
      const wallets = await discoverWallets();
      if (wallets.length === 0) {
        throw new Error('No compatible EVM wallet found here. Open GrantArena in a browser with a wallet extension.');
      }
      setWalletOptions(wallets);
      setWalletPickerOpen(true);
      let resolve!: (account: string) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<string>((onSuccess, onError) => {
        resolve = onSuccess;
        reject = onError;
      });
      pendingWallet.current = { promise, resolve, reject };
      return promise;
    } catch (error) {
      setNotice({ tone: 'bad', text: walletConnectionErrorText(error) });
      throw error;
    }
  }, []);

  async function chooseWallet(option: WalletOption) {
    if (walletSelecting) return;
    setWalletSelecting(true);
    try {
      const { connectWallet, observeWallet } = await import('./lib/genlayer');
      const connected = await connectWallet(option);
      walletObserverCleanup.current?.();
      walletObserverCleanup.current = observeWallet(
        (next) => {
          setAccount(next);
          setNotice(next
            ? { tone: 'info', text: `Wallet changed to ${shortAddress(next)}. Confirm this account before signing.` }
            : { tone: 'info', text: 'Wallet disconnected. Connect again to sign a transaction.' });
        },
        (isStudionet) => {
          setAccount('');
          setNotice({
            tone: 'info',
            text: isStudionet
              ? 'Wallet network changed. Reconnect to confirm your account.'
              : 'Wallet moved off GenLayer StudioNet. Reconnect to switch back.',
          });
        },
      );
      setAccount(connected);
      setNotice({ tone: 'good', text: `Connected ${option.name} (${shortAddress(connected)}) on GenLayer StudioNet.` });
      pendingWallet.current?.resolve(connected);
      pendingWallet.current = null;
      setWalletPickerOpen(false);
    } catch (error) {
      setNotice({ tone: 'bad', text: walletConnectionErrorText(error) });
      pendingWallet.current?.reject(error instanceof Error ? error : new Error(walletConnectionErrorText(error)));
      pendingWallet.current = null;
      setWalletPickerOpen(false);
    } finally {
      setWalletSelecting(false);
    }
  }

  function closeWalletPicker() {
    if (walletSelecting) return;
    setWalletPickerOpen(false);
    pendingWallet.current?.reject(new Error('Wallet selection cancelled.'));
    pendingWallet.current = null;
  }

  const stats = useMemo(() => ({
    rounds: health?.contract?.roundCount ?? String(rounds.length),
    proposals: health?.contract?.proposalCount ?? String(rounds.reduce((sum, round) => sum + round.proposalCount, 0)),
    open: rounds.filter((round) => round.status === 'OPEN' && Number(round.submissionDeadline) * 1_000 > Date.now()).length,
  }), [health, rounds]);

  async function refresh(round?: RoundRecord) {
    await loadRounds();
    if (round) {
      setSelectedId(round.roundId);
      await loadProposals(round.roundId);
    }
  }

  async function runFinalize() {
    if (!selectedRound) return;
    try {
      const connected = account || await connect();
      setActionBusy(true);
      let hash = '';
      const { finalizeRound } = await import('./lib/genlayer');
      await finalizeRound(connected, BigInt(selectedRound.roundId), (value) => {
        hash = value;
        setNotice({ tone: 'info', text: 'Finalization submitted. Waiting for consensus…', hash: value });
      });
      await refresh(selectedRound);
      setNotice({ tone: 'good', text: 'Round finalized. Eligible awards were credited; unallocated funds were returned to the creator.', hash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function runContest(proposal: ProposalRecord) {
    const addendum = window.prompt('Add new evidence or context (80–2,000 characters). Previously submitted text is not accepted.');
    if (!addendum) return;
    try {
      const connected = account || await connect();
      setActionBusy(true);
      let hash = '';
      const { contestProposal } = await import('./lib/genlayer');
      await contestProposal(connected, BigInt(proposal.proposalId), addendum, (value) => {
        hash = value;
        setNotice({ tone: 'info', text: 'Contest submitted. Validators are reassessing it…', hash: value });
      });
      if (selectedRound) await refresh(selectedRound);
      setNotice({ tone: 'good', text: 'Contest finalized and the proposal record is updated.', hash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function runAttest(proposal: ProposalRecord) {
    if (!selectedRound) return;
    const note = window.prompt('Only attest after independently checking this proposal and its evidence links. Explain what you checked (40–600 ASCII characters).');
    if (note === null) return;
    try {
      requireContractText(note, 'Reviewer note', 40, 600);
      const connected = account || await connect();
      if (connected.toLowerCase() !== selectedRound.reviewer.toLowerCase()) throw new Error('Connect the named reviewer wallet to attest.');
      setActionBusy(true);
      let hash = '';
      const { attestProposal } = await import('./lib/genlayer');
      await attestProposal(connected, BigInt(proposal.proposalId), proposal.evidenceDigest, note.trim(), (value) => {
        hash = value;
        setNotice({ tone: 'info', text: 'Attestation submitted. Waiting for finality…', hash: value });
      });
      await refresh(selectedRound);
      setNotice({ tone: 'good', text: 'This exact proposal version is attested for payout eligibility.', hash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function runRevoke(proposal: ProposalRecord) {
    if (!selectedRound) return;
    try {
      const connected = account || await connect();
      if (connected.toLowerCase() !== selectedRound.reviewer.toLowerCase()) throw new Error('Connect the named reviewer wallet to revoke.');
      setActionBusy(true);
      let hash = '';
      const { revokeAttestation } = await import('./lib/genlayer');
      await revokeAttestation(connected, BigInt(proposal.proposalId), (value) => {
        hash = value;
        setNotice({ tone: 'info', text: 'Revocation submitted. Waiting for finality…', hash: value });
      });
      await refresh(selectedRound);
      setNotice({ tone: 'good', text: 'Attestation revoked; this proposal is no longer payout-eligible.', hash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function runWithdraw() {
    try {
      const connected = account || await connect();
      setActionBusy(true);
      let hash = '';
      const { withdraw } = await import('./lib/genlayer');
      await withdraw(connected, (value) => {
        hash = value;
        setNotice({ tone: 'info', text: 'Withdrawal queued. Waiting for finality…', hash: value });
      });
      setClaimableAtto('0');
      setNotice({ tone: 'info', text: 'Withdrawal request finalized. The external GEN transfer is queued; recipient credit has not been independently confirmed.', hash });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" onClick={() => setView('rounds')} aria-label="GrantArena home"><img src="/mark.svg" alt="" /><span>GrantArena</span><em>on GenLayer</em></a>
        <nav aria-label="Main navigation">
          <button className={view === 'rounds' ? 'active' : ''} onClick={() => setView('rounds')}>Rounds</button>
          <button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}>Create</button>
          <button className={view === 'apply' ? 'active' : ''} onClick={() => setView('apply')}>Apply</button>
          <button className={view === 'agents' ? 'active' : ''} onClick={() => setView('agents')}>For agents</button>
        </nav>
        <button className="wallet-button" onClick={() => void connect().catch(() => undefined)}><i className={account ? 'connected' : ''} />{account ? shortAddress(account) : 'Connect wallet'}</button>
      </header>

      {walletPickerOpen && (
        <div className="wallet-picker-backdrop" onClick={closeWalletPicker}>
          <div className="wallet-picker" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title" onClick={(event) => event.stopPropagation()}>
            <button className="wallet-picker-close" type="button" onClick={closeWalletPicker} aria-label="Close wallet choices" disabled={walletSelecting}>×</button>
            <span className="eyebrow">Connect your wallet</span>
            <h2 id="wallet-picker-title">Choose a browser wallet.</h2>
            <p>GrantArena found these compatible EVM wallets. Choose the one you want to use on GenLayer StudioNet.</p>
            <div className="wallet-picker-options">
              {walletOptions.map((option) => (
                <button type="button" key={option.id} onClick={() => void chooseWallet(option)} disabled={walletSelecting}>
                  <span className="wallet-picker-mark" aria-hidden="true">{option.name.slice(0, 1).toUpperCase()}</span>
                  <span>{option.name}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <small>Only approve a connection request in the wallet you selected. No transaction is sent just by connecting.</small>
          </div>
        </div>
      )}

      <main id="top">
        <div className="global-notice"><NoticeBar notice={notice} onClose={() => setNotice(null)} /></div>
        <section className="hero">
          <div className="hero-copy">
            <div className="live-chip"><i /> Live on StudioNet <span>·</span> public contract</div>
            <h1>Better grants,<br /><em>decided in public.</em></h1>
            <p>Set a weighted rubric. AI validators score proposals, a named reviewer checks evidence for funded rounds, and the contract settles eligible awards.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => setView('create')}>Launch a round <span>↗</span></button>
              <button className="outline-button" onClick={() => setView('apply')}>Submit a proposal</button>
            </div>
            <div className="hero-proof">
              <span><b>{stats.rounds}</b> public rounds</span><span><b>{stats.proposals}</b> scored proposals</span><span><b>{stats.open}</b> open in view</span>
            </div>
          </div>
          <div className="hero-visual" aria-label="Grant evaluation flow illustration">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="floating-card rubric-card"><span>01 · rubric</span><strong>Public impact</strong><div><i style={{ width: '55%' }} /><b>55%</b></div><strong>Delivery confidence</strong><div><i style={{ width: '45%' }} /><b>45%</b></div></div>
            <div className="floating-card validator-card"><span>validator quorum</span><div className="validator-faces"><i>V1</i><i>V2</i><i>V3</i><i>V4</i><i>V5</i></div><strong>Consensus reached</strong><small>MAJORITY_AGREE</small></div>
            <div className="floating-card score-card"><span>proposal 02</span><strong>75</strong><small>/ 100</small><em>qualified</em></div>
            <div className="sun-shape"><span>✦</span></div>
          </div>
        </section>

        <section className="trust-ribbon" aria-label="Product guarantees">
          <span>◇ Weighted criteria</span><span>✦ Multi-validator review</span><span>✓ Signed evidence check</span><span>◎ Public audit trail</span>
        </section>

        <section className="workspace" id="workspace">
          <div className="section-heading">
            <div><span className="eyebrow">{view === 'rounds' ? 'Live arena' : view === 'create' ? 'Round builder' : view === 'apply' ? 'Proposal desk' : 'Agent access'}</span><h2>{view === 'rounds' ? 'See every decision.' : view === 'create' ? 'Design a fair grant round.' : view === 'apply' ? 'Make your case, criterion by criterion.' : 'One public API. No secret key.'}</h2></div>
            {view === 'rounds' && <button className="refresh-button" disabled={loading} onClick={() => void refresh()}>↻ {loading ? 'Loading' : 'Refresh'}</button>}
          </div>
          {view === 'rounds' && (
            <div className="round-layout">
              <aside className="round-list" aria-label="Grant rounds">
                {loading && rounds.length === 0 && <div className="loading-card"><i /><span>Reading finalized state…</span></div>}
                {!loading && rounds.length === 0 && <div className="empty-state"><span>○</span><h3>The arena is ready</h3><p>Create the first public grant round.</p><button className="primary-button compact" onClick={() => setView('create')}>Create round</button></div>}
                {[...rounds].reverse().map((round) => (
                  <button className={`round-list-card ${selectedRound?.roundId === round.roundId ? 'selected' : ''}`} key={round.roundId} onClick={() => setSelectedId(round.roundId)}>
                    <div><span>Round {round.roundId.padStart(2, '0')}</span><StatusPill status={round.status} /></div>
                    <h3>{round.title}</h3><p>{round.mission}</p>
                    <footer><span>{round.proposalCount} proposals</span><span>{formatGen(round.poolAtto)} GEN</span></footer>
                  </button>
                ))}
                {oldestOffset > 0 && <button className="outline-button compact load-older-button" disabled={olderLoading} onClick={() => void loadOlderRounds()}>{olderLoading ? 'Loading older rounds…' : 'Load older rounds'}</button>}
              </aside>
              <div className="round-detail">
                {selectedRound ? (
                  <>
                    <div className="round-detail-top">
                      <div><span className="round-number">ROUND / {selectedRound.roundId.padStart(2, '0')}</span><h3>{selectedRound.title}</h3><p>{selectedRound.mission}</p></div>
                      <div className="round-pool"><span>{BigInt(selectedRound.poolAtto) > 0n ? selectedRound.status === 'OPEN' ? 'Prize pool' : 'Original pool' : 'Mode'}</span><strong>{BigInt(selectedRound.poolAtto) > 0n ? `${formatGen(selectedRound.poolAtto)} GEN` : 'Decision only'}</strong><small>{selectedRound.status === 'CANCELLED' ? 'Credited back to creator' : `${selectedRound.winnerCount} winner${selectedRound.winnerCount === 1 ? '' : 's'} · minimum ${selectedRound.minimumScore}`}</small></div>
                    </div>
                    <div className="round-timeline"><div><i className="done" /><span>Created<b>{formatDate(selectedRound.createdAt)}</b></span></div><div><i className={Date.now() >= Number(selectedRound.submissionDeadline) * 1000 || selectedRound.status !== 'OPEN' ? 'done' : 'current'} /><span>Submissions close<b>{formatDate(selectedRound.submissionDeadline)}</b></span></div><div><i className={selectedRound.status !== 'OPEN' ? 'done' : ''} /><span>{selectedRound.status === 'CANCELLED' ? 'Cancelled' : selectedRound.status === 'FINALIZED' ? 'Finalized' : 'Finalizable after'}<b>{formatDate(selectedRound.status === 'OPEN' ? selectedRound.appealDeadline : selectedRound.finalizedAt)}</b></span></div></div>
                    {BigInt(selectedRound.poolAtto) > 0n && <p className="reviewer-line"><b>Evidence reviewer:</b> {shortAddress(selectedRound.reviewer)} · Only qualified proposals attested by this wallet can receive an award. A signature does not prove reviewer independence.</p>}
                    <div className="rubric-view"><div className="subhead"><h4>Published rubric</h4><span>weights total 100</span></div>{selectedRound.criteria.map((criterion) => <div className="rubric-row" key={criterion.id}><span>{criterion.weight}</span><div><b>{criterion.label}</b><p>{criterion.description}</p></div></div>)}</div>
                    <div className="subhead proposal-heading"><h4>Proposal scoreboard</h4><span>{proposals.length} received · {selectedRound.qualifiedCount} qualified</span></div>
                    <div className="proposal-list">{proposals.length > 0 ? [...proposals].sort((a, b) => b.weightedScore - a.weightedScore).map((proposal) => <div key={proposal.proposalId}><ProposalCard proposal={proposal} round={selectedRound} />{account && account.toLowerCase() === proposal.proposer.toLowerCase() && !proposal.contestUsed && selectedRound.status === 'OPEN' && Number(selectedRound.appealDeadline) * 1000 > Date.now() && <button className="text-button proposal-action" disabled={actionBusy} onClick={() => void runContest(proposal)}>Contest with new material →</button>}{account && account.toLowerCase() === selectedRound.reviewer.toLowerCase() && selectedRound.status === 'OPEN' && BigInt(selectedRound.poolAtto) > 0n && proposal.status === 'QUALIFIED' && (proposal.attestedAt === '0' ? <button className="text-button proposal-action" disabled={actionBusy} onClick={() => void runAttest(proposal)}>Review and attest this version →</button> : <button className="text-button proposal-action" disabled={actionBusy} onClick={() => void runRevoke(proposal)}>Revoke attestation →</button>)}</div>) : <div className="empty-proposals"><span>✦</span><h4>{selectedRound.status === 'CANCELLED' ? 'This round was cancelled without proposals.' : selectedRound.status === 'FINALIZED' || Number(selectedRound.submissionDeadline) * 1000 <= Date.now() ? 'No proposals were submitted.' : 'The first proposal could be yours.'}</h4>{selectedRound.status === 'OPEN' && Number(selectedRound.submissionDeadline) * 1000 > Date.now() && <button className="outline-button compact" onClick={() => setView('apply')}>Apply to this round</button>}</div>}</div>
                    <div className="round-actions"><button className="primary-button compact" onClick={() => setView('apply')} disabled={selectedRound.status !== 'OPEN' || Number(selectedRound.submissionDeadline) * 1000 <= Date.now()}>Apply to round</button>{selectedRound.status === 'OPEN' && Number(selectedRound.appealDeadline) * 1000 <= Date.now() && <button className="outline-button compact" disabled={actionBusy} onClick={() => void runFinalize()}>Finalize ranking</button>}{account && BigInt(claimableAtto) > 0n && <button className="text-button" disabled={actionBusy} onClick={() => void runWithdraw()}>Withdraw {formatGen(claimableAtto)} GEN</button>}</div>
                  </>
                ) : <div className="empty-state"><span>○</span><h3>Select a round</h3></div>}
              </div>
            </div>
          )}
          {view === 'create' && <CreateRoundForm account={account} onNeedWallet={connect} onComplete={async () => { await refresh(); setView('rounds'); }} />}
          {view === 'apply' && <ProposalForm rounds={rounds} initialRound={selectedRound} account={account} onNeedWallet={connect} onComplete={async (round) => { await refresh(round); }} />}
          {view === 'agents' && <AgentPanel />}
        </section>

        <section className="how-it-works">
          <div className="section-heading"><div><span className="eyebrow">First time here?</span><h2>From idea to accountable award.</h2></div><p>Three steps. Every important rule is visible before anyone submits.</p></div>
          <div className="steps-grid">
            <article><span>01</span><div className="step-icon">◎</div><h3>Publish the rules</h3><p>A funder sets the mission, rubric, weights, deadline, winners, and payout split.</p></article>
            <article><span>02</span><div className="step-icon coral">✦</div><h3>Score and check evidence</h3><p>AI validators agree on rubric grades. For funded rounds, a separate named wallet must attest to the exact proposal version.</p></article>
            <article><span>03</span><div className="step-icon yellow">↗</div><h3>Settle deterministically</h3><p>The contract ranks eligible proposals, credits awards, and returns unallocated funds to the creator.</p></article>
          </div>
        </section>

        <section className="proof-section">
          <div><span className="eyebrow light">Built to verify</span><h2>Trust the record,<br />not a black box.</h2><p>The deployed source, transaction history, rubric, scores, and outcomes are publicly inspectable.</p><div className="proof-links"><a href={explorerContract()} target="_blank" rel="noreferrer">View live contract ↗</a><a href={explorerTransaction(DEPLOYMENT_TRANSACTION)} target="_blank" rel="noreferrer">Deployment proof ↗</a></div></div>
          <div className="ledger-card"><div className="ledger-head"><span>FINALIZED RECORD</span><i>✓</i></div><dl><div><dt>Network</dt><dd>GenLayer StudioNet</dd></div><div><dt>Contract</dt><dd>{shortAddress(STUDIONET_CONTRACT_ADDRESS)}</dd></div><div><dt>Version</dt><dd>{health?.contract?.version ?? 'grantarena/v2'}</dd></div><div><dt>Settlement</dt><dd>Deterministic integer math</dd></div><div><dt>Validator result</dt><dd>Public on-chain</dd></div></dl></div>
        </section>
      </main>

      <footer className="site-footer"><a className="brand footer-brand" href="#top"><img src="/mark.svg" alt="" /><span>GrantArena</span></a><p>Fairer funding, one transparent decision at a time.</p><div><a href="/api/openapi" target="_blank" rel="noreferrer">API</a><a href={explorerContract()} target="_blank" rel="noreferrer">Contract</a><span>MIT · 2026</span></div></footer>
    </div>
  );
}
