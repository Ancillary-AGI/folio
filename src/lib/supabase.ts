import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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

export interface ComponentInstance {
  id: string
  schematic_id: string
  component_id: string
  reference: string
  x: number
  y: number
  rotation: number
  scale: number
  properties: Record<string, string | number | boolean>
  locked?: boolean
  visible?: boolean
  created_at: string
  updated_at: string
}

export interface Wire {
  id: string
  schematic_id: string
  points: Array<{ x: number; y: number }>
  net_name?: string
  style?: {
    color?: string
    width?: number
    dash_array?: number[]
  }
  created_at: string
  updated_at: string
}

export interface WireConnection {
  id: string
  wire_id: string
  component_instance_id: string
  pin_id: string
  created_at: string
}

export interface SimulationRun {
  id: string
  schematic_id: string
  name: string
  type: 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo'
  parameters: Record<string, string | number | boolean>
  results?: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  error_message?: string
  created_at: string
  updated_at: string
}

// Helper functions
export async function createProject(
  userId: string, 
  name: string, 
  description?: string
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name,
      description,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getProjects(userId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function updateProject(
  projectId: string, 
  updates: Partial<Project>
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) throw error
}

export async function getComponents(): Promise<Component[]> {
  const { data, error } = await supabase
    .from('components')
    .select('*')
    .order('category', { ascending: true })

  if (error) throw error
  return data || []
}

export async function createComponent(component: Omit<Component, 'id' | 'created_at' | 'updated_at'>): Promise<Component> {
  const { data, error } = await supabase
    .from('components')
    .insert(component)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getSchematics(projectId: string): Promise<Schematic[]> {
  const { data, error } = await supabase
    .from('schematics')
    .select('*')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })

  if (error) throw error
  return data || []
}

export async function createSchematic(
  projectId: string, 
  name: string, 
  orderIndex: number
): Promise<Schematic> {
  const { data, error } = await supabase
    .from('schematics')
    .insert({
      project_id: projectId,
      name,
      order_index: orderIndex,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSchematic(
  schematicId: string, 
  updates: Partial<Schematic>
): Promise<Schematic> {
  const { data, error } = await supabase
    .from('schematics')
    .update(updates)
    .eq('id', schematicId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function saveCanvasData(
  schematicId: string, 
  canvasData: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('schematics')
    .update({
      canvas_data: canvasData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', schematicId)

  if (error) throw error
}