import { Component } from '../../types';

export interface OfflineConfig {
  id: string;
  userId: string;
  enabled: boolean;
  storageQuota: number; // MB
  syncOnReconnect: boolean;
  cacheStrategy: 'aggressive' | 'conservative' | 'manual';
  excludedPaths: string[];
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  autoCleanup: boolean;
  cleanupInterval: number; // days
}

export interface CachedItem {
  id: string;
  key: string;
  data: any;
  size: number;
  lastAccessed: Date;
  expiresAt?: Date;
  compressed: boolean;
  encrypted: boolean;
  version: number;
  tags: string[];
}

export interface OfflineQueue {
  id: string;
  userId: string;
  items: Array<{
    id: string;
    type: 'create' | 'update' | 'delete';
    resource: string;
    data: any;
    timestamp: Date;
    retryCount: number;
    maxRetries: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
  }>;
  created: Date;
  lastProcessed?: Date;
}

export interface OfflineMetrics {
  id: string;
  userId: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    cacheHitRate: number;
    storageUsed: number;
    storageAvailable: number;
    queuedOperations: number;
    syncConflicts: number;
    offlineTime: number; // minutes
    dataCompressionRatio: number;
  };
  alerts: Array<{
    type: 'storage_warning' | 'sync_conflict' | 'queue_full';
    message: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: Date;
  }>;
}

export class OfflineModeManager {
  private configs: Map<string, OfflineConfig> = new Map();
  private cache: Map<string, CachedItem> = new Map();
  private queues: Map<string, OfflineQueue> = new Map();
  private metrics: Map<string, OfflineMetrics> = new Map();

  configureOffline(config: Omit<OfflineConfig, 'id'>): OfflineConfig {
    const offlineConfig: OfflineConfig = {
      ...config,
      id: `offline_${Date.now()}`
    };

    this.configs.set(offlineConfig.id, offlineConfig);
    return offlineConfig;
  }

  enableOfflineMode(configId: string): boolean {
    const config = this.configs.get(configId);
    if (!config) return false;

    config.enabled = true;

    // Initialize offline cache and queue
    this.initializeOfflineStorage(config);

    return true;
  }

  disableOfflineMode(configId: string): Promise<boolean> {
    const config = this.configs.get(configId);
    if (!config) return Promise.resolve(false);

    config.enabled = false;

    // Sync pending changes and clean up
    return this.syncPendingChanges(configId).then(() => {
      this.cleanupOfflineStorage(config);
      return true;
    });
  }

  private initializeOfflineStorage(config: OfflineConfig): void {
    // Initialize IndexedDB or local storage for offline data
    console.log(`Initializing offline storage for user ${config.userId}`);

    // Create offline queue
    const queue: OfflineQueue = {
      id: `queue_${config.userId}`,
      userId: config.userId,
      items: [],
      created: new Date()
    };

    this.queues.set(config.userId, queue);
  }

  private cleanupOfflineStorage(config: OfflineConfig): void {
    // Clean up offline storage
    console.log(`Cleaning up offline storage for user ${config.userId}`);

    // Clear cache
    const userCacheKeys = Array.from(this.cache.keys()).filter(key =>
      key.startsWith(`${config.userId}:`)
    );

    userCacheKeys.forEach(key => this.cache.delete(key));

    // Clear queue
    this.queues.delete(config.userId);
  }

  cacheData(configId: string, key: string, data: any, options: {
    ttl?: number; // seconds
    tags?: string[];
    compress?: boolean;
    encrypt?: boolean;
  } = {}): boolean {
    const config = this.configs.get(configId);
    if (!config || !config.enabled) return false;

    const cacheKey = `${config.userId}:${key}`;

    // Check storage quota
    const currentUsage = this.getStorageUsage(config.userId);
    const dataSize = this.calculateDataSize(data);

    if (currentUsage + dataSize > config.storageQuota * 1024 * 1024) {
      // Storage full - attempt cleanup
      this.performStorageCleanup(config);
      const newUsage = this.getStorageUsage(config.userId);
      if (newUsage + dataSize > config.storageQuota * 1024 * 1024) {
        return false; // Still not enough space
      }
    }

    let processedData = data;
    let compressed = false;
    let encrypted = false;

    // Compress if enabled
    if (options.compress && config.compressionEnabled) {
      processedData = this.compressData(data);
      compressed = true;
    }

    // Encrypt if enabled
    if (options.encrypt && config.encryptionEnabled) {
      processedData = this.encryptData(processedData);
      encrypted = true;
    }

    const cachedItem: CachedItem = {
      id: `cache_${Date.now()}`,
      key: cacheKey,
      data: processedData,
      size: this.calculateDataSize(processedData),
      lastAccessed: new Date(),
      expiresAt: options.ttl ? new Date(Date.now() + options.ttl * 1000) : undefined,
      compressed,
      encrypted,
      version: 1,
      tags: options.tags || []
    };

    this.cache.set(cacheKey, cachedItem);
    return true;
  }

