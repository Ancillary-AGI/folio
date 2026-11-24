/**
 * Database row shapes.
 *
 * These mirror the columns the migrations create. They live apart from the client
 * so a module that only needs a row type does not have to import the Supabase
 * client (and its `localStorage`-backed session) to get one.
 */

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

export type PinType = 'input' | 'output' | 'io' | 'power' | 'ground' | 'passive' | 'nc'

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
    type: PinType
  }>
  default_properties: Record<string, string | number | boolean>
  created_at?: string
  updated_at?: string
  datasheet_url?: string
  manufacturer?: string
  part_number?: string
  tags?: string[]
}