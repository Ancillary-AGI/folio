import { Component } from '../../types';

export interface APIEndpoint {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    defaultValue?: any;
  }>;
  requestBody?: {
    contentType: string;
    schema: Record<string, any>;
    example?: any;
  };
  responses: Array<{
    statusCode: number;
    description: string;
    contentType?: string;
    schema?: Record<string, any>;
    example?: any;
  }>;
  authentication: {
    required: boolean;
    type: 'bearer' | 'api_key' | 'oauth2' | 'basic';
    scopes?: string[];
  };
  rateLimit?: {
    requests: number;
    period: number; // seconds
    strategy: 'fixed_window' | 'sliding_window' | 'token_bucket';
  };
  tags: string[];
  deprecated?: boolean;
  version: string;
}

export interface APIIntegration {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  version: string;
  authentication: {
    type: 'bearer' | 'api_key' | 'oauth2' | 'basic' | 'none';
    credentials?: Record<string, any>;
    tokenUrl?: string;
    scopes?: string[];
  };
  endpoints: APIEndpoint[];
  webhooks?: Array<{
    event: string;
    url: string;
    method: 'POST' | 'PUT';
    headers?: Record<string, string>;
    secret?: string;
  }>;
  rateLimits: {
    global: {
      requests: number;
      period: number;
    };
    endpoints: Record<string, {
      requests: number;
      period: number;
    }>;
  };
  retryPolicy: {
    maxRetries: number;
    backoffStrategy: 'linear' | 'exponential' | 'fixed';
    baseDelay: number; // milliseconds
    maxDelay: number; // milliseconds
  };
  timeout: number; // milliseconds
  status: 'active' | 'inactive' | 'maintenance' | 'deprecated';
  healthCheck: {
    enabled: boolean;
    url?: string;
    interval: number; // seconds
    timeout: number; // seconds
  };
  created: Date;
  modified: Date;
}

export interface APIRequest {
  id: string;
  integrationId: string;
  endpointId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  timestamp: Date;
  response?: {
    status: number;
    headers: Record<string, string>;
    body: any;
    duration: number; // milliseconds
    error?: string;
  };
}

export interface APIMetrics {
  id: string;
  integrationId: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    errorRate: number;
    rateLimitHits: number;
    endpoints: Record<string, {
      requests: number;
      successRate: number;
      averageResponseTime: number;
    }>;
  };
  alerts: Array<{
    type: 'error_rate' | 'response_time' | 'rate_limit' | 'availability';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: Date;
  }>;
}

export class APIIntegrationManager {
  private integrations: Map<string, APIIntegration> = new Map();
  private requests: Map<string, APIRequest[]> = new Map();
  private metrics: Map<string, APIMetrics> = new Map();

