import { assertEquals, assertFalse } from "jsr:@std/assert";
import { delay } from "jsr:@std/async";
import { TTLCache, LazyLoadingCache, AutoRefreshBatchItemCache, AutoRefreshSingleItemCache } from "./ttl-cache.ts";

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

// LazyLoadingCache 的测试用例
Deno.test("LazyLoadingCache - 基本的获取操作", async () => {
  const fetchData = async (key: string) => {
    return { got: true, data: 100 };
  };
  
  const cache = new LazyLoadingCache(fetchData, {});
  const result = await cache.get("key1");
  
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }
});

Deno.test("LazyLoadingCache - 处理fetch失败的情况", async () => {
  const fetchData = async (key: string) => {
    return { got: false } as const;
  };
  
  const cache = new LazyLoadingCache(fetchData, {});
  const result = await cache.get("key1");
  
  assertFalse(result.found);
});

Deno.test("LazyLoadingCache - 并发请求测试", async () => {
  let fetchCount = 0;
  const fetchData = async (key: string) => {
    fetchCount++;
    await delay(50); // 模拟网络延迟
    return { got: true, data: 100 };
  };
  
  const cache = new LazyLoadingCache(fetchData, {});
  
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

Deno.test("LazyLoadingCache - TTL过期后重新获取", async () => {
  let fetchCount = 0;
  const fetchData = async (key: string) => {
    fetchCount++;
    return { got: true, data: fetchCount };
  };
  
  const cache = new LazyLoadingCache(fetchData, { defaultTTL: 100 });
  
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

Deno.test("LazyLoadingCache - 处理fetch抛出异常的情况", async () => {
  const fetchData = async (key: string) => {
    throw new Error("网络错误");
  };
  
  const cache = new LazyLoadingCache(fetchData, {});
  const result = await cache.get("key1");
  
  assertFalse(result.found);
});

Deno.test("LazyLoadingCache - 并发请求时处理异常", async () => {
  let fetchCount = 0;
  const fetchData = async (key: string) => {
    fetchCount++;
    throw new Error("网络错误");
  };
  
  const cache = new LazyLoadingCache(fetchData, {});
  
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

Deno.test("LazyLoadingCache - 手动设置缓存项", async () => {
  const fetchData = async (key: string) => {
    return { got: true, data: 999 };
  };
  
  const cache = new LazyLoadingCache(fetchData, { defaultTTL: 100 });
  
  // 手动设置缓存项
  cache.set("key1", 100);
  
  // 验证可以直接获取到手动设置的值
  let result = cache.getSync("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }
  
  // 等待过期
  await delay(150);
  
  // 验证过期后会重新获取
  result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 999);
  }
});

Deno.test("LazyLoadingCache - onFetchError 回调测试", async () => {
  let errorMessage = "";
  const expectedError = new Error("自定义错误");
  
  const fetchData = async (key: string) => {
    throw expectedError;
  };
  
  const cache = new LazyLoadingCache(fetchData, {
    onFetchError: (error: Error) => {
      errorMessage = error.message;
    }
  });
  
  // 触发错误
  const result = await cache.get("key1");
  
  // 验证错误回调被调用
  assertEquals(errorMessage, "自定义错误");
  
  // 验证返回未找到
  assertFalse(result.found);
});

Deno.test("LazyLoadingCache - 默认错误处理测试", async () => {
  // 保存原始的 console.error
  const originalConsoleError = console.error;
  let errorLogged = false;
  
  // 替换 console.error
  console.error = (...args: any[]) => {
    errorLogged = true;
  };
  
  try {
    const fetchData = async (key: string) => {
      throw new Error("测试错误");
    };
    
    const cache = new LazyLoadingCache(fetchData, {});
    
    // 触发错误
    const result = await cache.get("key1");
    
    // 验证错误被记录
    assertEquals(errorLogged, true);
    
    // 验证返回未找到
    assertFalse(result.found);
  } finally {
    // 恢复原始的 console.error
    console.error = originalConsoleError;
  }
});

// AutoRefreshBatchItemCache 的测试用例
Deno.test("AutoRefreshBatchItemCache - 基本的批量获取操作", async () => {
  const fetchAllData = async () => {
    return {
      entries: [
        ["key1", 100] as [string, number],
        ["key2", 200] as [string, number],
      ],
    };
  };

  const cache = new AutoRefreshBatchItemCache<string, number>(fetchAllData, {});
  await cache.fetchAll();

  const result1 = await cache.get("key1");
  const result2 = await cache.get("key2");

  assertEquals(result1.found, true);
  assertEquals(result2.found, true);
  if (result1.found) assertEquals(result1.value, 100);
  if (result2.found) assertEquals(result2.value, 200);

  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - 处理fetch失败的情况", async () => {
  const fetchAllData = async () => {
    throw new Error("网络错误");
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, {});
  
  // 验证 fetchAll 不会抛出异常
  await cache.fetchAll();
  
  // 验证不会写入缓存
  const result = await cache.get("key1");
  assertFalse(result.found);

  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - onFetchError 回调测试", async () => {
  let errorMessage = "";
  
  const fetchAllData = async () => {
    throw new Error("自定义错误");
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, {
    onFetchError: (error: Error) => {
      errorMessage = error.message;
    }
  });

  // 触发错误
  await cache.fetchAll();
  
  // 验证错误回调被调用
  assertEquals(errorMessage, "自定义错误");
  
  // 验证缓存操作仍然正常工作
  const result = await cache.get("someKey");
  assertFalse(result.found);

  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - TTL过期测试", async () => {
  const fetchAllData = async () => {
    return {
      entries: [["key1", 100] as [string, number]] ,
    };
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, { defaultTTL: 100 });
  await cache.fetchAll();

  // 验证刚设置的值可以被获取
  let result = await cache.get("key1");
  assertEquals(result.found, true);

  // 等待过期
  await delay(150);

  // 验证值已过期
  result = await cache.get("key1");
  assertFalse(result.found);

  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - 并发请求测试", async () => {
  let fetchCount = 0;
  const fetchAllData = async () => {
    fetchCount++;
    await delay(50); // 模拟网络延迟
    return {
      entries: [["key1", 100] as [string, number]],
    };
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, {});

  // 同时发起多个fetchAll请求
  const promises = [
    cache.fetchAll(),
    cache.fetchAll(),
    cache.fetchAll(),
  ];

  await Promise.all(promises);

  // 验证实际只发起了一次fetch
  assertEquals(fetchCount, 1);

  // 验证数据正确缓存
  const result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }

  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - 自动刷新测试", async () => {
  let fetchCount = 0;
  const fetchAllData = async () => {
    fetchCount++;
    return {
      entries: [["key1", fetchCount] as [string, number]],
    };
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, {
    refreshInterval: 100,
  });

  // 等待初始化获取完成
  await cache.fetchAll();
  assertEquals(fetchCount, 1);

  // 验证第一次获取的值
  let result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 1);

  // 等待刷新
  await delay(150);

  // 验证值已更新
  result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 2);

  // 清理定时器
  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - 手动设置和清理操作", async () => {
  const fetchAllData = async () => {
    return {
      entries: [["key1", 100] as [string, number]],
    };
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, {});
  await cache.fetchAll();

  // 手动设置新值
  cache.setUntilNextRefresh("key2", 200);

  // 验证两个值都存在
  let result1 = await cache.get("key1");
  let result2 = await cache.get("key2");
  assertEquals(result1.found && result1.value, 100);
  assertEquals(result2.found && result2.value, 200);

  // 测试删除操作
  cache.delete("key1");
  result1 = await cache.get("key1");
  assertFalse(result1.found);

  // 测试清空操作
  cache.clear();
  result2 = await cache.get("key2");
  assertFalse(result2.found);
  cache.shutdown();
});

Deno.test("AutoRefreshBatchItemCache - shutdown 方法测试", async () => {
  let fetchCount = 0;
  const fetchAllData = async () => {
    fetchCount++;
    return {
      entries: [["key1", fetchCount] as [string, number]],
    };
  };

  const cache = new AutoRefreshBatchItemCache(fetchAllData, {
    refreshInterval: 100,
  });

  // 等待初始化获取完成
  await cache.fetchAll();
  assertEquals(fetchCount, 1);

  // 调用 shutdown
  cache.shutdown();

  // 等待一段时间，确认不会继续刷新
  await delay(250);
  assertEquals(fetchCount, 1);

  // 验证缓存已被清空
  const result = await cache.get("key1");
  assertFalse(result.found);
});

Deno.test("AutoRefreshBatchItemCache - fetchOnStart 选项测试", async () => {
  let fetchCount = 0;
  const fetchAllData = async () => {
    fetchCount++;
    return {
      entries: [["key1", 100] as [string, number]],
    };
  };

  // 测试默认行为（fetchOnStart = true）
  const defaultCache = new AutoRefreshBatchItemCache(fetchAllData, {});
  assertEquals(fetchCount, 1); // 应该立即调用 fetchAllData
  defaultCache.shutdown();

  // 重置计数器
  fetchCount = 0;

  // 测试 fetchOnStart = false
  const cache = new AutoRefreshBatchItemCache(fetchAllData, {
    fetchOnStart: false
  });
  assertEquals(fetchCount, 0); // 不应该调用 fetchAllData

  // 验证数据尚未加载
  let result = await cache.get("key1");
  assertFalse(result.found);

  // 手动调用 fetchAll
  await cache.fetchAll();
  assertEquals(fetchCount, 1);

  // 验证数据已加载
  result = await cache.get("key1");
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }

  cache.shutdown();
});
  

// AutoRefreshSingleItemCache 的测试用例
Deno.test("AutoRefreshSingleItemCache - 基本的获取操作", async () => {
  const fetchData = async () => {
    return 100;
  };

  const cache = new AutoRefreshSingleItemCache<number>(fetchData, {});
  const result = await cache.get();
  
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }
  
  cache.shutdown();
});

