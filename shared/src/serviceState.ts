export type ServiceState = "STARTING" | "READY" | "DEGRADED" | "ERROR";

export interface ServiceStateSnapshot {
  state: ServiceState;
  reason?: string;
  since: string;
}

export class ServiceStateTracker {
  private state: ServiceState;
  private reason?: string;
  private since: Date;

  constructor(initialState: ServiceState = "STARTING") {
    this.state = initialState;
    this.since = new Date();
  }

  setState(state: ServiceState, reason?: string): void {
    if (this.state === state && this.reason === reason) {
      return;
    }
    this.state = state;
    this.reason = reason;
    this.since = new Date();
  }

  getSnapshot(): ServiceStateSnapshot {
    return {
      state: this.state,
      reason: this.reason,
      since: this.since.toISOString()
    };
  }
}
