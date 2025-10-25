# Plugin System Documentation

## Overview

The Circuit CAD Plugin System provides a comprehensive extensibility framework that allows developers to create custom plugins that integrate seamlessly with the main application. The system supports built-in plugins, external plugins, and provides a secure sandboxed environment for plugin execution.

## Architecture

### Core Components

1. **PluginManager** (`src/lib/plugins/pluginManager.ts`)
   - Central registry for all plugins
   - Handles plugin loading, unloading, and lifecycle management
   - Provides secure sandboxed execution environment
   - Manages plugin permissions and security policies

2. **Plugin Types** (`src/types/plugins.ts`)
   - Comprehensive TypeScript interfaces for plugin development
   - Plugin manifest schema
   - API definitions and event types
   - Security and permission models

3. **Plugin Panel** (`src/components/plugins/PluginPanel.tsx`)
   - User interface for managing plugins
   - Install, uninstall, enable, and disable plugins
   - View plugin details and status
   - Search and filter plugins

### Built-in Plugins

The system comes with several built-in plugins:

1. **Circuit Validation Plugin** (`src/lib/plugins/builtin/circuitValidation.ts`)
   - Design rule checking
   - Power and ground connection validation
   - Floating pin detection
   - Short circuit detection
   - Component value validation

2. **Export Tools Plugin** (`src/lib/plugins/builtin/exportTools.ts`)
   - PDF export
   - DXF export for CAD software
   - KiCad schematic export
   - Altium Designer export
   - Eagle CAD export
   - LTSpice netlist export
   - PSpice netlist export
   - Multisim export
   - MATLAB Simulink export
   - Python simulation code export

3. **Simulation Extensions Plugin** (`src/lib/plugins/builtin/simulationExtensions.ts`)
   - Monte Carlo analysis
   - Temperature sweep analysis
   - Parameter sweep analysis
   - Sensitivity analysis
   - Worst case analysis
   - Pole-zero analysis
   - Group delay analysis
   - Harmonic analysis
   - Intermodulation analysis
   - Stability analysis

## Plugin Development

### Creating a Plugin

1. **Create Plugin Class**
   ```typescript
   import { PluginInstance, PluginAPI, PluginContext } from '../../types/plugins'

   export default class MyPlugin implements PluginInstance {
     private api: PluginAPI | null = null
     private context: PluginContext | null = null

     async init(api: PluginAPI, context: PluginContext): Promise<void> {
       this.api = api
       this.context = context
       
       // Initialize your plugin
       this.registerTools()
       this.setupEventListeners()
     }

     async cleanup(): Promise<void> {
       // Cleanup resources
     }
   }
   ```

2. **Create Plugin Manifest**
   ```json
   {
     "id": "my-plugin",
     "name": "My Plugin",
     "version": "1.0.0",
     "description": "Description of what the plugin does",
     "author": "Your Name",
     "enabled": true,
     "permissions": [
       "read:circuit",
       "write:circuit",
       "ui:notifications"
     ],
     "entry": "path/to/plugin.js",
     "tags": ["analysis", "tools"],
     "license": "MIT"
   }
   ```

### Plugin API

The Plugin API provides access to core application functionality:

```typescript
interface PluginAPI {
  // Component management
  addComponent: (component: any) => void
  removeComponent: (id: string) => void
  updateComponent: (id: string, updates: Partial<any>) => void
  
  // Circuit manipulation
  addWire: (wire: any) => void
  removeWire: (id: string) => void
  
  // Simulation
  runSimulation: (parameters: any) => Promise<any>
  
  // UI
  showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void
  openDialog: (content: React.ReactNode) => void
  
  // Events
  on: (event: string, callback: (...args: any[]) => void) => void
  off: (event: string, callback: (...args: any[]) => void) => void
  emit: (event: string, data?: any) => void
}
```

### Plugin Permissions

Plugins must declare permissions they need:

- `read:circuit` - Read circuit data
- `write:circuit` - Modify circuit data
- `delete:circuit` - Delete circuit elements
- `read:components` - Read component library
- `write:components` - Add/modify components
- `simulate:circuit` - Run simulations
- `export:circuit` - Export circuits
- `ui:notifications` - Show notifications
- `ui:dialogs` - Open dialogs
- `network:fetch` - Make network requests
- `file:read` - Read local files
- `system:storage` - Access persistent storage

### Plugin Events

Plugins can listen to and emit events:

```typescript
// Listen to events
api.on('circuit:changed', (circuitData) => {
  // Handle circuit changes
})

api.on('component:added', (component) => {
  // Handle component addition
})

// Emit events
api.emit('analysis:results', {
  pluginId: 'my-plugin',
  results: analysisResults
})
```

## Security

### Sandboxing

Plugins run in a sandboxed environment that:

- Restricts access to global objects
- Provides safe console methods
- Limits file system access
- Controls network access
- Manages memory usage

### Permission System

- Plugins must declare required permissions
- Permissions are validated at runtime
- Users can review and modify plugin permissions
- Sensitive operations require explicit permission

## Usage

### Installing Plugins

1. Open the Plugin Panel (Package icon in toolbar)
2. Click "Install Plugin"
3. Select plugin manifest file (.json)
4. Plugin will be loaded and available

### Managing Plugins

- **Enable/Disable**: Toggle plugin functionality
- **Uninstall**: Remove plugin from system
- **View Details**: See plugin information, permissions, and status
- **Search/Filter**: Find plugins by name, category, or tags

### Plugin Development Tools

The system provides tools for plugin development:

- Plugin manifest validation
- Code sandboxing and security testing
- Event debugging and monitoring
- Performance profiling
- Error reporting and logging

## Example Plugin

See `src/lib/plugins/examples/advancedCircuitAnalyzer.ts` for a complete example plugin that demonstrates:

- Plugin initialization and cleanup
- Event handling
- Tool registration
- Analysis algorithms
- Result reporting
- Error handling

## Best Practices

1. **Security First**
   - Only request necessary permissions
   - Validate all inputs
   - Handle errors gracefully
   - Don't expose sensitive data

2. **Performance**
   - Use efficient algorithms
   - Avoid blocking operations
   - Clean up resources properly
   - Monitor memory usage

3. **User Experience**
   - Provide clear error messages
   - Show progress for long operations
   - Use consistent UI patterns
   - Document plugin functionality

4. **Maintainability**
   - Write clean, documented code
   - Follow TypeScript best practices
   - Use semantic versioning
   - Test thoroughly

## Future Enhancements

- Plugin marketplace integration
- Real-time plugin updates
- Plugin dependencies management
- Advanced debugging tools
- Plugin performance metrics
- Community plugin sharing

## Troubleshooting

### Common Issues

1. **Plugin fails to load**
   - Check manifest syntax
   - Verify permissions
   - Review console errors

2. **Plugin crashes**
   - Check error handling
   - Validate inputs
   - Review memory usage

3. **Permission denied**
   - Update plugin permissions
   - Check security policies
   - Review plugin manifest

### Debug Mode

Enable debug mode for detailed logging:

```typescript
// In plugin code
console.log('Plugin debug info:', debugData)
```

### Support

For plugin development support:
- Check the example plugins
- Review the API documentation
- Test with built-in plugins
- Use the plugin panel for management
