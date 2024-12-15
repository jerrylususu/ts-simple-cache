import { assertEquals, assertFalse } from "jsr:@std/assert";
import { delay } from "jsr:@std/async";
import { TTLCache, TTLCacheBackedWithFetch } from "./ttl-cache.ts";

// TTLCache 的测试用例
Deno.test("TTLCache - 基本的设置和获取操作", () => {
  const cache = new TTLCache<string, number>();
  cache.set("key1", 100);
  
  const result = cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }
});

Deno.test("TTLCache - 处理不存在的键", () => {
  const cache = new TTLCache<string, number>();
  const result = cache.get("nonexistent");
  assertFalse(result.found);
});

Deno.test("TTLCache - TTL过期测试", async () => {
  const cache = new TTLCache<string, number>({ defaultTTL: 100 }); // 100ms TTL
  cache.set("key1", 100);
  
  // 验证刚设置的值可以被获取
  let result = cache.get("key1");
  assertEquals(result.found, true);
  
  // 等待过期
  await delay(150);
  
  // 验证值已过期
  result = cache.get("key1");
  assertFalse(result.found);
});

Deno.test("TTLCache - maxSize限制测试", () => {
  const cache = new TTLCache<string, number>({ maxSize: 2 });
  
  cache.set("key1", 100);
  cache.set("key2", 200);
  cache.set("key3", 300); // 这应该会导致key1被移除
  
  assertFalse(cache.get("key1").found);
  assertEquals(cache.get("key2").found, true);
  assertEquals(cache.get("key3").found, true);
});

// TTLCacheBackedWithFetch 的测试用例
Deno.test("TTLCacheBackedWithFetch - 基本的获取操作", async () => {
  const fetchData = async (key: string) => {
    return { got: true, data: 100 };
  };
  
  const cache = new TTLCacheBackedWithFetch(fetchData, {});
  const result = await cache.get("key1");
  
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }
});

Deno.test("TTLCacheBackedWithFetch - 处理fetch失败的情况", async () => {
  const fetchData = async (key: string) => {
    return { got: false } as const;
  };
  
  const cache = new TTLCacheBackedWithFetch(fetchData, {});
  const result = await cache.get("key1");
  
  assertFalse(result.found);
});

Deno.test("TTLCacheBackedWithFetch - 并发请求测试", async () => {
  let fetchCount = 0;
  const fetchData = async (key: string) => {
    fetchCount++;
    await delay(50); // 模拟网络延迟
    return { got: true, data: 100 };
  };
  
  const cache = new TTLCacheBackedWithFetch(fetchData, {});
  
  // 同时发起多个请求
  const promises = [
    cache.get("key1"),
    cache.get("key1"),
    cache.get("key1")
  ];
  
  const results = await Promise.all(promises);
  
  // 验证所有请求都成功
  results.forEach(result => {
    assertEquals(result.found, true);
    if (result.found) {
      assertEquals(result.value, 100);
    }
  });
  
  // 验证实际只发起了一次fetch
  assertEquals(fetchCount, 1);
});

Deno.test("TTLCacheBackedWithFetch - TTL过期后重新获取", async () => {
  let fetchCount = 0;
  const fetchData = async (key: string) => {
    fetchCount++;
    return { got: true, data: fetchCount };
  };
  
  const cache = new TTLCacheBackedWithFetch(fetchData, { defaultTTL: 100 });
  
  // 第一次获取
  let result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 1);
  }
  
  // 等待过期
  await delay(150);
  
  // 第二次获取，应该触发新的fetch
  result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 2);
  }
  
  assertEquals(fetchCount, 2);
});

Deno.test("TTLCacheBackedWithFetch - 处理fetch抛出异常的情况", async () => {
  const fetchData = async (key: string) => {
    throw new Error("网络错误");
  };
  
  const cache = new TTLCacheBackedWithFetch(fetchData, {});
  const result = await cache.get("key1");
  
  assertFalse(result.found);
});

Deno.test("TTLCacheBackedWithFetch - 并发请求时处理异常", async () => {
  let fetchCount = 0;
  const fetchData = async (key: string) => {
    fetchCount++;
    throw new Error("网络错误");
  };
  
  const cache = new TTLCacheBackedWithFetch(fetchData, {});
  
  // 同时发起多个请求
  const promises = [
    cache.get("key1"),
    cache.get("key1"),
    cache.get("key1")
  ];
  
  const results = await Promise.all(promises);
  
  // 验证所有请求都返回未找到
  results.forEach(result => {
    assertFalse(result.found);
  });
  
  // 验证实际只发起了一次fetch
  assertEquals(fetchCount, 1);
}); 