  createIntegration(integration: Omit<APIIntegration, 'id' | 'created' | 'modified'>): APIIntegration {
    const apiIntegration: APIIntegration = {
      ...integration,
      id: `api_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.integrations.set(apiIntegration.id, apiIntegration);
    return apiIntegration;
  }

  async executeRequest(integrationId: string, endpointId: string, parameters: Record<string, any> = {}, body?: any): Promise<APIRequest> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error('API integration not found');
    }

    const endpoint = integration.endpoints.find(e => e.id === endpointId);
    if (!endpoint) {
      throw new Error('API endpoint not found');
    }

    // Build URL with parameters
    let url = integration.baseUrl + endpoint.path;
    Object.entries(parameters).forEach(([key, value]) => {
      url = url.replace(`{${key}}`, String(value));
    });

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'CircuitCAD-Pro/1.0'
    };

    // Add authentication
    if (integration.authentication.type !== 'none') {
      await this.addAuthenticationHeaders(headers, integration);
    }

    // Add custom headers from endpoint
    if (endpoint.requestBody?.contentType) {
      headers['Content-Type'] = endpoint.requestBody.contentType;
    }

    const request: APIRequest = {
      id: `req_${Date.now()}`,
      integrationId,
      endpointId,
      method: endpoint.method,
      url,
      headers,
      body,
      timestamp: new Date()
    };

    try {
      // Check rate limits
      await this.checkRateLimits(integration, endpoint);

      // Execute request
      const startTime = Date.now();
      const response = await this.makeHTTPRequest(endpoint.method, url, headers, body, integration.timeout);
      const duration = Date.now() - startTime;

      request.response = {
        status: response.status,
        headers: response.headers,
        body: response.body,
        duration
      };

    } catch (error) {
      request.response = {
        status: 0,
        headers: {},
        body: null,
        duration: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Store request
    if (!this.requests.has(integrationId)) {
      this.requests.set(integrationId, []);
    }
    this.requests.get(integrationId)!.push(request);

    return request;
  }

  private async addAuthenticationHeaders(headers: Record<string, string>, integration: APIIntegration): Promise<void> {
    switch (integration.authentication.type) {
      case 'bearer':
        if (integration.authentication.credentials?.token) {
          headers['Authorization'] = `Bearer ${integration.authentication.credentials.token}`;
        }
        break;

      case 'api_key':
        if (integration.authentication.credentials?.key) {
          const headerName = integration.authentication.credentials.headerName || 'X-API-Key';
          headers[headerName] = integration.authentication.credentials.key;
        }
        break;

      case 'basic':
        if (integration.authentication.credentials?.username && integration.authentication.credentials?.password) {
          const credentials = btoa(`${integration.authentication.credentials.username}:${integration.authentication.credentials.password}`);
          headers['Authorization'] = `Basic ${credentials}`;
        }
        break;

      case 'oauth2':
        if (integration.authentication.credentials?.accessToken) {
          headers['Authorization'] = `Bearer ${integration.authentication.credentials.accessToken}`;
        } else if (integration.authentication.tokenUrl) {
          // Implement OAuth2 token refresh
          const token = await this.refreshOAuth2Token(integration);
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
        }
        break;
    }
  }

  private async refreshOAuth2Token(integration: APIIntegration): Promise<string | null> {
    // Simplified OAuth2 token refresh - in practice would make actual HTTP request
    console.log(`Refreshing OAuth2 token for ${integration.name}`);
    return 'new_access_token';
  }

  private async checkRateLimits(integration: APIIntegration, endpoint: APIEndpoint): Promise<void> {
    const endpointLimit = integration.rateLimits.endpoints[endpoint.id];
    const limit = endpointLimit || integration.rateLimits.global;

    // Simplified rate limiting - in practice would use Redis or similar
    const now = Date.now();
    const windowStart = now - (limit.period * 1000);

    const recentRequests = this.requests.get(integration.id)?.filter(
      req => req.timestamp.getTime() > windowStart
    ) || [];

    if (recentRequests.length >= limit.requests) {
      throw new Error(`Rate limit exceeded for ${endpoint.name}`);
    }
  }

  private async makeHTTPRequest(method: string, url: string, headers: Record<string, string>, body?: any, timeout: number = 30000): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
  }> {
    // Simplified HTTP request - in practice would use fetch or axios
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Mock response
        resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { success: true, data: 'Mock response' }
        });
      }, Math.random() * 1000); // Random delay up to 1 second
    });
  }

  createWebhookHandler(integrationId: string, event: string, payload: any): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration?.webhooks) {
      throw new Error('Integration or webhooks not found');
    }

    const webhook = integration.webhooks.find(w => w.event === event);
    if (!webhook) {
      throw new Error('Webhook not configured for this event');
    }

    // Send webhook
    return this.sendWebhook(webhook, payload);
  }

  private async sendWebhook(webhook: NonNullable<APIIntegration['webhooks']>[0], payload: any): Promise<void> {
    const headers = {
      'Content-Type': 'application/json',
      ...webhook.headers
    };

    if (webhook.secret) {
      // Add signature for security
      const signature = this.generateWebhookSignature(payload, webhook.secret);
      headers['X-Signature'] = signature;
    }

    await this.makeHTTPRequest(webhook.method, webhook.url, headers, payload);
  }

  private generateWebhookSignature(payload: any, secret: string): string {
    // Simplified signature generation - in practice would use crypto
    return btoa(JSON.stringify(payload) + secret).substring(0, 64);
  }

  generateMetrics(integrationId: string, startDate: Date, endDate: Date): APIMetrics {
    const requests = this.requests.get(integrationId) || [];

    const periodRequests = requests.filter(
      req => req.timestamp >= startDate && req.timestamp <= endDate
    );

    const totalRequests = periodRequests.length;
    const successfulRequests = periodRequests.filter(req => req.response && req.response.status >= 200 && req.response.status < 300).length;
    const failedRequests = totalRequests - successfulRequests;

    const responseTimes = periodRequests
      .filter(req => req.response)
      .map(req => req.response!.duration);

    const averageResponseTime = responseTimes.length > 0 ?
      responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;

    const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

    // Calculate endpoint metrics
    const endpointMetrics: Record<string, { requests: number; successRate: number; averageResponseTime: number }> = {};
    const endpointRequests = new Map<string, APIRequest[]>();

    periodRequests.forEach(req => {
      if (!endpointRequests.has(req.endpointId)) {
        endpointRequests.set(req.endpointId, []);
      }
      endpointRequests.get(req.endpointId)!.push(req);
    });

    endpointRequests.forEach((reqs, endpointId) => {
      const endpointSuccessful = reqs.filter(req => req.response && req.response.status >= 200 && req.response.status < 300).length;
      const endpointResponseTimes = reqs.filter(req => req.response).map(req => req.response!.duration);
      const endpointAvgTime = endpointResponseTimes.length > 0 ?
        endpointResponseTimes.reduce((a, b) => a + b, 0) / endpointResponseTimes.length : 0;

      endpointMetrics[endpointId] = {
        requests: reqs.length,
        successRate: reqs.length > 0 ? (endpointSuccessful / reqs.length) * 100 : 0,
        averageResponseTime: endpointAvgTime
      };
    });

    // Generate alerts
    const alerts = [];
    if (errorRate > 5) {
      alerts.push({
        type: 'error_rate',
        severity: errorRate > 10 ? 'high' : 'medium',
        message: `Error rate is ${errorRate.toFixed(1)}%`,
        timestamp: new Date()
      });
    }

    if (averageResponseTime > 5000) {
      alerts.push({
        type: 'response_time',
        severity: 'medium',
        message: `Average response time is ${averageResponseTime.toFixed(0)}ms`,
        timestamp: new Date()
      });
    }

    const metrics: APIMetrics = {
      id: `metrics_${Date.now()}`,
      integrationId,
      period: { start: startDate, end: endDate },
      metrics: {
        totalRequests,
        successfulRequests,
        failedRequests,
        averageResponseTime,
        errorRate,
        rateLimitHits: 0, // Would track actual rate limit hits
        endpoints: endpointMetrics
      },
      alerts
    };

    this.metrics.set(metrics.id, metrics);
    return metrics;
  }

  createDefaultIntegrations(): void {
    // GitHub API Integration
    this.createIntegration({
      name: 'GitHub API',
      description: 'Integration with GitHub for repository management and collaboration',
      baseUrl: 'https://api.github.com',
      version: 'v1',
      authentication: {
        type: 'bearer',
        credentials: { token: process.env.GITHUB_TOKEN }
      },
      endpoints: [
        {
          id: 'get_repo',
          name: 'Get Repository',
          method: 'GET',
          path: '/repos/{owner}/{repo}',
          description: 'Get repository information',
          parameters: [
            { name: 'owner', type: 'string', required: true, description: 'Repository owner' },
            { name: 'repo', type: 'string', required: true, description: 'Repository name' }
          ],
          responses: [
            { statusCode: 200, description: 'Repository information', contentType: 'application/json' }
          ],
          authentication: { required: true, type: 'bearer' },
          tags: ['repository'],
          version: 'v1'
        },
        {
          id: 'create_issue',
          name: 'Create Issue',
          method: 'POST',
          path: '/repos/{owner}/{repo}/issues',
          description: 'Create a new issue',
          parameters: [
            { name: 'owner', type: 'string', required: true, description: 'Repository owner' },
            { name: 'repo', type: 'string', required: true, description: 'Repository name' }
          ],
          requestBody: {
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
                labels: { type: 'array', items: { type: 'string' } }
              },
              required: ['title']
            }
          },
          responses: [
            { statusCode: 201, description: 'Issue created', contentType: 'application/json' }
          ],
          authentication: { required: true, type: 'bearer' },
          tags: ['issues'],
          version: 'v1'
        }
      ],
      rateLimits: {
        global: { requests: 5000, period: 3600 },
        endpoints: {
          'get_repo': { requests: 100, period: 60 },
          'create_issue': { requests: 50, period: 60 }
        }
      },
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 10000
      },
      timeout: 30000,
      status: 'active',
      healthCheck: {
        enabled: true,
        url: 'https://api.github.com/zen',
        interval: 300,
        timeout: 10
      }
    });

    // Slack API Integration
    this.createIntegration({
      name: 'Slack API',
      description: 'Integration with Slack for team communication and notifications',
      baseUrl: 'https://slack.com/api',
      version: 'v1',
      authentication: {
        type: 'bearer',
        credentials: { token: process.env.SLACK_TOKEN }
      },
      endpoints: [
        {
          id: 'post_message',
          name: 'Post Message',
          method: 'POST',
          path: '/chat.postMessage',
          description: 'Post a message to a Slack channel',
          parameters: [],
          requestBody: {
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                channel: { type: 'string' },
                text: { type: 'string' },
                attachments: { type: 'array' }
              },
              required: ['channel', 'text']
            }
          },
          responses: [
            { statusCode: 200, description: 'Message posted', contentType: 'application/json' }
          ],
          authentication: { required: true, type: 'bearer' },
          tags: ['messaging'],
          version: 'v1'
        }
      ],
      webhooks: [
        {
          event: 'design_review_completed',
          url: process.env.SLACK_WEBHOOK_URL || '',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
      ],
      rateLimits: {
        global: { requests: 100, period: 60 },
        endpoints: {}
      },
      retryPolicy: {
        maxRetries: 2,
        backoffStrategy: 'linear',
        baseDelay: 1000,
        maxDelay: 5000
      },
      timeout: 15000,
      status: 'active',
      healthCheck: {
        enabled: true,
        url: 'https://slack.com/api/auth.test',
        interval: 600,
        timeout: 10
      }
    });
  }

  getIntegration(id: string): APIIntegration | undefined {
    return this.integrations.get(id);
  }

  getRequest(id: string): APIRequest | undefined {
    // Search through all integration requests
    for (const requests of this.requests.values()) {
      const request = requests.find(r => r.id === id);
      if (request) return request;
    }
    return undefined;
  }

  getMetrics(id: string): APIMetrics | undefined {
    return this.metrics.get(id);
  }

  getAllIntegrations(): APIIntegration[] {
    return Array.from(this.integrations.values());
  }

  getIntegrationRequests(integrationId: string): APIRequest[] {
    return this.requests.get(integrationId) || [];
  }

  updateIntegrationStatus(id: string, status: APIIntegration['status']): boolean {
    const integration = this.integrations.get(id);
    if (!integration) return false;

    integration.status = status;
    integration.modified = new Date();
    return true;
  }
}

export const apiIntegrationManager = new APIIntegrationManager();