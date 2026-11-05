import type { Component } from 'vue'
/** Workspace navigation shares the template's typed sidebar contract, with product icons. */
export interface WorkspaceSidebarItem {
  to: string
  title: string
  subtitle: string
  icon: Component
}
