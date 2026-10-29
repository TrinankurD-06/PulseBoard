// Deterministic helpers for "Import from GitHub": no network, no AI. Pure
// functions that pull candidate URLs out of repo metadata and READMEs, then
// normalise, dedupe, rank and classify them. Browser-safe (no Node imports).
export * from './candidates.js';
export * from './extract.js';
