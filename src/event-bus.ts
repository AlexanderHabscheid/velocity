export interface VelocityEventBus {
  publish: (topic: string, payload: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
}

export class NoopEventBus implements VelocityEventBus {
  async publish(): Promise<void> {
    // intentionally no-op
  }

  async close(): Promise<void> {
    // intentionally no-op
  }
}

export class NatsEventBus implements VelocityEventBus {
  private constructor(
    private readonly nc: any,
    private readonly subjectPrefix: string,
  ) {}

  static async create(url: string, subjectPrefix: string): Promise<NatsEventBus> {
    let natsModule: any;
    try {
      natsModule = await import("nats");
    } catch {
      throw new Error("NATS configured but 'nats' package is not installed. Install it with: npm install nats");
    }
    const nc = await natsModule.connect({ servers: url });
    return new NatsEventBus(nc, subjectPrefix.replace(/\.$/, ""));
  }

  async publish(topic: string, payload: Record<string, unknown>): Promise<void> {
    const subject = `${this.subjectPrefix}.${topic}`;
    const body = JSON.stringify({ ...payload, ts: new Date().toISOString() });
    this.nc.publish(subject, new TextEncoder().encode(body));
  }

  async close(): Promise<void> {
    await this.nc.drain();
