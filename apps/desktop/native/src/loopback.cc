// Captura do som do sistema (WASAPI loopback), para o compartilhamento de tela.
//
// POR QUE ISTO EXISTE: o Chromium nao consegue abrir a captura de som em
// alguns dispositivos — medido num Logitech PRO X2 no receptor sem fio, com
// `NotReadableError: Could not start audio source` em `loopback`,
// `loopbackWithMute` e ate com `--try-supported-channel-layouts`. O Windows
// ENTREGA esse som (o Xbox Game Bar grava dele), entao o problema esta na
// camada do navegador, nao no aparelho.
//
// A hipotese, e o que este arquivo faz diferente: usar o `GetMixFormat` DO
// PROPRIO DISPOSITIVO em vez de impor um formato. O WASAPI em modo
// compartilhado so aceita o formato de mixagem do endpoint; pedir outro
// devolve AUDCLNT_E_UNSUPPORTED_FORMAT.
//
// Este codigo foi escrito depois de auditar o pacote `wasapi-audio-capture`
// do npm, que faz a mesma coisa em 155 linhas e nao pode ser usado. Os
// defeitos dele estao anotados abaixo, cada um ao lado da linha que o evita —
// nao por implicancia, mas porque sao exatamente os erros faceis de repetir.

#include <napi.h>

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmreg.h>

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

/** Converte HRESULT em algo que da para ler no log. */
std::string HrToText(const char* what, HRESULT hr) {
  char buf[128];
  snprintf(buf, sizeof(buf), "%s falhou (0x%08lX)", what, static_cast<unsigned long>(hr));
  return std::string(buf);
}

/** UTF-16 do Windows para UTF-8, que e o que o JavaScript espera. */
std::string ToUtf8(const wchar_t* wide) {
  if (!wide) return std::string();
  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return std::string();
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), size, nullptr, nullptr);
  return out;
}

/**
 * COM por thread.
 *
 * Cada thread que fala COM precisa inicializar o seu proprio apartamento, e
 * so pode desinicializar o que ela mesma inicializou. O pacote auditado
 * chamava `CoUninitialize()` de qualquer thread e, pior, `std::exit(0)` logo
 * depois — o que MATA O PROCESSO ao parar a captura. Num app Electron isso e
 * a janela sumindo da tela.
 */
class ComScope {
 public:
  ComScope() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    initialized_ = SUCCEEDED(hr);
  }
  ~ComScope() {
    if (initialized_) CoUninitialize();
  }
  ComScope(const ComScope&) = delete;
  ComScope& operator=(const ComScope&) = delete;

 private:
  bool initialized_ = false;
};

/** Solta o ponteiro COM sem depender de lembrar do Release em cada saida. */
template <typename T>
struct ComPtr {
  T* p = nullptr;
  ~ComPtr() { if (p) p->Release(); }
  T** operator&() { return &p; }
  T* operator->() const { return p; }
  explicit operator bool() const { return p != nullptr; }
  void Reset() { if (p) { p->Release(); p = nullptr; } }
};

/**
 * Mistura N canais em 2, respeitando QUAL canal e qual.
 *
 * Isto existe por uma descoberta do teste: o receptor sem fio do PRO X2
 * apresenta a saida como 8 CANAIS (7.1), mesmo com o surround desligado no
 * G HUB. Nao e configuracao de quem usa — e como o driver se anuncia. E e
 * quase certamente a razao de o Chromium falhar nele: loopback em mais de
 * dois canais.
 *
 * A ordem dos canais no buffer segue os bits ACESOS em `dwChannelMask`, do
 * menos significativo para o mais. Por isso montamos o mapa a partir da
 * mascara em vez de assumir uma ordem fixa: assumir daria certo no 7.1 comum
 * e erraria em qualquer layout diferente, trocando dialogo por efeito.
 *
 * Coeficientes: os de sempre (ITU/ffmpeg). Frente vai inteira para o seu
 * lado, centro e traseiras entram a 0,707 nos dois. O LFE e DESCARTADO —
 * grave de subwoofer somado ao estereo vira lama, e ninguem sente falta dele
 * numa chamada.
 */
struct Downmix {
  std::vector<float> esquerda;
  std::vector<float> direita;
  bool valido = false;
};

