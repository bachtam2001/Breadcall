/**
 * NDI Native Addon - C++ binding for NewTek NDI SDK
 *
 * This is a placeholder/template file. To build the actual addon:
 * 1. Install NewTek NDI SDK from https://ndi.video/
 * 2. Set NDI_SDK_DIR environment variable
 * 3. Install build dependencies: npm install nan --save-dev
 * 4. Run: npm run build-ndi
 *
 * Windows: Requires Visual Studio Build Tools
 * macOS: Requires Xcode Command Line Tools
 * Linux: Requires build-essential and libndi-dev
 */

#include <node.h>
#include <nan.h>
#include <Processing.NDI.Find.h>
#include <Processing.NDI.Send.h>
#include <map>
#include <string>

using namespace v8;

// Global NDI instances
static std::map<std::string, NDIlib_send_instance_t> sendInstances;

// Initialize NDI library
void Initialize(const Nan::FunctionCallbackInfo<Value>& args) {
  if (!NDIlib_initialize()) {
    Nan::ThrowError("Failed to initialize NDI library");
    return;
  }
  args.GetReturnValue().Set(Nan::True());
}

// Create NDI send instance
void CreateSend(const Nan::FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 1 || !args[0]->IsObject()) {
    Nan::ThrowTypeError("Expected settings object");
    return;
  }

  Local<Object> settings = args[0].As<Object>();

  // Get name from settings
  Local<Value> nameValue = Nan::Get(settings, Nan::New("name").ToLocalChecked()).ToLocalChecked();
  String::Utf8Value name(nameValue);

  // Create NDI send settings
  NDIlib_send_create_t createSettings;
  createSettings.p_ndi_name = *name;
  createSettings.p_groups = nullptr;
  createSettings.clock_video = false;
  createSettings.clock_audio = false;

  // Create send instance
  NDIlib_send_instance_t sendInstance = NDIlib_send_create(&createSettings);

  if (!sendInstance) {
    Nan::ThrowError("Failed to create NDI send instance");
    return;
  }

  // Store instance
  std::string peerId = std::string(*name);
  sendInstances[peerId] = sendInstance;

  // Return instance ID
  args.GetReturnValue().Set(Nan::New(peerId).ToLocalChecked());
}

// Destroy NDI send instance
void DestroySend(const Nan::FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 1 || !args[0]->IsString()) {
    Nan::ThrowTypeError("Expected peer ID string");
    return;
  }

  String::Utf8Value peerId(args[0]);
  std::string id(*peerId);

  auto it = sendInstances.find(id);
  if (it != sendInstances.end()) {
    NDIlib_send_destroy(it->second);
    sendInstances.erase(it);
  }

  args.GetReturnValue().Set(Nan::True());
}

// Send video frame
void SendVideo(const Nan::FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 2) {
    Nan::ThrowTypeError("Expected peer ID and frame data");
    return;
  }

  String::Utf8Value peerId(args[0]);
  std::string id(*peerId);

  auto it = sendInstances.find(id);
  if (it == sendInstances.end()) {
    Nan::ThrowError("Send instance not found");
    return;
  }

  // Get frame data (Buffer with raw BGRA frames)
  if (!args[1]->IsObject()) {
    Nan::ThrowTypeError("Expected frame data object");
    return;
  }

  // In a real implementation, extract frame data from the buffer
  // and send via NDIlib_send_send_video_async

  args.GetReturnValue().Set(Nan::True());
}

// Send audio samples
void SendAudio(const Nan::FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 2) {
    Nan::ThrowTypeError("Expected peer ID and audio data");
    return;
  }

  String::Utf8Value peerId(args[0]);
  std::string id(*peerId);

  auto it = sendInstances.find(id);
  if (it == sendInstances.end()) {
    Nan::ThrowError("Send instance not found");
    return;
  }

  // In a real implementation, extract audio samples and send
  // via NDIlib_send_send_audio

  args.GetReturnValue().Set(Nan::True());
}

// Cleanup NDI library
void Cleanup(const Nan::FunctionCallbackInfo<Value>& args) {
  // Destroy all send instances
  for (auto& pair : sendInstances) {
    NDIlib_send_destroy(pair.second);
  }
  sendInstances.clear();

  NDIlib_destroy();
  args.GetReturnValue().Set(Nan::True());
}

// Module initialization
NAN_MODULE_INIT(InitAll) {
  Nan::Set(target, Nan::New("initialize").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(Initialize)).ToLocalChecked());

  Nan::Set(target, Nan::New("createSend").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(CreateSend)).ToLocalChecked());

  Nan::Set(target, Nan::New("destroySend").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(DestroySend)).ToLocalChecked());

  Nan::Set(target, Nan::New("sendVideo").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(SendVideo)).ToLocalChecked());

  Nan::Set(target, Nan::New("sendAudio").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(SendAudio)).ToLocalChecked());

  Nan::Set(target, Nan::New("cleanup").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(Cleanup)).ToLocalChecked());
}

NODE_MODULE(ndi_native, InitAll)
