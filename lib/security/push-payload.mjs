export function toPushPayload(event = {}) {
  return Object.freeze({
    title: 'מקרבים',
    body: 'יש עדכון חדש במערכת',
    url: '/notifications',
    urgent: event.priority === 'high',
  });
}
