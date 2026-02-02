export type ShutdownHandler = () => Promise<void> | void;

export function registerGracefulShutdown(handlers: ShutdownHandler[]): void {
  let shuttingDown = false;

  const handleSignal = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const handler of handlers) {
      try {
        await Promise.resolve(handler());
      } catch (error) {
        console.error(`Shutdown handler error after ${signal}`);
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });
}
