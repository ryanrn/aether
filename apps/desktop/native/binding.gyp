{
  "targets": [
    {
      "target_name": "aether_loopback",
      "sources": ["src/loopback.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "//": [
        "mmdevapi entrou por causa do ActivateAudioInterfaceAsync, que e o que",
        "abre a captura por PROCESSO — a que exclui o proprio Aether e tira o",
        "eco. Ele nao esta em ole32: sem esta linha, o link falha com",
        "LNK2001 apontando so o nome do simbolo."
      ],
      "libraries": ["-lole32", "-lavrt", "-lmmdevapi"],
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
