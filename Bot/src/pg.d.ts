declare module "pg" {
  export class Pool {
    end(): Promise<void>;
  }

  export interface QueryResult {
    rows: unknown[];
  }
}
