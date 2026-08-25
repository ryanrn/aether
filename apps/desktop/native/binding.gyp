{
  "targets": [
    {
      "target_name": "aether_loopback",
      "sources": ["src/loopback.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "libraries": ["-lole32", "-lavrt"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 0,
          "AdditionalOptions": ["/std:c++17"]
        }
      }
    }
  ]
}