  getCachedData(configId: string, key: string): any | null {
    const config = this.configs.get(configId);
    if (!config || !config.enabled) return null;

    const cacheKey = `${config.userId}:${key}`;
    const cachedItem = this.cache.get(cacheKey);

    if (!cachedItem) return null;

    // Check expiration
    if (cachedItem.expiresAt && cachedItem.expiresAt < new Date()) {
      this.cache.delete(cacheKey);
      return null;
    }

    // Update last accessed
    cachedItem.lastAccessed = new Date();

    // Decompress and decrypt if needed
    let data = cachedItem.data;
    if (cachedItem.encrypted) {
      data = this.decryptData(data);
    }
    if (cachedItem.compressed) {
      data = this.decompressData(data);
    }

    return data;
  }

  queueOperation(configId: string, operation: {
    type: 'create' | 'update' | 'delete';
    resource: string;
    data?: any;
  }): boolean {
    const config = this.configs.get(configId);
    if (!config || !config.enabled) return false;

    const queue = this.queues.get(config.userId);
    if (!queue) return false;

    const queueItem = {
      id: `op_${Date.now()}`,
      type: operation.type,
      resource: operation.resource,
      data: operation.data,
      timestamp: new Date(),
      retryCount: 0,
      maxRetries: 3,
      status: 'pending' as const
    };

    queue.items.push(queueItem);
    queue.lastProcessed = new Date();

    return true;
  }

  async syncPendingChanges(configId: string): Promise<{
    synced: number;
    failed: number;
    conflicts: number;
  }> {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Configuration not found');
    }

    const queue = this.queues.get(config.userId);
    if (!queue) {
      return { synced: 0, failed: 0, conflicts: 0 };
    }

    let synced = 0;
    let failed = 0;
    const conflicts = 0;

    for (const item of queue.items.filter(i => i.status === 'pending')) {
      try {
        item.status = 'processing';

        // Attempt to sync the operation
        const success = await this.syncOperation(item, config);

        if (success) {
          item.status = 'completed';
          synced++;
        } else {
          item.retryCount++;
          if (item.retryCount >= item.maxRetries) {
            item.status = 'failed';
            failed++;
          } else {
            item.status = 'pending'; // Will retry later
          }
        }

      } catch (error) {
        item.retryCount++;
        if (item.retryCount >= item.maxRetries) {
          item.status = 'failed';
          failed++;
        }
        console.error(`Failed to sync operation ${item.id}:`, error);
      }
    }

    // Clean up completed items
    queue.items = queue.items.filter(item => item.status !== 'completed');

