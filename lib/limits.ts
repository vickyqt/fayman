/**
 * Request size limits shared by the API schemas (server) and the UI (client),
 * so the browser never builds a request the server will reject.
 */
export const LIMITS = {
  topic: 120,
  /** Uploaded syllabus files sent with each request. */
  uploads: 10,
  uploadChars: 200_000,
  /** Teach-back messages kept as context (older ones are dropped, statuses persist). */
  transcript: 80,
  message: 4000,
  diagnosticWhy: 1000,
  complaint: 1000,
  instruction: 1200,
} as const;
