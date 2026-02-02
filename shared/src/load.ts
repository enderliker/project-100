import os from "os";

export interface LoadMetrics {
  load1: number;
  load5: number;
  load15: number;
  rssBytes: number;
  heapUsedBytes: number;
}

export function getLoadMetrics(): LoadMetrics {
  const [load1, load5, load15] = os.loadavg();
  const memory = process.memoryUsage();
  return {
    load1,
    load5,
    load15,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed
  };
}
