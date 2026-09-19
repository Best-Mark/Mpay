import { AsyncLocalStorage } from 'async_hooks';

interface TraceStore {
  traceId: string;
  appId?: string;
  operator?: string;
}

/**
 * 链路追踪上下文（轻量级实现，无需引入 OpenTelemetry）
 * 每个请求生成 traceId，贯穿日志、通知、对账任务
 */
export class TraceContext {
  private static readonly als = new AsyncLocalStorage<TraceStore>();

  static run<T>(store: TraceStore, fn: () => T): T {
    return TraceContext.als.run(store, fn);
  }

  static get(): TraceStore | undefined {
    return TraceContext.als.getStore();
  }

  static getTraceId(): string | undefined {
    return TraceContext.als.getStore()?.traceId;
  }

  static set(patch: Partial<TraceStore>): void {
    const cur = TraceContext.als.getStore();
    if (cur) Object.assign(cur, patch);
  }
}
