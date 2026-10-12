/**
 * hooks 共享层：域 hooks 之间传递的通知接口、状态机类型、轮询常量、
 * 每日自动检查 helpers。数据形状为 Remote 的 wire 类型（`src/wire.ts`）。
 *
 * 市场/来源/仓库子域随功能一起移除，因此这里只剩目录、工作区、统计与回收站
 * 四域共用的小工具。
 */

import { errorMessage } from '../../helpers.ts'

/**
 * 跨域共享的通知原语：聚合根用稳定的 setState setter 实现一次，
 * 各域 hooks 只调接口，不直接碰别人的 state。对象本身经 useMemo
 * 常驻，域回调的 useCallback 依赖它不会失稳。
 */
export interface FlowNotices {
  /** 报错条幅（覆盖旧报错）。 */
  fail: (message: string) => void
  /** 清掉报错条幅。 */
  clearFail: () => void
  /** 成功条幅（null = 清掉）。 */
  succeed: (message: string | null) => void
  /** 删除/恢复/选择等管家操作的忙碌开关（多域共用）。 */
  setOpBusy: (busy: boolean) => void
}

/**
 * 统一异步动作外壳：清错 → 执行 → 异常转错误条幅 → 收尾（忙碌开关）。
 * 只用于同形的 clearFail/try/catch/finally 站点；成功后清错、自定义收尾、
 * 需要返回值的站点保持内联。
 */
export async function runFlow<T>(shared: FlowNotices, body: () => Promise<T>, settle: () => void = () => {}): Promise<T | undefined> {
  shared.clearFail()
  try {
    return await body()
  } catch (error) {
    shared.fail(errorMessage(error))
    return undefined
  } finally {
    settle()
  }
}

/**
 * Catalog/统计补捞间隔：Remote 客户端缓存一份 snapshot，写操作各自刷新它，
 * 所以面板不再做秒级目录轮询——挂载、每次写、显式刷新按钮都会重读。
 */
export const USES_CATCH_UP_MS = 5000
/** Relaxed background refresh for slower-changing data (a snapshot per minute). */
export const SLOW_POLL_MS = 60_000
/** 空统计补捞上限：冷启动全量扫描（数十 MB 会话日志）可能超过 2 分钟，72 次约 6 分钟内保持 5 秒粒度，之后交回 60 秒慢轮询。 */
export const USES_CATCH_UP_MAX = 72

/** skillName → 调用次数/末次使用（统计域产出，目录排序消费）。 */
export type UsesMap = ReadonlyMap<string, { count: number; lastUsed?: number }>