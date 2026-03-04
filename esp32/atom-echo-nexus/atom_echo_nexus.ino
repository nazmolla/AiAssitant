/*
  atom_echo_nexus.ino
  ---------------------------------------------------------------
  Single-file Arduino sketch for M5Stack Atom Echo + Nexus Agent.

  Requirements you asked for:
  1) Arduino sketch upload target
  2) Wake word runs ON ESP device using micro-wake-up

  Flow:
    mic -> micro-wake-up (on-device) -> record command ->
    /api/audio/transcribe -> /api/conversation/respond -> /api/audio/tts(format=wav)

  NOTE:
  - This sketch expects a micro-wake-up library + model to be available.
  - Wire the adapter in `wake_engine_process()` to your exact micro-wake-up API.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <driver/i2s.h>

// ----------------------------- CONFIG -----------------------------
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

static const char* NEXUS_HOST = "YOUR_SERVER_IP";
static const uint16_t NEXUS_PORT = 3000;
static const char* NEXUS_API_KEY = "nxk_YOUR_API_KEY";

static const uint32_t SAMPLE_RATE = 16000;
static const uint16_t BITS_PER_SAMPLE = 16;
static const uint8_t CHANNELS = 1;

static const uint32_t COMMAND_MAX_MS = 4500;
static const uint32_t SILENCE_STOP_MS = 900;
static const uint32_t SILENCE_THRESHOLD = 700;

// Atom Echo pins
static const i2s_port_t I2S_PORT = I2S_NUM_0;
static const int MIC_CLK_PIN = 33;
static const int MIC_DATA_PIN = 23;
static const int SPK_BCK_PIN = 19;
static const int SPK_LRCK_PIN = 33;
static const int SPK_DATA_PIN = 22;

// ---------------------- micro-wake-up adapter ----------------------
// Keep naming exactly "micro-wake-up" in comments/config per your request.

// If your library has a different header, change here.
#if __has_include(<micro_wake_up.h>)
  #include <micro_wake_up.h>
  #define HAVE_MICRO_WAKE_UP 1
#else
  #define HAVE_MICRO_WAKE_UP 0
#endif

static bool wake_engine_init() {
#if HAVE_MICRO_WAKE_UP
  // Example placeholder:
  // return micro_wake_up_begin("hey_nexus.tflite", SAMPLE_RATE);
  return true;
#else
  return false;
#endif
}

static bool wake_engine_process(const int16_t* samples, size_t sampleCount) {
#if HAVE_MICRO_WAKE_UP
  // Example placeholder:
  // float score = micro_wake_up_process(samples, sampleCount);
  // return score > 0.90f;
  (void)samples;
  (void)sampleCount;
  return false;
#else
  (void)samples;
  (void)sampleCount;
  return false;
#endif
}

// -------------------------- audio buffers --------------------------
static const size_t CHUNK_SAMPLES = 512;
static int16_t micChunk[CHUNK_SAMPLES];

static const size_t MAX_PCM_BYTES = (SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * CHANNELS * COMMAND_MAX_MS) / 1000;
static uint8_t* commandWav = nullptr; // [44-byte wav header + PCM]
static size_t commandWavLen = 0;

// -------------------------- helpers --------------------------

static String baseUrl() {
  return String("http://") + NEXUS_HOST + ":" + String(NEXUS_PORT);
}

static void addAuth(HTTPClient& http) {
  http.addHeader("Authorization", String("Bearer ") + NEXUS_API_KEY);
}

static uint32_t rms_energy(const int16_t* s, size_t n) {
  if (!n) return 0;
  uint64_t sum = 0;
  for (size_t i = 0; i < n; i++) {
    int32_t v = s[i];
    sum += (uint64_t)(v * v);
  }
  return (uint32_t)sqrt((double)sum / (double)n);
}

static void write_wav_header(uint8_t* dst, uint32_t pcmBytes) {
  const uint32_t byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const uint16_t blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  const uint32_t fileSize = 36 + pcmBytes;
  const uint16_t formatPCM = 1;
  const uint32_t fmtSize = 16;

  memcpy(dst + 0, "RIFF", 4); memcpy(dst + 4, &fileSize, 4); memcpy(dst + 8, "WAVE", 4);
  memcpy(dst + 12, "fmt ", 4); memcpy(dst + 16, &fmtSize, 4); memcpy(dst + 20, &formatPCM, 2);
  memcpy(dst + 22, &CHANNELS, 2); memcpy(dst + 24, &SAMPLE_RATE, 4); memcpy(dst + 28, &byteRate, 4);
  memcpy(dst + 32, &blockAlign, 2); memcpy(dst + 34, &BITS_PER_SAMPLE, 2);
  memcpy(dst + 36, "data", 4); memcpy(dst + 40, &pcmBytes, 4);
}

static void i2s_start_mic() {
  i2s_driver_uninstall(I2S_PORT);

  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_RIGHT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;

  i2s_driver_install(I2S_PORT, &cfg, 0, nullptr);

  i2s_pin_config_t pins = {};
  pins.bck_io_num = I2S_PIN_NO_CHANGE;
  pins.ws_io_num = MIC_CLK_PIN;
  pins.data_in_num = MIC_DATA_PIN;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  i2s_set_pin(I2S_PORT, &pins);
}

static void i2s_start_speaker() {
  i2s_driver_uninstall(I2S_PORT);

  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ALL_RIGHT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 256;
  cfg.tx_desc_auto_clear = true;

  i2s_driver_install(I2S_PORT, &cfg, 0, nullptr);

  i2s_pin_config_t pins = {};
  pins.bck_io_num = SPK_BCK_PIN;
  pins.ws_io_num = SPK_LRCK_PIN;
  pins.data_out_num = SPK_DATA_PIN;
  pins.data_in_num = I2S_PIN_NO_CHANGE;
  i2s_set_pin(I2S_PORT, &pins);
}

static bool nexus_transcribe(const uint8_t* wav, size_t wavLen, String& outText) {
  HTTPClient http;
  http.begin(baseUrl() + "/api/audio/transcribe");
  addAuth(http);
  http.setTimeout(30000);

  const String boundary = "----atomEchoBoundary";
  http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);

  String head = "--" + boundary + "\r\n"
                "Content-Disposition: form-data; name=\"audio\"; filename=\"audio.wav\"\r\n"
                "Content-Type: audio/wav\r\n\r\n";
  String tail = "\r\n--" + boundary + "--\r\n";

  size_t totalLen = head.length() + wavLen + tail.length();
  uint8_t* body = (uint8_t*)malloc(totalLen);
  if (!body) { http.end(); return false; }

  size_t off = 0;
  memcpy(body + off, head.c_str(), head.length()); off += head.length();
  memcpy(body + off, wav, wavLen); off += wavLen;
  memcpy(body + off, tail.c_str(), tail.length());

  int code = http.POST(body, totalLen);
  free(body);
  if (code != 200) { Serial.printf("STT HTTP %d\n", code); http.end(); return false; }

  JsonDocument doc;
  auto err = deserializeJson(doc, http.getString());
  http.end();
  if (err) return false;
  outText = doc["text"].as<String>();
  return outText.length() > 0;
}

static bool nexus_converse(const String& prompt, String& outReply) {
  HTTPClient http;
  http.begin(baseUrl() + "/api/conversation/respond");
  addAuth(http);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(60000);

  JsonDocument req;
  req["message"] = prompt;
  String payload;
  serializeJson(req, payload);

  int code = http.POST(payload);
  if (code != 200) { http.end(); return false; }

  WiFiClient* stream = http.getStreamPtr();
  if (!stream) { http.end(); return false; }

  String eventName;
  outReply = "";
  unsigned long deadline = millis() + 60000;

  while (http.connected() && millis() < deadline) {
    if (!stream->available()) { delay(5); continue; }
    String line = stream->readStringUntil('\n');
    line.trim();

    if (line.startsWith("event:")) {
      eventName = line.substring(6);
      eventName.trim();
      continue;
    }
    if (line.startsWith("data:")) {
      String data = line.substring(5);
      data.trim();
      if (eventName == "token") {
        JsonDocument token;
        if (!deserializeJson(token, data) && token["token"].is<String>()) {
          outReply += token["token"].as<String>();
        }
      } else if (eventName == "done") {
        break;
      } else if (eventName == "error") {
        http.end();
        return false;
      }
    }
  }

  http.end();
  return outReply.length() > 0;
}

static bool nexus_tts_wav(const String& text, uint8_t*& outAudio, size_t& outLen) {
  HTTPClient http;
  http.begin(baseUrl() + "/api/audio/tts");
  addAuth(http);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(30000);

  JsonDocument req;
  req["text"] = text;
  req["voice"] = "nova";
  req["format"] = "wav";
  String payload;
  serializeJson(req, payload);

  int code = http.POST(payload);
  if (code != 200) { http.end(); return false; }

  int len = http.getSize();
  if (len <= 0) { http.end(); return false; }

  outAudio = (uint8_t*)malloc((size_t)len);
  if (!outAudio) { http.end(); return false; }

  WiFiClient* stream = http.getStreamPtr();
  size_t read = 0;
  unsigned long deadline = millis() + 30000;
  while (read < (size_t)len && millis() < deadline) {
    if (stream->available()) {
      int n = stream->read(outAudio + read, len - (int)read);
      if (n > 0) read += (size_t)n;
    } else {
      delay(3);
    }
  }

  http.end();
  outLen = read;
  return outLen > 44;
}

static void play_wav_pcm(const uint8_t* wav, size_t wavLen) {
  if (wavLen <= 44) return;
  i2s_start_speaker();

  const uint8_t* pcm = wav + 44;
  size_t pcmLen = wavLen - 44;
  size_t writtenTotal = 0;

  while (writtenTotal < pcmLen) {
    size_t toWrite = min((size_t)1024, pcmLen - writtenTotal);
    size_t written = 0;
    i2s_write(I2S_PORT, pcm + writtenTotal, toWrite, &written, pdMS_TO_TICKS(100));
    writtenTotal += written;
  }

  i2s_start_mic();
}

static bool record_command_after_wake() {
  if (!commandWav) return false;

  size_t pcmWritten = 0;
  unsigned long start = millis();
  unsigned long lastVoice = millis();

  while (millis() - start < COMMAND_MAX_MS) {
    size_t bytesRead = 0;
    i2s_read(I2S_PORT, micChunk, sizeof(micChunk), &bytesRead, pdMS_TO_TICKS(100));
    if (!bytesRead) continue;

    uint32_t e = rms_energy(micChunk, bytesRead / 2);
    if (e > SILENCE_THRESHOLD) {
      lastVoice = millis();
    }

    if (pcmWritten + bytesRead > MAX_PCM_BYTES) {
      bytesRead = MAX_PCM_BYTES - pcmWritten;
    }

    memcpy(commandWav + 44 + pcmWritten, micChunk, bytesRead);
    pcmWritten += bytesRead;

    if (millis() - lastVoice > SILENCE_STOP_MS && pcmWritten > 12000) {
      break;
    }
    if (pcmWritten >= MAX_PCM_BYTES) {
      break;
    }
  }

  write_wav_header(commandWav, (uint32_t)pcmWritten);
  commandWavLen = 44 + pcmWritten;
  return pcmWritten > 12000;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  commandWav = (uint8_t*)malloc(44 + MAX_PCM_BYTES);
  if (!commandWav) {
    Serial.println("FATAL: no heap for command buffer");
    while (true) delay(1000);
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi OK: %s\n", WiFi.localIP().toString().c_str());

  i2s_start_mic();

  if (!wake_engine_init()) {
    Serial.println("FATAL: micro-wake-up init failed. Install/configure micro-wake-up + model.");
    while (true) delay(1000);
  }

  Serial.println("Ready: on-device micro-wake-up listening...");
}

void loop() {
  size_t bytesRead = 0;
  i2s_read(I2S_PORT, micChunk, sizeof(micChunk), &bytesRead, pdMS_TO_TICKS(80));
  if (!bytesRead) return;

  // ON-DEVICE wake word detection (micro-wake-up)
  bool wake = wake_engine_process(micChunk, bytesRead / 2);
  if (!wake) return;

  Serial.println("Wake detected on-device. Recording command...");

  if (!record_command_after_wake()) {
    Serial.println("No valid command captured");
    return;
  }

  String transcript;
  if (!nexus_transcribe(commandWav, commandWavLen, transcript)) {
    Serial.println("STT failed");
    return;
  }

  transcript.trim();
  if (!transcript.length()) {
    Serial.println("Empty transcript");
    return;
  }

  Serial.printf("User: %s\n", transcript.c_str());

  String reply;
  if (!nexus_converse(transcript, reply)) {
    Serial.println("Conversation failed");
    return;
  }

  Serial.printf("Assistant: %s\n", reply.c_str());

  uint8_t* tts = nullptr;
  size_t ttsLen = 0;
  if (!nexus_tts_wav(reply, tts, ttsLen)) {
    Serial.println("TTS failed");
    if (tts) free(tts);
    return;
  }

  play_wav_pcm(tts, ttsLen);
  free(tts);

  Serial.println("Back to on-device micro-wake-up listening...");
}