Downmix MontarDownmix(uint16_t canais, DWORD mascara) {
  Downmix m;
  m.esquerda.assign(canais, 0.0f);
  m.direita.assign(canais, 0.0f);

  if (canais == 2) {
    m.esquerda[0] = 1.0f;
    m.direita[1] = 1.0f;
    m.valido = true;
    return m;
  }
  if (canais == 1) {
    m.esquerda[0] = 1.0f;
    m.direita[0] = 1.0f;
    m.valido = true;
    return m;
  }

  const float MEIO = 0.7071068f;
  int indice = 0;
  for (int bit = 0; bit < 32 && indice < canais; bit++) {
    const DWORD flag = 1u << bit;
    if (!(mascara & flag)) continue;

    switch (flag) {
      case SPEAKER_FRONT_LEFT:   m.esquerda[indice] = 1.0f;  break;
      case SPEAKER_FRONT_RIGHT:  m.direita[indice]  = 1.0f;  break;
      case SPEAKER_FRONT_CENTER:
      case SPEAKER_BACK_CENTER:
        m.esquerda[indice] = MEIO;
        m.direita[indice]  = MEIO;
        break;
      case SPEAKER_LOW_FREQUENCY:
        break;  // descartado de proposito
      case SPEAKER_BACK_LEFT:
      case SPEAKER_SIDE_LEFT:
      case SPEAKER_FRONT_LEFT_OF_CENTER:
        m.esquerda[indice] = MEIO;
        break;
      case SPEAKER_BACK_RIGHT:
      case SPEAKER_SIDE_RIGHT:
      case SPEAKER_FRONT_RIGHT_OF_CENTER:
        m.direita[indice] = MEIO;
        break;
      default:
        // Canal que nao sabemos nomear entra fraco nos dois, em vez de sumir.
        m.esquerda[indice] = 0.5f;
        m.direita[indice]  = 0.5f;
        break;
    }
    indice++;
  }

  /**
   * Sem mascara util (mascara zerada), caimos para "primeiro canal na
   * esquerda, segundo na direita" — melhor que somar tudo e virar mono.
   */
  if (indice == 0) {
    m.esquerda[0] = 1.0f;
    m.direita[1 % canais] = 1.0f;
  }

  /**
   * NAO normalizamos pela soma dos coeficientes, e isso e deliberado — a
   * primeira versao normalizava e o som saia 3x mais baixo.
   *
   * O motivo: um fone que se ANUNCIA como 7.1 quase sempre esta recebendo
   * audio estereo. Os canais traseiros e o centro chegam mudos, e o sinal de
   * verdade esta so na frente. Dividir por 3,12 (a soma dos oito
   * coeficientes) atenuaria um sinal que nunca usou os oito canais.
   *
   * Medido: com normalizacao o pico caiu de 0,2027 para 0,0437 no mesmo
   * aparelho.
   *
   * O risco que sobra e estouro em conteudo 7.1 de verdade, alto nos oito
   * canais ao mesmo tempo. Contra isso, limitamos no fim da mistura — que
   * distorce so no instante do pico, em vez de abaixar tudo o tempo todo.
   */
  m.valido = true;
  return m;
}

/* -------------------------------------------------------------------------
 * Loopback POR PROCESSO, excluindo o proprio Aether
 *
 * O PROBLEMA QUE ISTO RESOLVE — e ele nao era do aparelho, era do desenho:
 * `AUDCLNT_STREAMFLAGS_LOOPBACK` num endpoint captura TUDO o que sai daquele
 * dispositivo. Inclusive a call. Quem compartilha a tela com som estava
 * mandando de volta a voz das outras pessoas, misturada ao som do jogo — e do
 * outro lado isso chega como a propria voz atrasada. O sintoma que se relata e
 * "eco"; a causa e que o microfone da tela era o alto-falante inteiro.
 *
 * Nao ha volume nem filtro que conserte isso: o que precisa mudar e O QUE se
 * captura. O Windows 10 20H1 (build 19041) trouxe o loopback por PROCESSO, com
 * um modo que captura tudo MENOS uma arvore de processos. Passamos o nosso
 * proprio PID: sai o som do jogo e do navegador, fica de fora o que o Aether
 * esta tocando.
 *
 * A arvore importa, e nao so o processo: no Chromium quem toca audio nao e o
 * processo principal, e um utilitario filho. Excluir so o PID do main deixaria
 * o eco exatamente igual. Por isso `EXCLUDE_TARGET_PROCESS_TREE`.
 *
 * RECUO SEGURO: se qualquer passo daqui falhar — Windows antigo, API ausente,
 * ativacao recusada — voltamos ao loopback de dispositivo de antes. O pior
 * caso passa a ser o comportamento de hoje, nunca ficar sem som.
 * ------------------------------------------------------------------------- */

/**
 * O formato do loopback por processo e FIXO, e nao negociado.
 *
 * O dispositivo virtual nao responde `GetMixFormat` — nao ha endpoint de onde
 * tirar um formato de mixagem. Entao declaramos um: 48 kHz, estereo, float32,
 * que e o formato nativo do WebRTC e o que o worklet do lado do JavaScript ja
 * espera. O Windows converte o que for preciso.
 */
