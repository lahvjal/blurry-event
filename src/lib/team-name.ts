export const TEAM_NAME_MAX_LENGTH = 50;

export function normalizeTeamName(value: string): string {
  return value.trim();
}

export function teamNameError(value: string): string | null {
  const name = normalizeTeamName(value);
  if (!name) return 'Enter a team name.';
  if (name.length > TEAM_NAME_MAX_LENGTH) {
    return `Use ${TEAM_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}
