/**
 * Framework-free DOM mapping for the template's layout modes.
 *
 * Each mode drives `data-layout` (and optionally `dir`) on <html>, plus one
 * class on <body>. Everything else is handled by style.css.
 */

export type LayoutMode =
  | 'default'
  | 'mini'
  | 'hoverview'
  | 'hidden'
  | 'full-width'
  | 'rtl'
  | 'two-column'
  | 'horizontal'

interface ModeDom {
  dataLayout: string
  bodyClass: string
  dir?: string
}

/** Body classes owned by layout routing — always removed together on reset. */
// `full-width` is never set by a mode — the toggle button adds it on the
// full-width route — but it is cleared here so it cannot leak to the next page.
export const LAYOUT_BODY_CLASSES = ['mini-sidebar', 'hidden-layout', 'layout-rtl', 'full-width'] as const

const LAYOUT_HTML_ATTR = 'data-layout'
const LAYOUT_DIR_ATTR = 'dir'

const MODE_DOM: Record<Exclude<LayoutMode, 'default'>, ModeDom> = {
  mini: { dataLayout: 'mini', bodyClass: 'mini-sidebar' },
  hoverview: { dataLayout: 'hoverview', bodyClass: 'mini-sidebar' },
  hidden: { dataLayout: 'hidden', bodyClass: 'hidden-layout' },
  'full-width': { dataLayout: 'full-width', bodyClass: '' },
  rtl: { dataLayout: 'rtl', bodyClass: 'layout-rtl', dir: 'rtl' },
  'two-column': { dataLayout: '', bodyClass: '' },
  horizontal: { dataLayout: 'horizontal', bodyClass: '' },
}

function reset(): void {
  const html = document.documentElement
  html.removeAttribute(LAYOUT_HTML_ATTR)
  html.removeAttribute(LAYOUT_DIR_ATTR)
  LAYOUT_BODY_CLASSES.forEach((cls) => document.body.classList.remove(cls))
}

export function clearDocumentLayout(): void {
  reset()
}

export function applyDocumentLayout(mode: LayoutMode): void {
  reset()

  // 'default' has no DOM footprint — a bare reset is the whole job.
  if (mode === 'default') return

  const dom = MODE_DOM[mode]
  if (!dom) return

  const html = document.documentElement
  if (dom.dataLayout) html.setAttribute(LAYOUT_HTML_ATTR, dom.dataLayout)
  if (dom.dir) html.setAttribute(LAYOUT_DIR_ATTR, dom.dir)
  if (dom.bodyClass) document.body.classList.add(dom.bodyClass)
}
