// Pure audience derivation. Callers must supply manager UUIDs from an authorized
// project-scoped query/RPC; this module never opens an admin client or queries profiles.
export function tourRecipientUserIds(tour, managerUserIds = [], { exclude = [] } = {}) {
  const recipients = new Set([
    tour?.host_user_id,
    tour?.guide_user_id,
    ...(Array.isArray(tour?.assigned_user_ids) ? tour.assigned_user_ids : []),
    ...managerUserIds,
  ].filter(Boolean));
  for (const userId of exclude) recipients.delete(userId);
  return [...recipients];
}