WAVEFORMATEXTENSIBLE FormatoDaExclusao() {
  WAVEFORMATEXTENSIBLE wf{};
  wf.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  wf.Format.nChannels = 2;
  wf.Format.nSamplesPerSec = 48000;
  wf.Format.wBitsPerSample = 32;
  wf.Format.nBlockAlign = (wf.Format.nChannels * wf.Format.wBitsPerSample) / 8;
  wf.Format.nAvgBytesPerSec = wf.Format.nSamplesPerSec * wf.Format.nBlockAlign;
  wf.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  wf.Samples.wValidBitsPerSample = 32;
  wf.dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
  wf.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
  return wf;
}

/**
 * `ActivateAudioInterfaceAsync` responde por callback, e nao no retorno.
 *
 * Este handler existe so para transformar essa resposta assincrona em algo que
 * a thread possa esperar. `IAgileObject` porque a chamada de volta pode vir de
 * outro apartamento COM — sem ele, o marshalling recusa.
 *
 * O contador de referencia e escrito a mao para nao trazer o WRL so por causa
 * de tres metodos.
 */
class HandlerDeAtivacao : public IActivateAudioInterfaceCompletionHandler,
                          public IAgileObject {
 public:
  HandlerDeAtivacao() {
    pronto_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  }
  ~HandlerDeAtivacao() {
    if (pronto_) CloseHandle(pronto_);
  }

  /** Espera a ativacao terminar. Devolve o HRESULT dela. */
  HRESULT Esperar(DWORD limiteMs) {
    if (!pronto_) return E_FAIL;
    if (WaitForSingleObject(pronto_, limiteMs) != WAIT_OBJECT_0) {
      return HRESULT_FROM_WIN32(WAIT_TIMEOUT);
    }
    return resultado_;
  }

  IAudioClient* Cliente() { return cliente_; }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operacao) override {
    HRESULT hrAtivacao = E_FAIL;
    IUnknown* bruto = nullptr;
    HRESULT hr = operacao->GetActivateResult(&hrAtivacao, &bruto);
    if (SUCCEEDED(hr) && SUCCEEDED(hrAtivacao) && bruto) {
      hr = bruto->QueryInterface(__uuidof(IAudioClient),
                                 reinterpret_cast<void**>(&cliente_));
      bruto->Release();
      resultado_ = hr;
    } else {
      resultado_ = FAILED(hr) ? hr : hrAtivacao;
    }
    if (pronto_) SetEvent(pronto_);
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) ||
        riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG restantes = --refs_;
    if (restantes == 0) delete this;
    return restantes;
  }

 private:
  std::atomic<ULONG> refs_{1};
  HANDLE pronto_ = nullptr;
  HRESULT resultado_ = E_FAIL;
  IAudioClient* cliente_ = nullptr;
};

/**
 * Abre um `IAudioClient` que captura tudo MENOS a arvore deste processo.
 *
 * Devolve `S_OK` com o cliente ja INICIALIZADO e com o evento preso, ou uma
 * falha — e nesse caso quem chama volta para o loopback de dispositivo.
 */
HRESULT AbrirLoopbackSemNosMesmos(IAudioClient** saida, HANDLE evento) {
  if (!saida) return E_POINTER;
  *saida = nullptr;

  AUDIOCLIENT_ACTIVATION_PARAMS parametros{};
  parametros.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parametros.ProcessLoopbackParams.TargetProcessId = GetCurrentProcessId();
  parametros.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT valor{};
  valor.vt = VT_BLOB;
  valor.blob.cbSize = sizeof(parametros);
  valor.blob.pBlobData = reinterpret_cast<BYTE*>(&parametros);

  IActivateAudioInterfaceAsyncOperation* operacao = nullptr;
  auto* handler = new HandlerDeAtivacao();

  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &valor,
      handler, &operacao);
  if (FAILED(hr)) {
    handler->Release();
    return hr;
  }

  hr = handler->Esperar(3000);
  if (operacao) operacao->Release();
  if (FAILED(hr) || !handler->Cliente()) {
    handler->Release();
    return FAILED(hr) ? hr : E_FAIL;
  }

  IAudioClient* cliente = handler->Cliente();
  cliente->AddRef();
  handler->Release();

  WAVEFORMATEXTENSIBLE formato = FormatoDaExclusao();
  /**
   * `EVENTCALLBACK` e OBRIGATORIO no loopback por processo — sem ele o
   * `Initialize` recusa. O laco continua sondando como antes; o evento so
   * precisa existir e estar preso.
   *
   * `AUTOCONVERTPCM` E OBRIGATORIO, e custou o conserto inteiro uma vez.
   *
   * O formato aqui e FIXO (48 kHz, estereo, float32) porque o dispositivo
   * virtual nao responde `GetMixFormat`. Sem pedir conversao, o `Initialize`
   * so aceita esse formato exato — e falha em qualquer aparelho que use
   * outro. Justamente o caso que motivou este modulo: o PRO X2 se anuncia com
   * OITO canais.
   *
   * Numa versao anterior eu tirei esta flag por achar que era um parametro
   * fora de lugar (o exemplo da Microsoft a passa na posicao da
   * periodicidade). O teste passou porque a saida padrao da maquina de teste
   * era 48 kHz estereo, e o efeito so apareceu em uso real: a ativacao
   * falhava, caia no recuo, e o recuo e o loopback de DISPOSITIVO — que
   * devolve a call inteira. Era o eco relatado.
   *
   * Aqui ela vai na posicao CERTA, em `StreamFlags`, junto com a qualidade de
   * reamostragem. A periodicidade fica zero, que e o valor correto em modo
   * compartilhado.
   */
  hr = cliente->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
          AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
          AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      2000000 /* 200ms */, 0,
      reinterpret_cast<WAVEFORMATEX*>(&formato), nullptr);
  if (SUCCEEDED(hr)) hr = cliente->SetEventHandle(evento);

  if (FAILED(hr)) {
    cliente->Release();
    return hr;
  }

  *saida = cliente;
  return S_OK;
}

}  // namespace

