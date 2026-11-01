#include <node_api.h>
#import <CoreFoundation/CoreFoundation.h>

// 普通 Node 没有 Cocoa 主循环，NSPasteboard provider 的读取回调会一直等待。
// 只在原生异步粘贴期间处理一次已就绪的主循环事件，不另建线程或输入路径。
static napi_value Pump(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, true);
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value pump;
  napi_create_function(env, "pump", NAPI_AUTO_LENGTH, Pump, nullptr, &pump);
  napi_set_named_property(env, exports, "pump", pump);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
