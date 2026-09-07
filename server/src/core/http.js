// Shared helper for signalling HTTP-meaningful failures from the service layer.
//
// Services own all SQL and all domain rules, so they are the layer that discovers
// "not found", "already exists", "insufficient inventory" and friends. They throw an
// Error carrying a `.status`; the route reads `.status` and shapes the response.
// Errors without a `.status` are unexpected (a real bug or a DB outage) and are left
// for the route to deal with.

export function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}