    return { synced, failed, conflicts };
  }

  private async syncOperation(item: OfflineQueue['items'][0], config: OfflineConfig): Promise<boolean> {
    // Simplified sync operation - in practice would make actual API calls
    console.log(`Syncing ${item.type} operation for ${item.resource}`);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

    // Simulate success/failure
    return Math.random() > 0.1; // 90% success rate
  }

  private getStorageUsage(userId: string): number {
    const userCache = Array.from(this.cache.values()).filter(item =>
      item.key.startsWith(`${userId}:`)
    );

    return userCache.reduce((total, item) => total + item.size, 0);
  }

  private calculateDataSize(data: any): number {
    // Rough estimation of data size in bytes
    return JSON.stringify(data).length * 2; // UTF-16 encoding
  }

  private performStorageCleanup(config: OfflineConfig): void {
    const userCache = Array.from(this.cache.entries()).filter(([key]) =>
      key.startsWith(`${config.userId}:`)
    );

    // Remove expired items first
    const expiredItems = userCache.filter(([, item]) =>
      item.expiresAt && item.expiresAt < new Date()
    );

    expiredItems.forEach(([key]) => this.cache.delete(key));

    // If still need space, remove least recently used items
    if (config.cacheStrategy === 'aggressive') {
      const sortedByAccess = userCache
        .filter(([, item]) => !item.expiresAt || item.expiresAt > new Date())
        .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

      // Remove oldest 20% of items
      const itemsToRemove = Math.floor(sortedByAccess.length * 0.2);
      for (let i = 0; i < itemsToRemove; i++) {
        this.cache.delete(sortedByAccess[i][0]);
      }
    }
  }

  private compressData(data: any): any {
    // Simplified compression - in practice would use a compression library
    return {
      compressed: true,
      originalSize: this.calculateDataSize(data),
      data: btoa(JSON.stringify(data)) // Base64 encoding as simple compression
    };
  }

  private decompressData(compressedData: any): any {
    if (!compressedData.compressed) return compressedData;

    return JSON.parse(atob(compressedData.data));
  }

  private encryptData(data: any): any {
    // Simplified encryption - in practice would use proper encryption
    const key = 'offline-encryption-key'; // Should be properly managed
    return {
      encrypted: true,
      data: btoa(JSON.stringify(data) + key) // Simple obfuscation
    };
  }

  private decryptData(encryptedData: any): any {
    if (!encryptedData.encrypted) return encryptedData;

    const key = 'offline-encryption-key';
    const decrypted = atob(encryptedData.data).replace(key, '');
    return JSON.parse(decrypted);
  }

  getOfflineStatus(configId: string): {
    enabled: boolean;
    storageUsed: number;
    storageQuota: number;
    queuedOperations: number;
    cacheItems: number;
    lastSync?: Date;
  } {
    const config = this.configs.get(configId);
    if (!config) {
      return {
        enabled: false,
        storageUsed: 0,
        storageQuota: 0,
        queuedOperations: 0,
        cacheItems: 0
      };
    }

    const queue = this.queues.get(config.userId);

    return {
      enabled: config.enabled,
      storageUsed: this.getStorageUsage(config.userId),
      storageQuota: config.storageQuota * 1024 * 1024, // Convert to bytes
      queuedOperations: queue?.items.filter(i => i.status === 'pending').length || 0,
      cacheItems: Array.from(this.cache.keys()).filter(key =>
        key.startsWith(`${config.userId}:`)
      ).length,
      lastSync: queue?.lastProcessed
    };
  }

  generateOfflineMetrics(configId: string, startDate: Date, endDate: Date): OfflineMetrics {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Configuration not found');
    }

    const queue = this.queues.get(config.userId);
    const userCache = Array.from(this.cache.values()).filter(item =>
      item.key.startsWith(`${config.userId}:`)
    );

    // Calculate metrics
    const cacheHits = userCache.filter(item =>
      item.lastAccessed >= startDate && item.lastAccessed <= endDate
    ).length;

    const totalCacheAccesses = cacheHits; // Simplified
    const cacheHitRate = totalCacheAccesses > 0 ? (cacheHits / totalCacheAccesses) * 100 : 0;

    const storageUsed = this.getStorageUsage(config.userId);
    const storageAvailable = config.storageQuota * 1024 * 1024 - storageUsed;

    const queuedOperations = queue?.items.filter(i => i.status === 'pending').length || 0;

    // Calculate compression ratio
    const compressedItems = userCache.filter(item => item.compressed);
    const originalSize = compressedItems.reduce((sum, item) => sum + (item as any).originalSize || item.size, 0);
    const compressedSize = compressedItems.reduce((sum, item) => sum + item.size, 0);
    const dataCompressionRatio = originalSize > 0 ? (originalSize / compressedSize) : 1;

    const metrics: OfflineMetrics = {
      id: `metrics_${Date.now()}`,
      userId: config.userId,
      period: { start: startDate, end: endDate },
      metrics: {
        cacheHitRate,
        storageUsed,
        storageAvailable,
        queuedOperations,
        syncConflicts: 0, // Would track actual conflicts
        offlineTime: 0, // Would track actual offline time
        dataCompressionRatio
      },
      alerts: []
    };

    // Generate alerts
    if (storageUsed > config.storageQuota * 1024 * 1024 * 0.9) {
      metrics.alerts.push({
        type: 'storage_warning',
        message: 'Storage usage is above 90%',
        severity: 'high',
        timestamp: new Date()
      });
    }

    if (queuedOperations > 100) {
      metrics.alerts.push({
        type: 'queue_full',
        message: 'Large number of queued operations',
        severity: 'medium',
        timestamp: new Date()
      });
    }

    this.metrics.set(metrics.id, metrics);
    return metrics;
  }

  clearCache(configId: string, pattern?: string): number {
    const config = this.configs.get(configId);
    if (!config) return 0;

    const keysToDelete = Array.from(this.cache.keys()).filter(key => {
      if (!key.startsWith(`${config.userId}:`)) return false;
      if (pattern && !key.includes(pattern)) return false;
      return true;
    });

    keysToDelete.forEach(key => this.cache.delete(key));

    return keysToDelete.length;
  }

  exportOfflineData(configId: string): Promise<string> {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Configuration not found');
    }

    const data = {
      config,
      cache: Array.from(this.cache.entries()).filter(([key]) =>
        key.startsWith(`${config.userId}:`)
      ),
      queue: this.queues.get(config.userId)
    };

    return Promise.resolve(JSON.stringify(data, null, 2));
  }

  importOfflineData(configId: string, data: string): Promise<void> {
    try {
      const parsedData = JSON.parse(data);

      if (parsedData.config) {
        this.configs.set(configId, parsedData.config);
      }

      if (parsedData.cache) {
        parsedData.cache.forEach(([key, item]: [string, CachedItem]) => {
          this.cache.set(key, item);
        });
      }

      if (parsedData.queue) {
        this.queues.set(parsedData.queue.userId, parsedData.queue);
      }

      return Promise.resolve();
    } catch (error) {
      throw new Error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getConfig(id: string): OfflineConfig | undefined {
    return this.configs.get(id);
  }

  getQueue(userId: string): OfflineQueue | undefined {
    return this.queues.get(userId);
  }

  getMetrics(id: string): OfflineMetrics | undefined {
    return this.metrics.get(id);
  }

  getAllConfigs(): OfflineConfig[] {
    return Array.from(this.configs.values());
  }

  getAllQueues(): OfflineQueue[] {
    return Array.from(this.queues.values());
  }
}

export const offlineModeManager = new OfflineModeManager();