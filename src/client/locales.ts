/**
 *  locales 按视图拆分后的聚合入口：各域字典在 ./locales/<domain>.ts，
 *  这里合并为面板消费的 zh/en。老 `from './locales.ts'` 写法保持可用，
 *  MgrKey 的完备性仍由 `en: Record<MgrKey, string>` 在类型层兜底
 *  （缺键即编译报错）。命名空间是 `dsh-skill-mgr`。
 *
 *  市场与来源跟踪的字典随功能一起删除（locales/market.ts、locales/sources.ts），
 *  删除/回收站文案收在新的 locales/trash.ts。
 */

import { enCommon, zhCommon } from './locales/common.ts'
import { enDetail, zhDetail } from './locales/detail.ts'
import { enSettings, zhSettings } from './locales/settings.ts'
import { enSkills, zhSkills } from './locales/skills.ts'
import { enTrash, zhTrash } from './locales/trash.ts'

export const zh = {
  ...zhCommon,
  ...zhSkills,
  ...zhTrash,
  ...zhDetail,
  ...zhSettings,
} as const

/** Union of every translatable key (the namespace's registered dictionary type). */
export type MgrKey = keyof typeof zh

export const en: Record<MgrKey, string> = {
  ...enCommon,
  ...enSkills,
  ...enTrash,
  ...enDetail,
  ...enSettings,
}

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Interpolate a {name} template with the given values. */
export function t(dict: Record<string, string>, key: MgrKey, values?: TranslateValues): string {
  let text = dict[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll('{' + name + '}', String(value))
    }
  }
  return text
}