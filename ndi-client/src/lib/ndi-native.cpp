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

// Send video frame (BGRA format)
void SendVideo(const Nan::FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 3) {
    Nan::ThrowTypeError("Expected peer ID, frame data, width, and height");
    return;
  }

  String::Utf8Value peerId(args[0]);
  std::string id(*peerId);

  auto it = sendInstances.find(id);
  if (it == sendInstances.end()) {
    Nan::ThrowError("Send instance not found");
    return;
  }

  NDIlib_send_instance_t sendInstance = it->second;

  // Get frame data (Buffer with raw BGRA frames)
  if (!args[1]->IsObject()) {
    Nan::ThrowTypeError("Expected frame data buffer");
    return;
  }

  Local<Object> frameBuffer = args[1].As<Object>();
  char* data = node::Buffer::Data(frameBuffer);
  size_t size = node::Buffer::Length(frameBuffer);

  // Get width and height
  int width = Nan::To<int>(args[2]).FromJust();
  int height = Nan::To<int>(args[3]).FromJust();

  // Setup NDI video frame
  NDIlib_video_frame_v2_t videoFrame;
  videoFrame.xres = width;
  videoFrame.yres = height;
  videoFrame.FourCC = NDIlib_FourCC_type_BGRA;
  videoFrame.frame_rate_N = 30;
  videoFrame.frame_rate_D = 1;
  videoFrame.picture_aspect_ratio = (float)width / (float)height;
  videoFrame.frame_format_type = NDIlib_frame_format_type_progressive;
  videoFrame.timecode = NDIlib_video_frame_timecode_sent_now;

  // Calculate line stride
  videoFrame.line_stride_in_bytes = width * 4; // BGRA = 4 bytes per pixel
  videoFrame.p_data = data;
  videoFrame.data_size_in_bytes = size;

  // Send video frame asynchronously
  NDIlib_send_send_video_async_v2(sendInstance, &videoFrame);

  args.GetReturnValue().Set(Nan::True());
}

// Send audio samples (FLTP - Float Planar)
void SendAudio(const Nan::FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 4) {
    Nan::ThrowTypeError("Expected peer ID, audio data, sample rate, and channel count");
    return;
  }

  String::Utf8Value peerId(args[0]);
  std::string id(*peerId);

  auto it = sendInstances.find(id);
  if (it == sendInstances.end()) {
    Nan::ThrowError("Send instance not found");
    return;
  }

  NDIlib_send_instance_t sendInstance = it->second;

  // Get audio data (Buffer with raw Float32 samples)
  if (!args[1]->IsObject()) {
    Nan::ThrowTypeError("Expected audio data buffer");
    return;
  }

  Local<Object> audioBuffer = args[1].As<Object>();
  float* data = reinterpret_cast<float*>(node::Buffer::Data(audioBuffer));
  size_t size = node::Buffer::Length(audioBuffer);

  int sampleRate = Nan::To<int>(args[2]).FromJust();
  int channels = Nan::To<int>(args[3]).FromJust();
  int samples = size / sizeof(float) / channels;

  // Setup NDI audio frame
  NDIlib_audio_frame_v2_t audioFrame;
  audioFrame.sample_rate = sampleRate;
  audioFrame.no_channels = channels;
  audioFrame.no_samples = samples;
  audioFrame.timecode = NDIlib_audio_frame_timecode_sent_now;
  audioFrame.channel_type = NDIlib_channel_type_standard_channels;
  audioFrame.frame_format_type = NDIlib_frame_format_type_interleaved;

  // Interleaved audio data
  audioFrame.p_data = data;
  audioFrame.data_size_in_bytes = size;

  // Send audio frame
  NDIlib_send_send_audio_v2(sendInstance, &audioFrame);

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
