export interface AdminNavItem {
  id: string
  label: string
  to: string
  order?: number
  permission?: string | string[]
}

export type AdminNavItems = AdminNavItem[]
