import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  thumbnail?: string;
  created_at: string;
  updated_at: string;
}

export interface Component {
  id: string;
  user_id?: string;
  category: string;
  name: string;
  symbol_data: any;
  pins: any[];
  default_properties: Record<string, any>;
  is_standard: boolean;
  created_at: string;
}

export interface Schematic {
  id: string;
  project_id: string;
  name: string;
  canvas_data: any;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface PlacedComponent {
  id: string;
  schematic_id: string;
  component_id: string;
  position_x: number;
  position_y: number;
  rotation: number;
  reference: string;
  properties: Record<string, any>;
  created_at: string;
}

export interface Wire {
  id: string;
  schematic_id: string;
  points: Array<{ x: number; y: number }>;
  connected_pins: any[];
  net_name?: string;
  created_at: string;
}