/**
 * Uma sessao de captura.
 *
 * O ciclo e: `Start(deviceId)` -> `Read()` varias vezes -> `Stop()`. A thread
 * de captura enche um buffer; o JavaScript o esvazia. Tudo o que as duas
 * tocam esta sob `mutex_` — o pacote auditado compartilhava um `std::vector`
 * entre duas threads SEM nenhum lock, que e comportamento indefinido e
 * aparece como travamento aleatorio.
 */
class Loopback : public Napi::ObjectWrap<Loopback> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  explicit Loopback(const Napi::CallbackInfo& info);
  ~Loopback() override;

 private:
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Read(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value Format(const Napi::CallbackInfo& info);

  void CaptureLoop();
  void StopInternal();

  std::atomic<bool> running_{false};
  std::thread thread_;

  std::mutex mutex_;
  std::vector<uint8_t> buffer_;
  std::string error_;

  // Formato real do dispositivo, descoberto no Start.
  uint32_t sample_rate_ = 0;
  uint16_t channels_ = 0;
  uint16_t bits_ = 0;
  uint16_t block_align_ = 0;
  bool is_float_ = false;
  DWORD channel_mask_ = 0;

  std::wstring device_id_;

  /**
   * Estamos capturando com a nossa propria arvore de processos DE FORA?
   *
   * Guardado para o `format()` poder contar ao JavaScript, e o log dizer qual
   * caminho pegou. Sem isso, "tem eco" e "nao tem eco" seriam dois misterios
   * indistinguiveis do lado de fora.
   */
  bool sem_nos_mesmos_ = false;

  /**
   * Deixa capturar mesmo sem a exclusao? So os scripts de diagnostico pedem
   * isso, para poder comparar os dois caminhos. O app nunca pede.
   */
  bool permitir_eco_ = false;

  /**
   * O cliente da captura por processo, ABERTO UMA VEZ SO.
   *
   * Diferente do loopback de dispositivo, que a thread reabre por conta
   * propria, este e ativado no `Start` e ENTREGUE a thread. Tentar ativar duas
   * vezes no mesmo processo devolve `0x8000FFFF` na segunda — o `Start`
   * respondia sucesso e a thread morria em seguida, capturando zero bytes.
   *
   * Passar o ponteiro entre threads e legitimo aqui: o objeto e agil
   * (`IAgileObject`) e as duas pontas vivem em apartamento multithread.
   */
  IAudioClient* cliente_sem_eco_ = nullptr;
  HANDLE evento_sem_eco_ = nullptr;

  /** Solta o cliente da captura por processo, venha de onde vier. */
  void SoltarSemEco();

  /**
   * Teto do buffer: 2 segundos de audio.
   *
   * Se o JavaScript parar de ler (aba travada, GC longo), o buffer cresceria
   * sem limite ate consumir a memoria da maquina. Estourou, descartamos o
   * MAIS ANTIGO: em audio ao vivo, o passado nao interessa.
   */
  static constexpr size_t kMaxBufferBytes = 48000 * 8 * 2;
};

Napi::Object Loopback::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "Loopback", {
      InstanceMethod("start", &Loopback::Start),
      InstanceMethod("read", &Loopback::Read),
      InstanceMethod("stop", &Loopback::Stop),
      InstanceMethod("format", &Loopback::Format),
  });
  exports.Set("Loopback", func);
  return exports;
}

