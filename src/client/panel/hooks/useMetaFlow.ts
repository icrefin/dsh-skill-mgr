/**
 * useMetaFlow — 调用统计 + 面板配置：只依赖 api 与 panel-config 的实时设置
 * 视图，不碰其他域。补捞 effect 自包含（uses.size + loadUses）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkillMgrApi } from '../../api.ts'
import { usePanelConfig } from '../../panel-config.ts'
import { USES_CATCH_UP_MAX, USES_CATCH_UP_MS } from './shared.ts'

export function useMetaFlow(api: SkillMgrApi) {
  const [uses, setUses] = useState<ReadonlyMap<string, { count: number; lastUsed?: number }>>(new Map())
  /** 面板配置（圆点色、用量显示开关）：来自设置卡的实时作用域，永不为 null。 */
  const mgrConfig = usePanelConfig()

  const loadUses = useCallback(async (): Promise<void> => {
    try {
      const result = await api.stats()
      if (result.available) setUses(new Map(result.stats.map((stat) => [stat.name, { count: stat.count, ...(stat.lastUsed !== undefined ? { lastUsed: stat.lastUsed } : {}) }])))
    } catch {
      // Invocation counts are best-effort; a stats failure must not disturb the catalog.
    }
  }, [api])

  // 统计是 SWR：首刷可能命中服务端冷启动（回空数组、后台扫描中）。
  // 补捞轮询：空数时每 5 秒捞一次，有数即停（最多约 6 分钟，见 USES_CATCH_UP_MAX），之后交给 60 秒慢轮询。
  // 冷扫描要解压全部会话日志（数十 MB 级），固定一次补捞可能赶不上。
  // 注意：这不是目录轮询——目录由 Remote 的 snapshot 缓存供给，写操作各自刷新。
  const usesCatchUp = useRef(0)
  useEffect(() => {
    if (uses.size > 0 || usesCatchUp.current >= USES_CATCH_UP_MAX) return
    const timer = window.setInterval(() => {
      usesCatchUp.current += 1
      void loadUses()
      if (usesCatchUp.current >= USES_CATCH_UP_MAX) window.clearInterval(timer)
    }, USES_CATCH_UP_MS)
    return () => { window.clearInterval(timer) }
  }, [uses.size, loadUses])

  return { uses, loadUses, mgrConfig }
}