export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface MCPServer {
  name: string
  version: string
  capabilities: {
    tools?: boolean
    resources?: boolean
    prompts?: boolean
  }
}

export interface MCPMessage {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: Record<string, unknown>
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

class MCPClient {
  private servers: Map<string, WebSocket> = new Map()
  private messageId = 0
  private pendingRequests: Map<string | number, {
    resolve: (value: MCPResponse) => void
    reject: (error: Error) => void
  }> = new Map()
  
  async connectToServer(serverUrl: string, serverName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(serverUrl)
        
        ws.onopen = () => {
          this.servers.set(serverName, ws)
          this.initializeServer(serverName)
            .then(() => resolve())
            .catch(reject)
        }
        
        ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data))
        }
        
        ws.onerror = (error) => {
          reject(new Error(`WebSocket error: ${error}`))
        }
        
        ws.onclose = () => {
          this.servers.delete(serverName)
        }
      } catch (error) {
        reject(error)
      }
    })
  }
  
  private async initializeServer(serverName: string): Promise<MCPServer> {
    const response = await this.sendRequest(serverName, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: true,
        resources: true,
        prompts: true
      },
      clientInfo: {
        name: 'Circuit CAD Pro',
        version: '1.0.0'
      }
    })
    
    return response.result as unknown as MCPServer
  }
  
  private handleMessage(message: MCPResponse): void {
    if (message.id && this.pendingRequests.has(message.id)) {
      const request = this.pendingRequests.get(message.id)!
      this.pendingRequests.delete(message.id)
      
      if (message.error) {
        request.reject(new Error(message.error.message))
      } else {
        request.resolve(message)
      }
    }
  }
  
  private async sendRequest(serverName: string, method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
    const ws = this.servers.get(serverName)
    if (!ws) {
      throw new Error(`Server ${serverName} not connected`)
    }
    
    const id = ++this.messageId
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      ws.send(JSON.stringify(message))
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 30000)
    })
  }
  
  async listTools(serverName: string): Promise<MCPTool[]> {
    const response = await this.sendRequest(serverName, 'tools/list')
    return (response.result as { tools?: MCPTool[] })?.tools || []
  }
  
  async callTool(serverName: string, toolName: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const response = await this.sendRequest(serverName, 'tools/call', {
      name: toolName,
      arguments: arguments_
    })
    return (response.result as { content?: unknown })?.content
  }
  
  async listResources(serverName: string): Promise<MCPResource[]> {
    const response = await this.sendRequest(serverName, 'resources/list')
    return (response.result as { resources?: MCPResource[] })?.resources || []
  }
  
  async readResource(serverName: string, uri: string): Promise<unknown> {
    const response = await this.sendRequest(serverName, 'resources/read', { uri })
    return (response.result as { contents?: unknown })?.contents
  }
  
  async listPrompts(serverName: string): Promise<Record<string, unknown>[]> {
    const response = await this.sendRequest(serverName, 'prompts/list')
    return (response.result as { prompts?: Record<string, unknown>[] })?.prompts || []
  }
  
  async getPrompt(serverName: string, name: string, arguments_?: Record<string, unknown>): Promise<unknown> {
    const response = await this.sendRequest(serverName, 'prompts/get', {
      name,
      arguments: arguments_
    })
    return (response.result as { messages?: unknown })?.messages
  }
  
  disconnectFromServer(serverName: string): void {
    const ws = this.servers.get(serverName)
    if (ws) {
      ws.close()
      this.servers.delete(serverName)
    }
  }
  
  disconnectAll(): void {
    for (const [serverName] of this.servers) {
      this.disconnectFromServer(serverName)
    }
  }
  
  isConnected(serverName: string): boolean {
    const ws = this.servers.get(serverName)
    return ws ? ws.readyState === WebSocket.OPEN : false
  }
  
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys()).filter(name => this.isConnected(name))
  }
}

// Circuit-specific MCP tools
export class CircuitMCPTools {
  constructor(private mcpClient: MCPClient) {}
  
  async analyzeCircuit(serverName: string, components: Record<string, unknown>[], wires: Record<string, unknown>[]): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'analyze_circuit', {
      components,
      wires
    })
  }
  
  async optimizeCircuit(serverName: string, circuit: Record<string, unknown>, criteria: string[]): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'optimize_circuit', {
      circuit,
      criteria
    })
  }
  
  async simulateCircuit(serverName: string, netlist: string, analysisType: string): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'simulate_circuit', {
      netlist,
      analysis_type: analysisType
    })
  }
  
  async suggestComponents(serverName: string, requirements: Record<string, unknown>): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'suggest_components', requirements)
  }
  
  async validateDesign(serverName: string, design: Record<string, unknown>): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'validate_design', design)
  }
  
  async generatePCBLayout(serverName: string, schematic: Record<string, unknown>): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'generate_pcb_layout', schematic)
  }
  
  async calculateCost(serverName: string, bomList: Record<string, unknown>[]): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'calculate_cost', { bom: bomList })
  }
  
  async findAlternatives(serverName: string, component: string): Promise<unknown> {
    return this.mcpClient.callTool(serverName, 'find_alternatives', { component })
  }
}

export const mcpClient = new MCPClient()
export const circuitMCPTools = new CircuitMCPTools(mcpClient)