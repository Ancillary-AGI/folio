import { useState, useRef, useEffect } from 'react'
import { 
  Send, 
  Bot, 
  User, 
  Lightbulb, 
  Zap, 
  X, 
  Sparkles, 
  TrendingUp, 
  Shield, 
  DollarSign,
  Clock,
  Cpu,
  Battery,
  Thermometer,
  Copy,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  AlertCircle
} from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    type?: 'component_suggestion' | 'circuit_analysis' | 'optimization' | 'general';
    components?: string[];
    confidence?: number;
    actions?: string[];
    cost_impact?: number;
    performance_impact?: number;
  };
}

interface AIChatPanelProps {
  onClose: () => void
}

const quickActions = [
  { 
    label: 'Component Suggestions', 
    prompt: 'Suggest optimal components for a low-power microcontroller circuit',
    icon: <Cpu className="w-3 h-3" />
  },
  { 
    label: 'Circuit Analysis', 
    prompt: 'Analyze my current circuit for potential issues and improvements',
    icon: <AlertCircle className="w-3 h-3" />
  },
  { 
    label: 'Power Optimization', 
    prompt: 'How can I reduce power consumption in my design?',
    icon: <Battery className="w-3 h-3" />
  },
  { 
    label: 'Cost Optimization', 
    prompt: 'Suggest ways to reduce the cost of my circuit',
    icon: <DollarSign className="w-3 h-3" />
  },
  { 
    label: 'Thermal Analysis', 
    prompt: 'Check thermal considerations for my power components',
    icon: <Thermometer className="w-3 h-3" />
  },
  { 
    label: 'Signal Integrity', 
    prompt: 'Review signal integrity for high-speed digital signals',
    icon: <TrendingUp className="w-3 h-3" />
  }
];

