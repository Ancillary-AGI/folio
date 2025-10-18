/*
  # Circuit CAD Database Schema

  ## Overview
  This migration creates the complete database structure for a professional electronic circuit design CAD application.

  ## 1. New Tables
  
  ### `projects`
  Stores circuit design projects
  - `id` (uuid, primary key) - Unique project identifier
  - `user_id` (uuid) - Owner of the project (references auth.users)
  - `name` (text) - Project name
  - `description` (text) - Project description
  - `thumbnail` (text, nullable) - Base64 thumbnail of schematic
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `components`
  Electronic component library (resistors, capacitors, ICs, etc.)
  - `id` (uuid, primary key) - Component type identifier
  - `user_id` (uuid, nullable) - Creator for custom components (NULL for standard library)
  - `category` (text) - Component category (resistor, capacitor, ic, etc.)
  - `name` (text) - Component display name
  - `symbol_data` (jsonb) - SVG path data for schematic symbol
  - `pins` (jsonb) - Array of pin definitions with positions and names
  - `default_properties` (jsonb) - Default values (resistance, capacitance, etc.)
  - `is_standard` (boolean) - Whether this is a standard library component
  - `created_at` (timestamptz) - Creation timestamp

  ### `schematics`
  Schematic designs within projects
  - `id` (uuid, primary key) - Schematic identifier
  - `project_id` (uuid) - Parent project reference
  - `name` (text) - Schematic name/sheet name
  - `canvas_data` (jsonb) - Complete canvas state (components, wires, positions)
  - `order_index` (integer) - Display order for multi-sheet designs
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `placed_components`
  Component instances placed in schematics
  - `id` (uuid, primary key) - Instance identifier
  - `schematic_id` (uuid) - Parent schematic reference
  - `component_id` (uuid) - Component type reference
  - `position_x` (float) - X coordinate on canvas
  - `position_y` (float) - Y coordinate on canvas
  - `rotation` (integer) - Rotation angle (0, 90, 180, 270)
  - `reference` (text) - Component reference (R1, C2, U3, etc.)
  - `properties` (jsonb) - Instance-specific property values
  - `created_at` (timestamptz) - Creation timestamp

  ### `wires`
  Electrical connections between component pins
  - `id` (uuid, primary key) - Wire identifier
  - `schematic_id` (uuid) - Parent schematic reference
  - `points` (jsonb) - Array of coordinate points for wire path
  - `connected_pins` (jsonb) - Array of connected pin references
  - `net_name` (text, nullable) - Optional net name for labeled connections
  - `created_at` (timestamptz) - Creation timestamp

  ## 2. Security
  
  All tables have Row Level Security (RLS) enabled with the following policies:
  
  ### Projects
  - Users can view their own projects
  - Users can create their own projects
  - Users can update their own projects
  - Users can delete their own projects
  
  ### Components
  - All authenticated users can view standard library components
  - Users can view their own custom components
  - Users can create their own custom components
  - Users can update their own custom components
  - Users can delete their own custom components
  
  ### Schematics
  - Users can view schematics in their own projects
  - Users can create schematics in their own projects
  - Users can update schematics in their own projects
  - Users can delete schematics in their own projects
  
  ### Placed Components
  - Users can view components in their own schematics
  - Users can create components in their own schematics
  - Users can update components in their own schematics
  - Users can delete components in their own schematics
  
  ### Wires
  - Users can view wires in their own schematics
  - Users can create wires in their own schematics
  - Users can update wires in their own schematics
  - Users can delete wires in their own schematics

  ## 3. Indexes
  
  Performance indexes for common query patterns:
  - Projects by user_id and updated_at
  - Components by category and is_standard
  - Schematics by project_id
  - Placed components by schematic_id
  - Wires by schematic_id

  ## 4. Important Notes
  
  - All tables use UUID primary keys for scalability
  - JSONB is used for flexible storage of canvas data and component definitions
  - Standard library components have NULL user_id and is_standard = true
  - Timestamps use timestamptz for timezone awareness
  - Foreign key constraints ensure referential integrity with CASCADE deletes
*/

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  thumbnail text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create components library table
CREATE TABLE IF NOT EXISTS components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  name text NOT NULL,
  symbol_data jsonb NOT NULL,
  pins jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_properties jsonb DEFAULT '{}'::jsonb,
  is_standard boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create schematics table
CREATE TABLE IF NOT EXISTS schematics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Sheet 1',
  canvas_data jsonb DEFAULT '{}'::jsonb,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create placed_components table
CREATE TABLE IF NOT EXISTS placed_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schematic_id uuid NOT NULL REFERENCES schematics(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  position_x float NOT NULL,
  position_y float NOT NULL,
  rotation integer DEFAULT 0,
  reference text NOT NULL,
  properties jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create wires table
CREATE TABLE IF NOT EXISTS wires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schematic_id uuid NOT NULL REFERENCES schematics(id) ON DELETE CASCADE,
  points jsonb NOT NULL,
  connected_pins jsonb DEFAULT '[]'::jsonb,
  net_name text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_components_category ON components(category, is_standard);
CREATE INDEX IF NOT EXISTS idx_schematics_project ON schematics(project_id, order_index);
CREATE INDEX IF NOT EXISTS idx_placed_components_schematic ON placed_components(schematic_id);
CREATE INDEX IF NOT EXISTS idx_wires_schematic ON wires(schematic_id);

-- Enable Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE components ENABLE ROW LEVEL SECURITY;
ALTER TABLE schematics ENABLE ROW LEVEL SECURITY;
ALTER TABLE placed_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE wires ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
  ON projects FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Components policies
CREATE POLICY "Users can view standard and own components"
  ON components FOR SELECT
  TO authenticated
  USING (is_standard = true OR auth.uid() = user_id);

CREATE POLICY "Users can create own components"
  ON components FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own components"
  ON components FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own components"
  ON components FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Schematics policies
CREATE POLICY "Users can view own schematics"
  ON schematics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = schematics.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create schematics in own projects"
  ON schematics FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = schematics.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own schematics"
  ON schematics FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = schematics.project_id
      AND projects.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = schematics.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own schematics"
  ON schematics FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = schematics.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Placed components policies
CREATE POLICY "Users can view placed components in own schematics"
  ON placed_components FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = placed_components.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create placed components in own schematics"
  ON placed_components FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = placed_components.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update placed components in own schematics"
  ON placed_components FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = placed_components.schematic_id
      AND projects.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = placed_components.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete placed components in own schematics"
  ON placed_components FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = placed_components.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

-- Wires policies
CREATE POLICY "Users can view wires in own schematics"
  ON wires FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = wires.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create wires in own schematics"
  ON wires FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = wires.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update wires in own schematics"
  ON wires FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = wires.schematic_id
      AND projects.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = wires.schematic_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete wires in own schematics"
  ON wires FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schematics
      JOIN projects ON projects.id = schematics.project_id
      WHERE schematics.id = wires.schematic_id
      AND projects.user_id = auth.uid()
    )
  );