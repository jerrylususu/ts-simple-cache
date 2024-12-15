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

interface TTLCacheBackedWithFetchOptions extends TTLCacheOptions {
//   fetchData: (key: any) => Promise<FetchResult<any>>;
  // 未来可以添加更多选项
  // retryAttempts?: number;
  // retryDelay?: number;
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
   * @param options 设置选��，包含 ttl 和 maxSize 等配置
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
   * 获取缓存项，如果不存在或已过期则返回 undefined
   * @param key 键
   * @returns 如果存在且未过期则返回值，否则返回 undefined
   */
  getOrUndefined(key: K): V | undefined {
    const result = this.get(key);
    return result.found ? result.value : undefined;
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

export class TTLCacheBackedWithFetch<K, V> {
  private cache: TTLCache<K, V>;
  private pendingFetches: Map<K, PendingFetch<V>>;
  private fetchData: (key: K) => Promise<FetchResult<V>>;

  constructor(fetchData: (key: K) => Promise<FetchResult<V>>, options: TTLCacheBackedWithFetchOptions) {
    this.fetchData = fetchData;
    this.cache = new TTLCache<K, V>({
      defaultTTL: options.defaultTTL,
      maxSize: options.maxSize
    });
    this.pendingFetches = new Map();
  }

  /**
   * ��步获取缓存数据，如果数据不存在或已过期则返回未找到
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
    }).catch(_error => {
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
   * 异步获取数据，如果数据不存在则返回 undefined
   */
  async getOrUndefined(key: K): Promise<V | undefined> {
    const result = await this.get(key);
    return result.found ? result.value : undefined;
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
} 