export default function AIChatPanel({ onClose }: AIChatPanelProps) {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I\'m your AI circuit design assistant. I can help you with:\n\n• Component selection and recommendations\n• Circuit analysis and optimization\n• Design rule checking\n• Cost and performance optimization\n• Thermal and power analysis\n\nWhat would you like to work on today?',
      timestamp: Date.now(),
      metadata: { type: 'general' }
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showQuickActions, setShowQuickActions] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // const { components, wires } = useProjectStore()
  // const { settings } = useAppStore()
  
  useEffect(() => {
    scrollToBottom()
  }, [messages])
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return
    
    const userMessage: AIMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue,
      timestamp: Date.now()
    }
    
    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)
    setShowQuickActions(false)
    
    // Simulate AI response with more sophisticated logic
    setTimeout(() => {
      const aiResponse = generateAIResponse(inputValue)
      setMessages(prev => [...prev, aiResponse])
      setIsLoading(false)
    }, 1500)
  }

  const generateAIResponse = (input: string): AIMessage => {
    const lowerInput = input.toLowerCase()
    
    if (lowerInput.includes('component') && lowerInput.includes('suggest')) {
      return {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: 'Based on your requirements, I recommend these components:\n\n**Microcontroller**: STM32F103C8T6\n• Low power consumption (2mA active, 2µA standby)\n• 32-bit ARM Cortex-M3 core\n• Cost: ~$2.50\n\n**Power Management**: AMS1117-3.3\n• Linear regulator, 1A output\n• Low dropout voltage\n• Cost: ~$0.15\n\n**Decoupling**: 0.1µF ceramic capacitors\n• X7R dielectric for stability\n• 0603 package for space efficiency\n• Cost: ~$0.02 each\n\nWould you like detailed specifications or alternative options?',
        timestamp: Date.now(),
        metadata: {
          type: 'component_suggestion',
          components: ['STM32F103C8T6', 'AMS1117-3.3', '0.1µF Ceramic Cap'],
          confidence: 0.92,
          cost_impact: -15,
          performance_impact: 8
        }
      }
    }
    
    if (lowerInput.includes('analyze') || lowerInput.includes('check')) {
      return {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: 'Circuit Analysis Complete ✓\n\n**Issues Found:**\n🔴 Missing decoupling capacitors on IC power pins\n🟡 Pull-up resistor value may be too high (10kΩ → 4.7kΩ)\n🟡 Consider adding ESD protection on exposed pins\n\n**Optimizations:**\n🟢 Replace 1N4007 with Schottky diode for lower Vf\n🟢 Use smaller package components to reduce board area\n🟢 Add test points for debugging\n\n**Estimated Improvements:**\n• 15% cost reduction\n• 8% performance improvement\n• Better EMC compliance\n\nShall I provide detailed recommendations for any of these items?',
        timestamp: Date.now(),
        metadata: {
          type: 'circuit_analysis',
          confidence: 0.87,
          actions: ['add_decoupling', 'change_resistor', 'add_esd_protection'],
          cost_impact: -15,
          performance_impact: 8
        }
      }
    }
    
    if (lowerInput.includes('power') || lowerInput.includes('consumption')) {
      return {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: 'Power Optimization Analysis 🔋\n\n**Current Consumption Estimate:** ~45mA\n\n**Optimization Strategies:**\n\n1. **Sleep Modes** (-60% power)\n   • Implement deep sleep when idle\n   • Wake on interrupt/timer\n\n2. **Clock Management** (-25% power)\n   • Reduce system clock when possible\n   • Use internal RC oscillator\n\n3. **Peripheral Management** (-15% power)\n   • Disable unused peripherals\n   • Use DMA for data transfers\n\n4. **Component Selection** (-20% power)\n   • Low-power op-amps (e.g., OPA2333)\n   • CMOS logic instead of TTL\n\n**Projected Result:** ~12mA average consumption\n**Battery Life Improvement:** 3.7x longer\n\nWould you like specific implementation details for any of these strategies?',
        timestamp: Date.now(),
        metadata: {
          type: 'optimization',
          confidence: 0.94,
          performance_impact: 270,
          actions: ['implement_sleep', 'optimize_clock', 'disable_peripherals']
        }
      }
    }
    
    return {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: 'I understand you\'re looking for circuit design assistance. Could you provide more specific details about:\n\n• Your project requirements\n• Target specifications (power, cost, performance)\n• Current design challenges\n• Specific components you\'re considering\n\nThis will help me give you more targeted and useful recommendations.',
      timestamp: Date.now(),
      metadata: { type: 'general' }
    }
  }

  const handleQuickAction = (prompt: string) => {
    setInputValue(prompt)
    setShowQuickActions(false)
  }

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
  }

  const getMessageIcon = (message: AIMessage) => {
    if (message.role === 'user') return <User className="w-4 h-4" />
    
    switch (message.metadata?.type) {
      case 'component_suggestion':
        return <Lightbulb className="w-4 h-4 text-yellow-500" />
      case 'circuit_analysis':
        return <AlertCircle className="w-4 h-4 text-blue-500" />
      case 'optimization':
        return <Zap className="w-4 h-4 text-green-500" />
      default:
        return <Bot className="w-4 h-4 text-primary" />
    }
  }

  const getMessageTypeColor = (type?: string) => {
    switch (type) {
      case 'component_suggestion':
        return 'border-l-yellow-500'
      case 'circuit_analysis':
        return 'border-l-blue-500'
      case 'optimization':
        return 'border-l-green-500'
      default:
        return 'border-l-primary'
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }
  
  return (
    <div className="w-96 h-full bg-card border-l border-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Bot className="w-5 h-5 text-primary" />
            <Sparkles className="w-3 h-3 text-yellow-500 absolute -top-1 -right-1" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">AI Assistant</h3>
            <p className="text-xs text-muted-foreground">Circuit Design Expert</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === 'user' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted text-muted-foreground'
              }`}>
                {getMessageIcon(message)}
              </div>
              
              <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                <Card className={`${message.role === 'assistant' ? `border-l-4 ${getMessageTypeColor(message.metadata?.type)}` : ''}`}>
                  <CardContent className="p-3">
                    <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                    
                    {/* Metadata for AI responses */}
                    {message.role === 'assistant' && message.metadata && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {message.metadata.confidence && (
                            <div className="flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              <span>{Math.round(message.metadata.confidence * 100)}% confidence</span>
                            </div>
                          )}
                          {message.metadata.cost_impact && (
                            <div className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              <span className={message.metadata.cost_impact < 0 ? 'text-green-600' : 'text-red-600'}>
                                {message.metadata.cost_impact > 0 ? '+' : ''}{message.metadata.cost_impact}%
                              </span>
                            </div>
                          )}
                          {message.metadata.performance_impact && (
                            <div className="flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />
                              <span className="text-green-600">+{message.metadata.performance_impact}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                <div className="flex items-center justify-between mt-2">
                  <div className="text-xs text-muted-foreground">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                  
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyMessage(message.content)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <MoreHorizontal className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <Bot className="w-4 h-4 text-muted-foreground animate-pulse" />
              </div>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    <span className="text-sm text-muted-foreground">AI is thinking...</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick Actions */}
      {showQuickActions && messages.length <= 1 && (
        <div className="p-4 border-t border-border">
          <h4 className="text-sm font-medium text-foreground mb-3">Quick Actions</h4>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction(action.prompt)}
                className="flex items-center gap-2 h-auto p-2 text-left justify-start"
              >
                {action.icon}
                <span className="text-xs">{action.label}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about components, optimization, or circuit analysis..."
            className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <span>Powered by AI • Circuit Design Expert</span>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>~2s response</span>
          </div>
        </div>
      </div>
    </div>
  )
}