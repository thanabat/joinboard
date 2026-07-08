export function displayName(user: { nickname?: string | null; email: string }) {
  return user.nickname?.trim() || user.email;
}
