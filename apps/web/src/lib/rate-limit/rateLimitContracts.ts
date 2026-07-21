// FILE: rateLimitContracts.ts
// Purpose: Shared rate-limit data contracts for normalization and presentation.
// Layer: Web rate-limit contracts

export interface RateLimitWindow {
  window: string;
  usedPercent?: number;
  utilization?: number;
  resetsAt?: string;
  windowDurationMins?: number;
}

export interface ProviderRateLimit {
  provider: string;
  updatedAt: string;
  limits?: RateLimitWindow[];
  usedPercent?: number;
  utilization?: number;
  resetsAt?: string;
  windowDurationMins?: number;
  status?: string;
}

export interface VisibleRateLimitRow {
  id: string;
  label: string;
  remainingPercent: number;
  resetsAt?: string;
  windowDurationMins?: number;
}
