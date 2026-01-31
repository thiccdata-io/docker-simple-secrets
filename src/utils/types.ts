export interface Service {
  name: string;
  secrets: Secret[];
}

export interface Secret {
  name: string;
  path: string;
  hasChanges?: boolean;
  isDeployed?: boolean;
}

export interface RateLimitEntry {
  attempts: number;
  lastAttempt: number;
  blockedUntil?: number;
}

export interface DeployStats {
  deployed: number;
  updated: number;
  skipped: number;
  deleted: number;
}
