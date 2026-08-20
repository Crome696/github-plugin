export const GATE_TTL_MS: number;
export const MAX_FUTURE_SKEW_MS: number;
export const CANONICAL_STATE_RELATIVE_PATH: string;

export function canonicalStatePath(repositoryRoot: string, fileName: string): string;

export function claimGate(
  repositoryRoot: string,
  fileName: string,
  expectedOperation: string,
  now?: number,
): {
  gate: Record<string, unknown> | null;
  lifecycle?: Record<string, unknown>;
  error: string | null;
  migration: { found: string[]; quarantined: string[]; errors: string[] };
  abandoned: { removed: string[]; errors: string[] };
};

export function cleanupAbandonedState(
  repositoryRoot: string,
  now?: number,
): { removed: string[]; errors: string[] };

export function consumePostMergeReceipt(
  repositoryRoot: string,
  now?: number,
): {
  receipt: Record<string, any> | null;
  available: boolean;
  error: string | null;
};

export function createPreMergeReceipt(
  repositoryRoot: string,
  gate: Record<string, unknown> | null,
  now?: number,
): { ok: boolean; path?: string; error?: string };

export function validateGateLifecycle(
  lifecycle: Record<string, unknown>,
  expectedOperation?: string,
  now?: number,
): { ok: boolean; error?: string };

export function writeGate(
  repositoryRoot: string,
  fileName: string,
  gate: Record<string, unknown>,
  now?: number,
): string;
