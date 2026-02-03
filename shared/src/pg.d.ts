declare module "pg" {
  export interface PoolConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    max?: number;
    idleTimeoutMillis?: number;
    ssl?: { rejectUnauthorized: boolean; ca?: string };
  }

  export interface QueryConfig<T = unknown[]> {
    name?: string;
    text: string;
    values?: T;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T = unknown[]>(
      queryTextOrConfig: string | QueryConfig<T>,
      values?: T
    ): Promise<QueryResult>;
    end(): Promise<void>;
  }

  export interface QueryResult {
    rows: unknown[];
  }
}
