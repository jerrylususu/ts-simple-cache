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
import { TTLCacheBackedWithFetch } from './ttl-cache.ts';

const fetchData = async (key: string) => {
  const response = await fetch(`https://api.example.com/data/${key}`);
  if (response.ok) {
    const data = await response.json();
    return { got: true, data };
  }
  return { got: false };
};

const cache = new TTLCacheBackedWithFetch(fetchData, {
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
- `getOrUndefined(key: K): V | undefined`: 获取缓存项，不存在返回 undefined
- `delete(key: K)`: 删除缓存项
- `clear()`: 清空所有缓存
- `cleanup()`: 清理过期项目

### TTLCacheBackedWithFetch

#### 构造函数选项

```typescript
interface TTLCacheBackedWithFetchOptions {
  defaultTTL?: number;    // 默认过期时间（毫秒）
  maxSize?: number;       // 最大缓存项数量
}
```

#### 方法

- `getSync(key: K): CacheResult<V>`: 同步获取缓存数据
- `get(key: K): Promise<CacheResult<V>>`: 异步获取数据
- `getOrUndefined(key: K): Promise<V | undefined>`: 异步获取数据，不存在返回 undefined
- `delete(key: K)`: 删除缓存项
- `clear()`: 清空所有缓存
- `cleanup()`: 清理过期项目

## 使用示例

```typescript
// 基础缓存使用
const cache = new TTLCache<string, number>();
cache.set('key1', 100, { ttl: 1000 });  // 1秒后过期

// 异步数据获取和缓存
const cache = new TTLCacheBackedWithFetch(async (key) => {
  try {
    const response = await fetch(`https://api.example.com/data/${key}`);
    const data = await response.json();
    return { got: true, data };
  } catch {
    return { got: false };
  }
}, {
  defaultTTL: 60000,
  maxSize: 1000
});

// 并发请求会自动合并
const [result1, result2] = await Promise.all([
  cache.get('key1'),
  cache.get('key1')  // 不会重复请求
]);
```

## 注意事项

- TTL 时间单位为毫秒
- 缓存大小超出 maxSize 时，会删除最早添加的项目
- 异步获取数据时会自动合并并发请求
- 数据获取失败时返回 `{ found: false }`