Deno.test("AutoRefreshSingleItemCache - 处理fetch失败的情况", async () => {
  let errorCaught = false;
  const fetchData = async () => {
    throw new Error("网络错误");
  };

  const cache = new AutoRefreshSingleItemCache(fetchData, {
    onFetchError: (error: Error) => {
      errorCaught = true;
    }
  });

  const result = await cache.get();
  assertFalse(result.found);
  assertEquals(errorCaught, true);

  cache.shutdown();
});

Deno.test("AutoRefreshSingleItemCache - TTL过期测试", async () => {
  const fetchData = async () => {
    return 100;
  };

  const cache = new AutoRefreshSingleItemCache(fetchData, { defaultTTL: 100 });
  
  // 验证刚设置的值可以被获取
  let result = await cache.get();
  assertEquals(result.found, true);
  
  // 等待过期
  await delay(150);
  
  // 验证值已过期
  result = await cache.get();
  assertEquals(result.found, false);

  cache.shutdown();
});

Deno.test("AutoRefreshSingleItemCache - 自动刷新测试", async () => {
  let fetchCount = 0;
  const fetchData = async () => {
    fetchCount++;
    return fetchCount;
  };

  const cache = new AutoRefreshSingleItemCache(fetchData, {
    refreshInterval: 100,
  });

  // 验证第一次获取的值
  let result = await cache.get();
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 1);

  // 等待自动刷新
  await delay(150);

  // 验证值已更新
  result = await cache.get();
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 2);

  cache.shutdown();
});

