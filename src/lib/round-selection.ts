/** Prefer an available round; never keep a cancelled/closed selection in the form. */
export function chooseAvailableRoundId(rounds: Array<{ roundId: string }>, preferred = ''): string {
  return rounds.some((round) => round.roundId === preferred)
    ? preferred : rounds[0]?.roundId ?? '';
}
