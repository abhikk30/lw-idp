import type { SessionRecord } from "@lw-idp/auth";
import type { TokenBucket } from "./backpressure.js";

export interface Connection {
  id: number;
  session: SessionRecord;
  bucket: TokenBucket;
  send: (frameJson: string) => void;
  closedAt?: number;
}

export interface RegistryMetrics {
  totalConnections: number;
  totalUsers: number;
  sheddedTotal: number;
}

export class ConnectionRegistry {
  private nextId = 1;
  private readonly conns = new Map<number, Connection>();
  private shedded = 0;

  add(session: SessionRecord, bucket: TokenBucket, send: (frameJson: string) => void): Connection {
    const id = this.nextId++;
    const conn: Connection = { id, session, bucket, send };
    this.conns.set(id, conn);
    return conn;
  }

  remove(id: number): void {
    this.conns.delete(id);
  }

  all(): Connection[] {
    return [...this.conns.values()];
  }

  recordShed(): void {
    this.shedded += 1;
  }

  metrics(): RegistryMetrics {
    const uniqueUsers = new Set<string>();
    for (const c of this.conns.values()) {
      uniqueUsers.add(c.session.userId);
    }
    return {
      totalConnections: this.conns.size,
      totalUsers: uniqueUsers.size,
      sheddedTotal: this.shedded,
    };
  }
}