Deno.test("AutoRefreshSingleItemCache - 手动设置和清理操作", async () => {
  const fetchData = async () => {
    return 100;
  };

  const cache = new AutoRefreshSingleItemCache(fetchData, { refreshInterval: 100 });

  // 验证自动获取的值
  let result = await cache.get();
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 100);

  // 手动设置值
  cache.setUntilNextRefresh(200);

  // 验证手动设置的值
  result = await cache.get();
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 200);

  // 到下一次自动刷新
  await delay(150);

  // 验证自动获取的值
  result = await cache.get();
  assertEquals(result.found, true);
  if (result.found) assertEquals(result.value, 100);

  cache.shutdown();
});

Deno.test("AutoRefreshSingleItemCache - fetchOnStart 选项测试", async () => {
  let fetchCount = 0;
  const fetchData = async () => {
    fetchCount++;
    return 100;
  };

  // 测试默认行为（fetchOnStart = true）
  const defaultCache = new AutoRefreshSingleItemCache(fetchData, {});
  assertEquals(fetchCount, 1); // 应该立即调用 fetchData
  defaultCache.shutdown();

  // 重置计数器
  fetchCount = 0;

  // 测试 fetchOnStart = false
  const cache = new AutoRefreshSingleItemCache(fetchData, {
    fetchOnStart: false
  });
  assertEquals(fetchCount, 0); // 不应该调用 fetchData

  // 验证数据尚未加载
  let result = await cache.getSync();
  assertFalse(result.found);

  // 手动调用 fetchAll
  await cache.fetchAll();
  assertEquals(fetchCount, 1);

  // 验证数据已加载
  result = await cache.get();
  assertEquals(result.found, true);
  if (result.found) {
    assertEquals(result.value, 100);
  }

  cache.shutdown();
});