Loopback::Loopback(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<Loopback>(info) {}

Loopback::~Loopback() {
  // Para a thread e pronto. NUNCA `std::exit` — ver o comentario do ComScope.
  StopInternal();
}

void Loopback::SoltarSemEco() {
  if (cliente_sem_eco_) {
    cliente_sem_eco_->Release();
    cliente_sem_eco_ = nullptr;
  }
  if (evento_sem_eco_) {
    CloseHandle(evento_sem_eco_);
    evento_sem_eco_ = nullptr;
  }
}

void Loopback::StopInternal() {
  running_ = false;
  if (thread_.joinable()) thread_.join();
  /**
   * Tambem aqui, e nao so no fim da thread: se o `Start` ativou a captura por
   * processo e a thread nunca chegou a rodar, o cliente ficaria preso — e a
   * proxima ativacao falharia, pelo mesmo motivo que ja custou uma tentativa.
   */
  SoltarSemEco();
}

Napi::Value Loopback::Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (running_) return Napi::Boolean::New(env, true);

  device_id_.clear();
  if (info.Length() > 0 && info[0].IsString()) {
    std::u16string id = info[0].As<Napi::String>().Utf16Value();
    device_id_.assign(id.begin(), id.end());
  }
  permitir_eco_ = info.Length() > 1 && info[1].ToBoolean().Value();

  {
    std::lock_guard<std::mutex> lock(mutex_);
    buffer_.clear();
    error_.clear();
  }

  // Abrimos o dispositivo AQUI, na thread do JS, para poder devolver o erro
  // de verdade em vez de a thread falhar em silencio.
  ComScope com;

  /**
   * PRIMEIRO tentamos capturar sem o nosso proprio som.
   *
   * E este caminho que tira o eco: sem ele, o loopback do dispositivo devolve
   * a call inteira de volta para a call. So caimos no caminho antigo quando
   * este nao existe (Windows anterior ao 20H1) ou e recusado — e ai o
   * comportamento e o de sempre, com som e com eco, que ainda e melhor do que
   * ficar sem compartilhar som nenhum.
   *
   * O `deviceId` escolhido a mao NAO vale aqui, e nao ha o que fazer: a
   * captura por processo nao e de um endpoint, e sim do que o processo toca.
   * Por isso a exclusao so e tentada quando ninguem pediu um aparelho
   * especifico.
   */
  sem_nos_mesmos_ = false;
  SoltarSemEco();
  if (device_id_.empty()) {
    HANDLE evento = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    IAudioClient* semNos = nullptr;
    HRESULT hrExclusao = AbrirLoopbackSemNosMesmos(&semNos, evento);
    if (FAILED(hrExclusao) || !semNos) {
      if (evento) CloseHandle(evento);
    }
    /**
     * FALHOU A EXCLUSAO? Entao nao capturamos nada.
     *
     * O recuo para o loopback de DISPOSITIVO parecia a escolha generosa —
     * "melhor com som do que sem". Nao e: aquele caminho captura tudo o que
     * sai da maquina, a call inclusive, e devolve a voz de cada pessoa para
     * ela mesma. Quem esta do outro lado nao consegue nem conversar.
     *
     * Pior, ele falhava em SILENCIO: a captura "funcionava", ninguem via erro,
     * e o defeito so aparecia na chamada dos outros. Entre ficar sem o som da
     * tela e mandar a conversa de volta para a sala, ficar sem o som e
     * claramente o menor dano — e agora isso e dito em voz alta.
     *
     * `permitirEco` existe para os scripts de diagnostico, que precisam
     * comparar os dois caminhos. O app nunca passa isso.
     */
    if ((FAILED(hrExclusao) || !semNos) && !permitir_eco_) {
      Napi::Error::New(
          env,
          HrToText("captura sem eco (loopback por processo)", hrExclusao) +
              " — sem ela, o som da tela levaria a propria call junto; "
              "por isso nao capturamos nada. Exige Windows 10 20H1 (build "
              "19041) ou mais novo.")
          .ThrowAsJavaScriptException();
      return env.Null();
    }

    if (SUCCEEDED(hrExclusao) && semNos) {
      // O formato aqui e o que declaramos, e nao o do endpoint.
      sample_rate_ = 48000;
      channels_ = 2;
      bits_ = 32;
      block_align_ = 8;
      is_float_ = true;
      channel_mask_ = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
      sem_nos_mesmos_ = true;

      /**
       * O cliente vai INTEIRO para a thread, em vez de ser reaberto la.
       *
       * A primeira versao ativava aqui so para descobrir o formato, soltava, e
       * deixava a thread ativar de novo. A segunda ativacao respondia
       * `0x8000FFFF` — o `Start` dizia que deu certo e a captura entregava
       * zero bytes, sem erro visivel. Soltar antes de iniciar a thread nao
       * resolveu: nao era corrida, e a segunda ativacao mesmo.
       */
      cliente_sem_eco_ = semNos;
      evento_sem_eco_ = evento;

      running_ = true;
      thread_ = std::thread([this]() { CaptureLoop(); });
      return Napi::Boolean::New(env, true);
    }
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    Napi::Error::New(env, HrToText("CoCreateInstance", hr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  ComPtr<IMMDevice> device;
  if (device_id_.empty()) {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  } else {
    hr = enumerator->GetDevice(device_id_.c_str(), &device);
  }
  if (FAILED(hr)) {
    Napi::Error::New(env, HrToText("abrir o dispositivo", hr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  ComPtr<IAudioClient> client;
  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client);
  if (FAILED(hr)) {
    Napi::Error::New(env, HrToText("Activate", hr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  /**
   * O FORMATO DO PROPRIO DISPOSITIVO. E a linha inteira da hipotese.
   *
   * Em modo compartilhado o WASAPI so aceita o formato de mixagem do
   * endpoint. Impor outro devolve AUDCLNT_E_UNSUPPORTED_FORMAT — que e,
   * provavelmente, o que acontece dentro do Chromium.
   */
  WAVEFORMATEX* mix = nullptr;
  hr = client->GetMixFormat(&mix);
  if (FAILED(hr) || !mix) {
    Napi::Error::New(env, HrToText("GetMixFormat", hr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  sample_rate_ = mix->nSamplesPerSec;
  channels_ = mix->nChannels;
  bits_ = mix->wBitsPerSample;
  block_align_ = mix->nBlockAlign;
  is_float_ = false;
  if (mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
    is_float_ = true;
  } else if (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
    auto* ext = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix);
    is_float_ = (ext->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    channel_mask_ = ext->dwChannelMask;
  }

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
                          10000000 /* 1s */, 0, mix, nullptr);
  CoTaskMemFree(mix);
  if (FAILED(hr)) {
    // ESTE erro e o que interessa no diagnostico. O pacote auditado ignorava
    // o HRESULT do Initialize e seguia com um cliente nulo.
    Napi::Error::New(env, HrToText("Initialize (loopback)", hr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  running_ = true;
  thread_ = std::thread([this]() { CaptureLoop(); });
  return Napi::Boolean::New(env, true);
}

void Loopback::CaptureLoop() {
  // A thread tem o proprio apartamento COM e reabre o dispositivo: ponteiro
  // COM de apartamento multithread nao atravessa de graca entre threads.
  ComScope com;

  /**
   * O caminho SEM O NOSSO SOM tem laco proprio, e nao passa pelo enumerador
   * de dispositivos: nao ha endpoint envolvido. O formato ja e o que
   * declaramos — estereo float32 —, entao nao ha mistura de canais a fazer.
   */
  if (sem_nos_mesmos_) {
    IAudioClient* cliente = cliente_sem_eco_;
    HANDLE evento = evento_sem_eco_;
    if (!cliente || !evento) {
      std::lock_guard<std::mutex> lock(mutex_);
      error_ = "captura por processo sem cliente — o Start nao a entregou";
      return;
    }

    ComPtr<IAudioCaptureClient> captura;
    if (FAILED(cliente->GetService(IID_PPV_ARGS(&captura))) ||
        FAILED(cliente->Start())) {
      std::lock_guard<std::mutex> lock(mutex_);
      error_ = "nao consegui iniciar a captura por processo";
      return;
    }

    while (running_) {
      /**
       * Espera o evento em vez de dormir um tempo fixo: o loopback por
       * processo so entrega quando ha o que entregar. O limite existe para o
       * `running_` ser reavaliado mesmo em silencio absoluto — sem ele, parar
       * de compartilhar num momento sem som travaria aqui.
       */
      WaitForSingleObject(evento, 200);

      UINT32 pacote = 0;
      if (FAILED(captura->GetNextPacketSize(&pacote))) break;

      while (pacote > 0 && running_) {
        BYTE* dados = nullptr;
        UINT32 quadros = 0;
        DWORD flags = 0;
        if (FAILED(captura->GetBuffer(&dados, &quadros, &flags, nullptr, nullptr))) {
          break;
        }

        const size_t bytes = static_cast<size_t>(quadros) * 8;  // 2ch * float32
        {
          std::lock_guard<std::mutex> lock(mutex_);
          if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) || !dados) {
            buffer_.insert(buffer_.end(), bytes, 0);
          } else {
            buffer_.insert(buffer_.end(), dados, dados + bytes);
          }
          if (buffer_.size() > kMaxBufferBytes) {
            const size_t sobra = buffer_.size() - kMaxBufferBytes;
            buffer_.erase(buffer_.begin(), buffer_.begin() + sobra);
          }
        }

        captura->ReleaseBuffer(quadros);
        if (FAILED(captura->GetNextPacketSize(&pacote))) break;
      }
    }

    cliente->Stop();
    // Quem abriu foi o `Start`, mas quem fecha e quem terminou de usar.
    SoltarSemEco();
    return;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                              IID_PPV_ARGS(&enumerator)))) {
    std::lock_guard<std::mutex> lock(mutex_);
    error_ = "nao consegui criar o enumerador na thread de captura";
    return;
  }

  ComPtr<IMMDevice> device;
  HRESULT hr = device_id_.empty()
      ? enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device)
      : enumerator->GetDevice(device_id_.c_str(), &device);
  if (FAILED(hr)) {
    std::lock_guard<std::mutex> lock(mutex_);
    error_ = HrToText("abrir o dispositivo (thread)", hr);
    return;
  }

  ComPtr<IAudioClient> client;
  if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client))) {
    std::lock_guard<std::mutex> lock(mutex_);
    error_ = "Activate falhou na thread de captura";
    return;
  }

  WAVEFORMATEX* mix = nullptr;
  if (FAILED(client->GetMixFormat(&mix)) || !mix) return;
  const uint16_t block = mix->nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
                          10000000, 0, mix, nullptr);
  CoTaskMemFree(mix);
  if (FAILED(hr)) {
    std::lock_guard<std::mutex> lock(mutex_);
    error_ = HrToText("Initialize na thread", hr);
    return;
  }

  ComPtr<IAudioCaptureClient> capture;
  if (FAILED(client->GetService(IID_PPV_ARGS(&capture)))) return;
  if (FAILED(client->Start())) return;

  const uint16_t canaisOrigem = channels_;
  const Downmix mistura = MontarDownmix(canaisOrigem, channel_mask_);
  // So convertemos float32; o formato de mixagem em modo compartilhado
  // praticamente sempre e esse. Qualquer outro passa cru e o `format()` diz.
  const bool converter = is_float_ && bits_ == 32 && mistura.valido;

  while (running_) {
    UINT32 packet = 0;
    if (FAILED(capture->GetNextPacketSize(&packet))) break;

    while (packet > 0 && running_) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;

      /**
       * `frames * block`, e nao `frames * sizeof(float)`.
       *
       * O pacote auditado usava 4 bytes por frame fixo. O formato tipico e
       * float32 ESTEREO, ou seja 8 — ele copiava metade dos dados e o PCM
       * saia deformado. `nBlockAlign` e o numero certo, seja qual for o
       * formato do aparelho.
       */
      const size_t bytes = static_cast<size_t>(frames) * block;
      const size_t bytesSaida = static_cast<size_t>(frames) * 2 * sizeof(float);

      {
        std::lock_guard<std::mutex> lock(mutex_);

        if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) || !data) {
          buffer_.insert(buffer_.end(), bytesSaida, 0);
        } else if (converter) {
          /**
           * A CONVERSAO ACONTECE AQUI, e nao do outro lado da ponte.
           *
           * O PRO X2 entrega 8 canais: sao 1,5 MB/s. Em estereo sao 384 KB/s.
           * Converter no C++ economiza 4x de trafego entre processos, e o
           * laco de audio ja esta nesta thread de qualquer jeito.
           */
          const float* entrada = reinterpret_cast<const float*>(data);
          const size_t antes = buffer_.size();
          buffer_.resize(antes + bytesSaida);
          float* saida = reinterpret_cast<float*>(buffer_.data() + antes);

          for (UINT32 f = 0; f < frames; f++) {
            const float* quadro = entrada + static_cast<size_t>(f) * canaisOrigem;
            float e = 0.0f, d = 0.0f;
            for (uint16_t c = 0; c < canaisOrigem; c++) {
              e += quadro[c] * mistura.esquerda[c];
              d += quadro[c] * mistura.direita[c];
            }
            // Limite em vez de atenuacao global — ver MontarDownmix.
            saida[f * 2] = e > 1.0f ? 1.0f : (e < -1.0f ? -1.0f : e);
            saida[f * 2 + 1] = d > 1.0f ? 1.0f : (d < -1.0f ? -1.0f : d);
          }
        } else {
          // Formato que nao sabemos converter: passa cru, e o `format()` avisa.
          buffer_.insert(buffer_.end(), data, data + bytes);
        }

        if (buffer_.size() > kMaxBufferBytes) {
          const size_t excesso = buffer_.size() - kMaxBufferBytes;
          buffer_.erase(buffer_.begin(), buffer_.begin() + excesso);
        }
      }

      capture->ReleaseBuffer(frames);
      if (FAILED(capture->GetNextPacketSize(&packet))) break;
    }

    // Sem pacote agora: dorme um pouco em vez de girar a CPU.
    if (packet == 0) Sleep(5);
  }

  client->Stop();
}

Napi::Value Loopback::Read(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  std::vector<uint8_t> saida;
  std::string erro;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    saida.swap(buffer_);
    erro = error_;
  }

  if (!erro.empty()) {
    Napi::Error::New(env, erro).ThrowAsJavaScriptException();
    return env.Null();
  }
  // Vazio quer dizer VAZIO. O pacote auditado devolvia 1024 bytes de silencio
  // inventado, o que embaralha qualquer nocao de tempo do outro lado.
  return Napi::Buffer<uint8_t>::Copy(env, saida.data(), saida.size());
}

