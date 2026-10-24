import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isValidSupabaseUrl = (value: string | undefined): boolean => {
  if (!value || value.startsWith('your_')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export const isSupabaseConfigured = Boolean(isValidSupabaseUrl(supabaseUrl) && supabaseAnonKey && !supabaseAnonKey.startsWith('your_'))

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl! : 'http://127.0.0.1:54321',
  isSupabaseConfigured ? supabaseAnonKey! : 'local-development-placeholder',
)

// Database types
export interface Project {
  id: string
  user_id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
  is_public?: boolean
  tags?: string[]
}

export interface Schematic {
  id: string
  project_id: string
  name: string
  description?: string
  canvas_data?: Record<string, unknown>
  order_index: number
  created_at: string
  updated_at: string
}

export interface Component {
  id?: string
  name: string
  category: string
  description?: string
  is_standard: boolean
  user_id?: string | null
  symbol_data: {
    width: number
    height: number
    paths: string[]
    circles?: Array<{ cx: number; cy: number; r: number }>
    rectangles?: Array<{ x: number; y: number; width: number; height: number }>
    text?: Array<{ x: number; y: number; text: string; size?: number }>
  }
  pins: Array<{
    id: string
    name: string
    x: number
    y: number
    type: 'input' | 'output' | 'io' | 'power' | 'ground' | 'passive' | 'nc'
  }>
  default_properties: Record<string, string | number | boolean>
  created_at?: string
  updated_at?: string
  datasheet_url?: string
  manufacturer?: string
  part_number?: string
  tags?: string[]
}
