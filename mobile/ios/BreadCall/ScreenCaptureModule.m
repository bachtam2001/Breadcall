//
//  ScreenCaptureModule.m
//  BreadCall
//
//  iOS Screen Capture Module using ReplayKit
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <ReplayKit/ReplayKit.h>

@interface ScreenCaptureModule : RCTEventEmitter <RCTBridgeModule>
@end

@implementation ScreenCaptureModule {
    RCTPromiseResolveBlock _capturePromise;
    RCTPromiseRejectBlock _captureReject;
    BOOL _isCapturing;
    NSInteger _streamId;
}

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onCaptureStarted", @"onCaptureStopped"];
}

- (NSDictionary *)constantsToExport {
    return @{
        @"REQUEST_CODE": @1001
    };
}

RCT_EXPORT_MODULE(ScreenCaptureModule)

RCT_EXPORT_METHOD(startCapture:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    if (_isCapturing) {
        reject(@"ALREADY_CAPTURE", @"Screen capture already in progress", nil);
        return;
    }

    _capturePromise = resolve;
    _captureReject = reject;

    if (@available(iOS 11.0, *)) {
        NSString *bundleIdentifier = options[@"bundleIdentifier"] ?: @"com.breadcall.BroadcastUploadExtension";

        // Show broadcast picker
        [RPSystemBroadcastPickerView showForExtension:@[bundleIdentifier]
            completionHandler:^UIViewController * _Nonnull(UIImagePickerController * _Nonnull picker) {
            picker.preferredFrameRate = [options[@"frameRate"] floatValue] ?: 30.0f;
            picker.preferredVideoDimensions = RPVideoDimensionMake(
                [options[@"width"] integerValue] ?: 1280,
                [options[@"height"] integerValue] ?: 720
            );
            return picker;
        }];

        // Observe broadcast start notification
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(broadcastStarted:)
                                                     name:@"BroadcastStarted"
                                                   object:nil];

        // Return immediately - actual start handled by extension
        NSDictionary *result = @{
            @"streamId": @0,
            @"width": @(options[@"width"] ?: @1280),
            @"height": @(options[@"height"] ?: @720),
            @"frameRate": @(options[@"frameRate"] ?: @30)
        };

        resolve(result);
    } else {
        reject(@"NOT_SUPPORTED", @"ReplayKit not available on this iOS version", nil);
    }
}

RCT_EXPORT_METHOD(stopCapture:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 11.0, *)) {
        [RPSystemBroadcastPickerView hide];

        // Post notification to stop broadcast
        [[NSNotificationCenter defaultCenter] postNotificationName:@"StopBroadcast" object:nil];

        _isCapturing = NO;

        [self sendEventWithName:@"onCaptureStopped" body:@{@"stopped": @YES}];

        resolve(@{@"stopped": @YES});
    } else {
        reject(@"NOT_SUPPORTED", @"ReplayKit not available", nil);
    }
}

RCT_EXPORT_METHOD(startBroadcast:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self startCapture:options resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(stopBroadcast:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self stopCapture:resolve rejecter:reject];
}

- (void)broadcastStarted:(NSNotification *)notification {
    _isCapturing = YES;
    _streamId = (NSInteger)([[NSDate date] timeIntervalSince1970] * 1000) % INT32_MAX;

    if (_capturePromise) {
        NSDictionary *result = @{
            @"streamId": @(_streamId),
            @"width": @1280,
            @"height": @720,
            @"frameRate": @30
        };

        _capturePromise(result);
        _capturePromise = nil;
    }

    [self sendEventWithName:@"onCaptureStarted" body:@{
        @"streamId": @(_streamId),
        @"width": @1280,
        @"height": @720,
        @"frameRate": @30
    }];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
