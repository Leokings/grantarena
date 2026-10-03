import type { Criterion } from '../types';

export type PreviewInput = {
  criteria: Criterion[];
  answers: Record<string, string>;
};

export type PreviewResult = {
  valid: boolean;
  errors: string[];
  deterministicCaps: Array<{ id: string; maxScore: number; weight: number }>;
  maximumWeightedScore: number;
  note: string;
};

export function answerCap(answer: string): number {
  const words = answer.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const distinct = new Set(words);
  if (words.length === 0) return 0;
  if (words.length < 12 || distinct.size < 8) return 25;
  if (words.length < 25 || distinct.size < 16) return 50;
  return 100;
}

/** Match the contract's ASCII/control-character text boundary before a wallet signs. */
export function contractTextError(value: string, label: string, minimum: number, maximum: number): string | null {
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if (clean.length < minimum || clean.length > maximum) {
    return `${label} must contain ${minimum}–${maximum} characters.`;
  }
  if (!/^[\x20-\x7E\n]*$/.test(clean)) {
    return `${label} must use plain ASCII text without tabs or control characters.`;
  }
  return null;
}

export function previewProposal(input: PreviewInput): PreviewResult {
  const errors: string[] = [];
  if (!Array.isArray(input.criteria) || input.criteria.length < 2 || input.criteria.length > 6) {
    errors.push('Use between 2 and 6 criteria.');
  }
  const ids = new Set<string>();
  let totalWeight = 0;
  for (const criterion of input.criteria) {
    if (!/^[a-z0-9](?:[a-z0-9-]{2,46}[a-z0-9])?$/.test(criterion.id)) {
      errors.push(`Criterion ID “${criterion.id}” is invalid.`);
    }
    if (ids.has(criterion.id)) errors.push(`Criterion ID “${criterion.id}” is duplicated.`);
    ids.add(criterion.id);
    if (!Number.isInteger(criterion.weight) || criterion.weight < 5 || criterion.weight > 80) {
      errors.push(`Weight for “${criterion.id}” must be an integer from 5 to 80.`);
    }
    totalWeight += criterion.weight;
    const answer = input.answers[criterion.id];
    if (typeof answer !== 'string') errors.push(`Answer for “${criterion.id}” is missing.`);
    if (typeof answer === 'string') {
      const textError = contractTextError(answer, `Answer for “${criterion.id}”`, 0, 1_800);
      if (textError) errors.push(textError);
    }
  }
  if (totalWeight !== 100) errors.push('Criterion weights must total 100.');
  const extraAnswers = Object.keys(input.answers).filter((id) => !ids.has(id));
  if (extraAnswers.length > 0) errors.push('Answers must exactly match the round criteria.');

  const deterministicCaps = input.criteria.map((criterion) => ({
    id: criterion.id,
    maxScore: answerCap(input.answers[criterion.id] ?? ''),
    weight: criterion.weight,
  }));
  const maximumWeightedScore = Math.floor(
    deterministicCaps.reduce((total, item) => total + item.maxScore * item.weight, 0) / 100,
  );
  return {
    valid: errors.length === 0,
    errors,
    deterministicCaps,
    maximumWeightedScore,
    note: 'This is a deterministic completeness check, not the validator consensus score.',
  };
}