Napi::Value Loopback::Stop(const Napi::CallbackInfo& info) {
  StopInternal();
  return info.Env().Undefined();
}

Napi::Value Loopback::Format(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const bool convertido = is_float_ && bits_ == 32;

  Napi::Object out = Napi::Object::New(env);
  /**
   * O que sai da `read()`, e nao o que o aparelho entrega. Quem consome
   * precisa saber como ler os bytes que RECEBEU — dizer "8 canais" aqui,
   * depois de ter misturado para 2, seria a informacao errada no lugar mais
   * caro possivel.
   */
  out.Set("sampleRate", Napi::Number::New(env, sample_rate_));
  out.Set("channels", Napi::Number::New(env, convertido ? 2 : channels_));
  out.Set("bitsPerSample", Napi::Number::New(env, bits_));
  out.Set("blockAlign", Napi::Number::New(env, convertido ? 8 : block_align_));
  out.Set("isFloat", Napi::Boolean::New(env, is_float_));
  /**
   * Se o nosso proprio som ficou de fora da captura. E a diferenca entre a
   * pessoa do outro lado ouvir a si mesma ou nao, entao precisa ser
   * verificavel de fora — nao uma promessa do comentario.
   */
  out.Set("semEco", Napi::Boolean::New(env, sem_nos_mesmos_));

  // O formato de origem fica visivel para diagnostico: e ele que explica por
  // que o Chromium recusa este aparelho.
  Napi::Object origem = Napi::Object::New(env);
  origem.Set("channels", Napi::Number::New(env, channels_));
  origem.Set("blockAlign", Napi::Number::New(env, block_align_));
  origem.Set("channelMask", Napi::Number::New(env, static_cast<double>(channel_mask_)));
  origem.Set("downmix", Napi::Boolean::New(env, convertido && channels_ > 2));
  out.Set("origem", origem);
  return out;
}

