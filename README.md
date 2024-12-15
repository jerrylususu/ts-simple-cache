# TTL Cache

一个简单但功能强大的带有 TTL (Time-To-Live) 的缓存实现，支持基本缓存操作和异步数据获取。

## 特性

- 支持 TTL（存活时间）设置
- 可配置缓存大小上限
- 支持异步数据获取和缓存
- 防止缓存穿透
- 并发请求合并

## 快速开始

```typescript
// 基本用法
import { TTLCache } from './ttl-cache.ts';

const cache = new TTLCache<string, number>({
  defaultTTL: 5000,  // 5秒过期
  maxSize: 1000      // 最多存储1000个项目
});

// 设置缓存
cache.set('key1', 100);

// 获取缓存
const result = cache.get('key1');
if (result.found) {
  console.log(result.value);  // 100
}

// 带异步数据获取的用法
import { LazyLoadingCache } from './ttl-cache.ts';

const fetchData = async (key: string) => {
  const response = await fetch(`https://api.example.com/data/${key}`);
  if (response.ok) {
    const data = await response.json();
    return { got: true, data };
  }
  return { got: false };
};

const cache = new LazyLoadingCache(fetchData, {
  defaultTTL: 60000,  // 1分钟过期
  maxSize: 1000
});

// 异步获取数据
const data = await cache.get('key1');
if (data.found) {
  console.log(data.value);
}
```

## API 文档

### TTLCache

#### 构造函数选项

```typescript
interface TTLCacheOptions {
  defaultTTL?: number;    // 默认过期时间（毫秒）
  maxSize?: number;       // 最大缓存项数量
}
```

#### 方法

- `set(key: K, value: V, options?: SetOptions)`: 设置缓存项
- `get(key: K): CacheResult<V>`: 获取缓存项
- `delete(key: K)`: 删除缓存项
- `clear()`: 清空所有缓存
- `cleanup()`: 清理过期项目

### LazyLoadingCache

#### 构造函数选项

```typescript
interface LazyLoadingCacheOptions {
  defaultTTL?: number;    // 默认过期时间（毫秒）
  maxSize?: number;       // 最大缓存项数量
  onFetchError?: (error: Error) => void;  // 获取数据失败时的错误处理回调
}
```

#### 方法

- `getSync(key: K): CacheResult<V>`: 同步获取缓存数据
- `get(key: K): Promise<CacheResult<V>>`: 异步获取数据
- `delete(key: K)`: 删除缓存项
- `clear()`: 清空所有缓存
- `cleanup()`: 清理过期项目

### AutoRefreshBatchItemCache

用于批量获取和缓存数据的实现。适用于需要定期刷新全量数据的场景。

#### 构造函数选项

```typescript
interface AutoRefreshBatchItemCacheOptions<K> {
  defaultTTL?: number;         // 默认过期时间（毫秒）
  maxSize?: number;            // 最大缓存项数量
  refreshInterval?: number;    // 自动刷新间隔（毫秒）
  onFetchError?: (error: Error) => void;  // 获取数据出错时的回调
  fetchOnStart?: boolean;      // 是否在创建时立即获取数据
}
```

#### 方法

- `getSync(key: K): CacheResult<V>`: 同步获取缓存数据
- `get(key: K): Promise<CacheResult<V>>`: 异步获取数据
- `fetchAll(): Promise<void>`: 手动触发全量数据获取
- `setUntilNextRefresh(key: K, value: V, options?: SetOptions)`: 手动设置缓存项（下次刷新前有效）
- `delete(key: K)`: 删除缓存项
- `clear()`: 清空所有缓存
- `cleanup()`: 清理过期项目
- `shutdown()`: 停止自动刷新并清理资源

### AutoRefreshSingleItemCache

用于缓存单个值的实现。适用于需要定期刷新单个数据源的场景。

#### 构造函数选项

```typescript
interface AutoRefreshSingleItemCache {
  defaultTTL?: number;         // 默认过期时间（毫秒）
  maxSize?: number;            // 最大缓存项数量
  refreshInterval?: number;    // 自动刷新间隔（毫秒）
  onFetchError?: (error: Error) => void;  // 获取数据出错时的回调
  fetchOnStart?: boolean;      // 是否在创建时立即获取数据
}
```

#### 方法

- `getSync(): CacheResult<V>`: 同步获取缓存数据
- `get(): Promise<CacheResult<V>>`: 异步获取数据
- `fetchAll(): Promise<void>`: 手动触发数据获取
- `setUntilNextRefresh(value: V, options?: SetOptions)`: 手动设置缓存值（下次刷新前有效）
- `clear()`: 清空缓存
- `cleanup()`: 清理过期数据
- `shutdown()`: 停止自动刷新并清理资源

## 使用示例

```typescript
// 基础缓存使用
const cache = new TTLCache<string, number>();
cache.set('key1', 100, { ttl: 1000 });  // 1秒后过期

// 异步数据获取和缓存
const cache = new LazyLoadingCache(async (key) => {
  try {
    const response = await fetch(`https://api.example.com/data/${key}`);
    const data = await response.json();
    return { got: true, data };
  } catch {
    return { got: false };
  }
}, {
  defaultTTL: 60000,
  maxSize: 1000,
  onFetchError: (error) => {
    console.error('数据获取失败:', error);
    // 可以在这里添加错误监控或其他处理逻辑
  }
});

// 并发请求会自动合并
const [result1, result2] = await Promise.all([
  cache.get('key1'),
  cache.get('key1')  // 不会重复请求
]);

// 批量获取数据的缓存示例
const batchCache = new AutoRefreshBatchItemCache(
  async () => ({
    entries: [
      ['key1', 'value1'],
      ['key2', 'value2']
    ]
  }),
  {
    defaultTTL: 60000,        // 1分钟过期
    refreshInterval: 300000,  // 5分钟自动刷新
    fetchOnStart: true,       // 创建时立即获取数据
    onFetchError: (error) => console.error('获取数据失败:', error)
  }
);

// 单值缓存示例
const singleCache = new AutoRefreshSingleItemCache(
  async () => {
    const response = await fetch('https://api.example.com/data');
    return response.json();
  },
  {
    defaultTTL: 60000,        // 1分钟过期
    refreshInterval: 300000,  // 5分钟自动刷新
    onFetchError: (error) => console.error('获取数据失败:', error)
  }
);

// 使用批量缓存
const result1 = await batchCache.get('key1');
if (result1.found) {
  console.log(result1.value);  // 'value1'
}

// 使用单值缓存
const result2 = await singleCache.get();
if (result2.found) {
  console.log(result2.value);  // API返回的数据
}

// 记得在不需要时关闭自动刷新
batchCache.shutdown();
singleCache.shutdown();
```

## 注意事项

- TTL 时间单位为毫秒
- 缓存大小超出 maxSize 时，会删除最早添加的项目
- 异步获取数据时会自动合并并发请求
- 数据获取失败时返回 `{ found: false }`
- `AutoRefreshBatchItemCache` 和 `AutoRefreshSingleItemCache` 支持自动定时刷新数据
- 使用这两个类时，记得在不需要时调用 `shutdown()` 方法停止自动刷新
- `fetchOnStart` 选项可以控制是否在创建缓存实例时立即获取数据
- 可以通过 `onFetchError` 回调处理数据获取失败的情况
