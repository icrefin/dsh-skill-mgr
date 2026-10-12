/**
 * The sidebar row glyph for the skill manager.
 *
 * The platform's own skill outline artwork (17×17 viewBox, 1.3 px stroke) so
 * the row matches the icons the shell draws for every other panel, painted in
 * `currentColor` so the sidebar's active/idle colors apply.
 *
 * @module dsh-skill-mgr/client/SkillMgrPanelIcon
 */

import type { ReactElement } from 'react'

/** Props the sidebar hands its panel rows. */
export interface SkillMgrPanelIconProps {
  /** Requested square edge in pixels (16 in the expanded column, 18 in the rail). */
  size: number
  /** Whether this panel is the selected main panel. */
  active: boolean
}

/**
 * Render the skill-manager glyph.
 * @param props - requested size and selection state.
 * @returns the inline SVG icon.
 */
export function SkillMgrPanelIcon({ size, active }: SkillMgrPanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      strokeWidth={active ? 1.5 : 1.3}
      style={{ flex: 'none' }}
    >
      <path d="M4.578 5.771h6.125" stroke="currentColor" />
      <path d="M4.578 8.898h3.341" stroke="currentColor" />
      <path
        d="M12.14 1.194c.804 0 1.5.626 1.5 1.45v6.254h-1V2.645c0-.225-.199-.45-.5-.45h-9c-.3 0-.5.225-.5.45v10.448c0 .224.2.449.5.449h5.742v1H3.14c-.803 0-1.5-.625-1.5-1.45V2.646c0-.825.697-1.45 1.5-1.45h9Z"
        fill="currentColor"
      />
      <path
        d="M12.005 15.106a2.655 2.655 0 0 0-2.654-2.655 2.655 2.655 0 0 0 2.654-2.654 2.655 2.655 0 0 0 2.655 2.654 2.655 2.655 0 0 0-2.655 2.655Z"
        stroke="currentColor"
      />
    </svg>
  )
}
