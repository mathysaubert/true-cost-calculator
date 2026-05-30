// Re-export Sentry for use in loaders/actions.
// Initialization happens in instrument.server.mjs (imported first by entry.server.jsx).
export { captureException, captureMessage } from "@sentry/node";