/**
 * Lista as saidas de audio.
 *
 * O pacote auditado nao tinha isto: pegava sempre a saida padrao. Poder
 * escolher o dispositivo e justamente o que o Electron nao oferece, e o que
 * permitiria capturar a saida certa quando a padrao nao e a que toca.
 */
Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ComScope com;

  ComPtr<IMMDeviceEnumerator> enumerator;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                              IID_PPV_ARGS(&enumerator)))) {
    Napi::Error::New(env, "nao consegui criar o enumerador").ThrowAsJavaScriptException();
    return env.Null();
  }

  ComPtr<IMMDevice> padrao;
  std::string idPadrao;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &padrao))) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(padrao->GetId(&id))) {
      idPadrao = ToUtf8(id);
      CoTaskMemFree(id);
    }
  }

  ComPtr<IMMDeviceCollection> colecao;
  if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &colecao))) {
    Napi::Error::New(env, "EnumAudioEndpoints falhou").ThrowAsJavaScriptException();
    return env.Null();
  }

  UINT count = 0;
  colecao->GetCount(&count);
  Napi::Array lista = Napi::Array::New(env, count);

  for (UINT i = 0; i < count; i++) {
    ComPtr<IMMDevice> dev;
    if (FAILED(colecao->Item(i, &dev))) continue;

    LPWSTR id = nullptr;
    std::string idUtf8;
    if (SUCCEEDED(dev->GetId(&id))) {
      idUtf8 = ToUtf8(id);
      CoTaskMemFree(id);
    }

    std::string nome;
    ComPtr<IPropertyStore> props;
    if (SUCCEEDED(dev->OpenPropertyStore(STGM_READ, &props))) {
      PROPVARIANT v;
      PropVariantInit(&v);
      if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &v)) && v.vt == VT_LPWSTR) {
        nome = ToUtf8(v.pwszVal);
      }
      PropVariantClear(&v);
    }

    Napi::Object item = Napi::Object::New(env);
    item.Set("id", Napi::String::New(env, idUtf8));
    item.Set("name", Napi::String::New(env, nome));
    item.Set("isDefault", Napi::Boolean::New(env, !idPadrao.empty() && idUtf8 == idPadrao));
    lista.Set(i, item);
  }

  return lista;
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices", Napi::Function::New(env, ListDevices));
  return Loopback::Init(env, exports);
}

NODE_API_MODULE(aether_loopback, InitAll)
