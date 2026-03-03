interface BreakerConfig {
  threshold: number;
  windowMs: number;
  cooldownMs: number;
}

interface TenantState {
  breaches: number[];
  openUntil: number;
}

export class TenantCircuitBreakerRegistry {
  private readonly config: BreakerConfig;
  private readonly states = new Map<string, TenantState>();

  constructor(config: BreakerConfig) {
    this.config = config;
  }

  isOpen(tenantId: string): boolean {
    const state = this.states.get(tenantId);
    return !!state && Date.now() < state.openUntil;
  }

  recordBreach(tenantId: string): { opened: boolean; openUntil?: number } {
    const now = Date.now();
    const state = this.states.get(tenantId) ?? { breaches: [], openUntil: 0 };
    state.breaches.push(now);
    state.breaches = state.breaches.filter((ts) => now - ts <= this.config.windowMs);

    const wasOpen = now < state.openUntil;
    if (state.breaches.length >= this.config.threshold) {
      state.openUntil = now + this.config.cooldownMs;
    }

    this.states.set(tenantId, state);
    const isOpen = now < state.openUntil;
    return { opened: !wasOpen && isOpen, openUntil: isOpen ? state.openUntil : undefined };
  }
}
