import 'vue-router'
import type { LayoutMode } from '@/utils/layoutDom'

declare module 'vue-router' {
  interface RouteMeta {
    /** Page title, suffixed with the product name by the router guard. */
    title?: string
    subtitle?: string
    /** Which layout shell wraps this route. Defaults to 'default'. */
    layout?: 'default' | 'auth' | 'horizontal'
    /** Layout mode applied to <html>/<body> for the layout-variant demo pages. */
    layoutMode?: LayoutMode
    /** Extra classes on `.page-wrapper`, for pages whose source markup adds them. */
    pageWrapperClass?: string
    /** Pages whose source markup omits the footer. */
    hideFooter?: boolean
    /** Class the source page sets on <body>, e.g. `tools-wrapper` on the generators. */
    bodyClass?: string
    /** Which topbar the shell renders. Defaults to the full app header. */
    headerVariant?: 'generator'
    /** Label shown beside the Back button on the generator topbar. */
    generatorName?: string
  }
}

export {}
