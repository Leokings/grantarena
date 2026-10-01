import { describe, expect, it } from 'vitest';
import { chooseAvailableRoundId } from './round-selection';

describe('proposal round selection', () => {
  const open = [{ roundId: '1' }, { roundId: '2' }];

  it('falls back to the first open round when the selected round was cancelled', () => {
    expect(chooseAvailableRoundId(open, '3')).toBe('1');
  });

  it('keeps a valid open round selection', () => {
    expect(chooseAvailableRoundId(open, '2')).toBe('2');
    expect(chooseAvailableRoundId([], '2')).toBe('');
  });
});
