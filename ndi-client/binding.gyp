{
  "targets": [
    {
      "target_name": "ndi-native",
      "sources": [
        "src/lib/ndi-native.cpp"
      ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")",
        "$(NDI_SDK_DIR)/Frameworks/NDI® SDK.framework/Headers"
      ],
      "libraries": [
        "$(NDI_SDK_DIR)/Frameworks/NDI® SDK.framework/NDI® SDK"
      ],
      "conditions": [
        ['OS=="win"', {
          "include_dirs": [
            "$(NDI_SDK_DIR)/Include"
          ],
          "libraries": [
            "$(NDI_SDK_DIR)/Lib/x64/Processing.NDI.Lib.x64.lib"
          ]
        }],
        ['OS=="linux"', {
          "cflags_cc": [
            "-std=c++17",
            "-Wno-deprecated-declarations"
          ],
          "include_dirs": [
            "$(NDI_SDK_DIR)/include"
          ],
          "libraries": [
            "-lndi",
            "-L$(NDI_SDK_DIR)/lib/x86_64-linux-gnu"
          ]
        }]
      ],
      "cflags_cc": [
        "-std=c++17"
      ]
    }
  ]
}
