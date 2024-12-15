export interface CacheHit<V> {
  found: true;
  value: V;
}

export interface CacheMiss {
  found: false;
}

type CacheResult<V> = CacheHit<V> | CacheMiss;

interface SetOptions {
  ttl?: number;
  // 未来可以添加其他选项，比如：
  // sliding?: boolean;
  // onExpire?: (key: K, value: V) => void;
}

interface TTLCacheOptions {
  defaultTTL?: number;
  maxSize?: number;
  // 未来可以添加更多选项
  // autoCleanup?: boolean;
  // cleanupInterval?: number;
}



export class TTLCache<K, V> {
  private cache: Map<K, { value: V; expireAt: number }>;
  private maxSize: number | undefined;
  private defaultTTL: number;

  constructor(options?: TTLCacheOptions) {
    this.cache = new Map();
    this.defaultTTL = options?.defaultTTL ?? 60 * 1000;
    this.maxSize = options?.maxSize;
  }

  /**
   * 设置缓存项
   * @param key 键
   * @param value 值
   * @param options 设置选项，包含 ttl 和 maxSize 等配置
   */
  set(key: K, value: V, options?: SetOptions): void {
    const ttl = options?.ttl ?? this.defaultTTL;
    const expireAt = Date.now() + ttl;
    
    // 如果设置了容量上限，并且达到上限（且不是更新已存在的键）
    if (this.maxSize && !this.cache.has(key) && this.cache.size >= this.maxSize) {
      // 删除最早添加的项目
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, { value, expireAt });
  }

  /**
   * 安全地获取缓存项，总是返回一个包含查找结果的对象
   * @param key 键
   * @returns 命中缓存时返回 {found: true, value: V}，未命中时返回 {found: false}
   */
  get(key: K): CacheResult<V> {
    const item = this.cache.get(key);
    
    if (!item) {
      return { found: false };
    }

    if (Date.now() > item.expireAt) {
      this.cache.delete(key);
      return { found: false };
    }

    return { found: true, value: item.value };
  }

  /**
   * 删除缓存项
   * @param key 键
   */
  delete(key: K): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存项
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理所有过期的缓存项
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expireAt) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * 表示正在进行的数据获取操作
 */
interface PendingFetch<V> {
  promise: Promise<CacheResult<V>>;
  refCount: number;
}

/**
 * 远程数据获取的结果类型
 */
interface FetchSuccess<V> {
  got: true;
  data: V;
}

interface FetchNotFound {
  got: false;
}

type FetchResult<V> = FetchSuccess<V> | FetchNotFound;

interface TTLCacheBackedWithFetchOptions extends TTLCacheOptions {
  onFetchError?: (error: Error) => void;
}

export class TTLCacheBackedWithFetch<K, V> {
  private cache: TTLCache<K, V>;
  private pendingFetches: Map<K, PendingFetch<V>>;
  private fetchData: (key: K) => Promise<FetchResult<V>>;
  private readonly onFetchError: (error: Error) => void;

  constructor(fetchData: (key: K) => Promise<FetchResult<V>>, options: TTLCacheBackedWithFetchOptions) {
    this.fetchData = fetchData;
    this.cache = new TTLCache<K, V>({
      defaultTTL: options.defaultTTL,
      maxSize: options.maxSize
    });
    this.pendingFetches = new Map();
    this.onFetchError = options.onFetchError ?? ((error: Error) => {
      console.error('Failed to fetch data:', error);
    });
  }

  /**
   * 步获取缓存数据，如果数据不存在或已过期则返回未找到
   */
  getSync(key: K): CacheResult<V> {
    return this.cache.get(key);
  }

  /**
   * 异步获取数据，如果缓存中不存在或已过期，则调用 fetchData 获取新数据
   * @returns 返回 CacheResult<V>，与 TTLCache 保持一致的接口
   */
  async get(key: K): Promise<CacheResult<V>> {
    // 先检查缓存
    const cached = this.cache.get(key);
    if (cached.found) {
      return cached;
    }

    // 检查是否有正在进行的获取
    const pendingFetch = this.pendingFetches.get(key);
    if (pendingFetch) {
      pendingFetch.refCount++;
      try {
        const result = await pendingFetch.promise;
        return result;
      } catch {
        return { found: false };
      }
    }

    const fetchPromise = this.fetchData(key).then(result => {
      if (!result.got) {
        return { found: false } as CacheMiss;
      }
      this.cache.set(key, result.data);
      return { found: true, value: result.data } as CacheHit<V>;
    }).catch(error => {
      this.onFetchError(error);
      this.pendingFetches.delete(key);
      return { found: false } as CacheMiss;
    }).finally(() => {
      this.pendingFetches.delete(key);
    });

    this.pendingFetches.set(key, {
      promise: fetchPromise,
      refCount: 1
    });

    return fetchPromise;
  }

  /**
   * 删除缓存项
   */
  delete(key: K): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    this.cache.cleanup();
  }

  /**
   * 手动设置缓存项
   * @param key 键
   * @param value 值
   * @param options 设置选项，包含 ttl 等配置
   */
  set(key: K, value: V, options?: SetOptions): void {
    this.cache.set(key, value, options);
  }
}

