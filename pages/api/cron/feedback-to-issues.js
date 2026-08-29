// Task 14 owns external issue forwarding. Until that gate is explicitly
// authorized, this endpoint is intentionally fail closed and performs no reads,
// writes, token handling, or network calls.
export default function feedbackForwardingDisabled(_req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  return res.status(503).json({
    error: {
      code: 'FEATURE_DISABLED',
      message: 'Feedback forwarding is not enabled',
    },
  });
}
