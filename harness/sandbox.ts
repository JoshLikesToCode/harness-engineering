import vm from "node:vm";

export type SandboxResult =
  | { ok: true; result: unknown; logs: string[] }
  | { ok: false; error: string; logs: string[] };

export type SandboxApi = Record<string, (...args: any[]) => unknown>;

export async function runInSandbox(
  code: string,
  api: SandboxApi,
  opts: { timeoutMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? 1000;
  const logs: string[] = [];
  const context = vm.createContext({
    tools: api,
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      },
    },
  });
  // allows agent to run in async
  const wrapped = `(async () => { ${code} })()`;
  // run code in sandbox
  try {
    const pending = vm.runInContext(wrapped, context, { timeout: timeoutMs });
    const result = await withTimeout(pending, timeoutMs);
    return {ok: true, result, logs}
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`execution timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}