/**
 * 批量获取数据的结果类型
 */
interface BatchFetchResult<K, V> {
  entries: [K, V][];
}

interface TTLCacheWithBatchFetchOptions<K> extends TTLCacheOptions {
  refreshInterval?: number; // 自动刷新间隔，单位毫秒
  onFetchError?: (error: Error) => void;
  fetchOnStart?: boolean; // 新增：是否在创建时立即获取数据
}

export class TTLCacheWithBatchFetch<K, V> {
  private cache: TTLCache<K, V>;
  private fetchAllData: () => Promise<BatchFetchResult<K, V>>;
  private refreshInterval: number;
  private currentFetch: Promise<void> | null = null;
  private timer: number | null = null;
  private readonly onFetchError: (error: Error) => void;

  constructor(
    fetchAllData: () => Promise<BatchFetchResult<K, V>>, 
    options: TTLCacheWithBatchFetchOptions<K>
  ) {
    this.fetchAllData = fetchAllData;
    this.cache = new TTLCache<K, V>({
      defaultTTL: options.defaultTTL,
      maxSize: options.maxSize
    });
    this.refreshInterval = options.refreshInterval ?? 5 * 60 * 1000; // 默认5分钟
    
    // 根据 fetchOnStart 选项决定是否立即获取数据
    if (options.fetchOnStart ?? true) {
      this.fetchAll();
    }
    
    // 设置定时刷新
    if (this.refreshInterval > 0) {
      this.timer = setInterval(() => {
        this.fetchAll();
      }, this.refreshInterval);
    }

    this.onFetchError = options.onFetchError ?? ((_error: Error) => {
      console.error('Failed to fetch all data:', _error);
    });
  }

  /**
   * 同步获取数据，如果正在刷新则返回未找到
   */
  getSync(key: K): CacheResult<V> {
    return this.cache.get(key);
  }

  /**
   * 异步获取数据，如果正在刷新则等待刷新完成
   */
  async get(key: K): Promise<CacheResult<V>> {
    // 如果有正在进行的获取，先等待其完成
    if (this.currentFetch) {
      await this.currentFetch;
    }
    return this.cache.get(key);
  }

  /**
   * 手动触发全量数据获取
   */
  async fetchAll(): Promise<void> {
    // 如果已经有正在进行的获取，直接返回该 Promise
    if (this.currentFetch) {
      return this.currentFetch;
    }

    // 创建新的获取请求
    this.currentFetch = this.doFetchAll();
    
    try {
      await this.currentFetch;
    } finally {
      this.currentFetch = null;
    }
  }

  private async doFetchAll(): Promise<void> {
    let result: BatchFetchResult<K, V>;
    try {
    result = await this.fetchAllData();
    } catch (error) {
      this.onFetchError(error as Error);
      return;
    }

    // 清空当前缓存
    this.cache.clear();
    
    // 将新数据写入缓存
    for (const [key, value] of result.entries) {
    this.cache.set(key, value);
    }
  }

  /**
   * 手动设置缓存项
   */
  setUntilNextRefresh(key: K, value: V, options?: SetOptions): void {
    this.cache.set(key, value, options);
  }

  /**
   * 删除缓存项
   */
  delete(key: K): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    this.cache.cleanup();
  }

  /**
   * 停止自动刷新并清理资源
   */
  shutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cache.clear();
  }
}

interface TTLCacheWithSingleFetchOptions extends TTLCacheOptions {
  refreshInterval?: number;
  onFetchError?: (error: Error) => void;
  fetchOnStart?: boolean;
}

export class TTLCacheWithSingleFetch<V> {
  private static readonly SINGLE_KEY = Symbol('SINGLE_CACHE_KEY');
  private cache: TTLCacheWithBatchFetch<symbol, V>;

  constructor(
    fetchData: () => Promise<V>,
    options: TTLCacheWithSingleFetchOptions
  ) {
    this.cache = new TTLCacheWithBatchFetch<symbol, V>(
      async () => ({
        entries: [[TTLCacheWithSingleFetch.SINGLE_KEY, await fetchData()]]
      }),
      options
    );
  }

  /**
   * 同步获取数据，如果正在刷新则返回未找到
   */
  getSync(): CacheResult<V> {
    return this.cache.getSync(TTLCacheWithSingleFetch.SINGLE_KEY);
  }

  /**
   * 异步获取数据，如果正在刷新则等待刷新完成
   */
  async get(): Promise<CacheResult<V>> {
    return this.cache.get(TTLCacheWithSingleFetch.SINGLE_KEY);
  }
  /**
   * 手动设置缓存值
   */
  setUntilNextRefresh(value: V, options?: SetOptions): void {
    this.cache.setUntilNextRefresh(TTLCacheWithSingleFetch.SINGLE_KEY, value, options);
  }

  /**
   * 手动触发数据获取
   */
  async fetchAll(): Promise<void> {
    return this.cache.fetchAll();
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    this.cache.cleanup();
  }

  /**
   * 停止自动刷新并清理资源
   */
  shutdown(): void {
    this.cache.shutdown();
  }
} 