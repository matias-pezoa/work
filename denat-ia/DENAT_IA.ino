/*
 * DENAT_IA.ino  (v2 — señales separadas por sensor)
 * -----------------------------------------------------------------
 * Instrumento biométrico de baja resolución — proyecto "Desnaturalización IA"
 *
 * A diferencia de la v1 (que fusionaba todo en una sola intensidad/pico),
 * esta versión publica los 3 sensores como campos INDEPENDIENTES: la
 * decisión de qué distorsión aplicar (glitch, filtro de color, amplitud)
 * se toma en la web, a partir de estos valores.
 *
 *   1) ADXL345 (acelerómetro) -> ejes X e Y convertidos a ángulo de
 *      inclinación (-90 a 90° cada uno). Y se usa además para la bandera
 *      "cambioBrusco", que se activa cuando esa inclinación salta más de
 *      UMBRAL_CAMBIO_BRUSCO grados entre dos lecturas consecutivas
 *      (pensado para disparar el glitch/fragmentación en la web). El eje
 *      X viaja como "inclinacionX" — en la web mueve el glitch en
 *      profundidad ("hacia adelante"), el Y lo mueve en horizontal.
 *
 *   2) TCS34725 (color) -> color dominante NORMALIZADO por el canal
 *      "clear" (ya no es solo "tapado sí/no"): entrega R/G/B 0-255
 *      independiente del brillo ambiente, listo para usar como filtro
 *      de color en la web (colorHex).
 *
 *   3) Potenciómetro / SoftPot -> mapeo directo 0-100 (con suavizado),
 *      pensado como control manual de amplitud/rotación/ruido del
 *      glitch en la web (no es una señal "biométrica", es un dial).
 *
 * Topic (igual que las versiones anteriores):
 *   proyecto/2026/desnaturalizacion-ia/instrumento/<CLIENT_ID>/estado
 *
 * Payload (ESQUEMA NUEVO — agrega accelX/inclinacionX respecto de la
 * versión anterior):
 *   {
 *     "clientId": "instrumento-esp32-01",
 *     "timestamp": 123456,
 *     "accelX": 1.10,
 *     "accelY": -3.24,
 *     "inclinacionX": 6.4,
 *     "inclinacion": 42.1,
 *     "cambioBrusco": false,
 *     "colorR": 182, "colorG": 40, "colorB": 33,
 *     "colorHex": "#B62821",
 *     "colorDominante": "rojo",
 *     "controlValor": 63.0
 *   }
 *
 * web/main.js ya lee este esquema (inclinacion/inclinacionX/cambioBrusco/
 * controlValor/colorHex): inclinación Y -> ruido + desplazamiento
 * horizontal del glitch, inclinación X -> escala/profundidad del glitch
 * ("hacia adelante"), cambioBrusco -> fragmentación, el dial del
 * potenciómetro escala todo, y colorHex se aplica como filtro de color
 * sobre el video. Ver "04 — REGLAS" en main.js para el detalle.
 *
 * -----------------------------------------------------------------
 * CONEXIONES (sin cambios respecto de la v1)
 *
 *   Potenciómetro / SoftPot:
 *     wiper / pata central -> GPIO34   (ADC1_CH6 — NO uses pines ADC2)
 *     extremos              -> 3V3 y GND
 *
 *   TCS34725 + ADXL345 (bus I2C compartido, sin conflicto de dirección:
 *   TCS34725=0x29, ADXL345=0x53):
 *     SDA -> GPIO21
 *     SCL -> GPIO22
 *     VCC -> 3V3   (ambos)
 *     GND -> GND   (ambos)
 *     Si tu módulo TCS34725 trae un pin de LED separado, conéctalo a 3V3.
 *
 *   Pantalla redonda GC9A01A, 1.28" SPI 4 hilos:
 *     SCK -> GPIO18   MOSI -> GPIO23   CS -> GPIO5
 *     DC  -> GPIO17   RST  -> GPIO16
 *     VCC -> 3V3      GND  -> GND
 *
 * -----------------------------------------------------------------
 * REQUISITOS (Library Manager de Arduino IDE)
 *   Placa: esp32 (Espressif) — Boards Manager
 *   PubSubClient (Nick O'Leary), Adafruit GFX Library, Adafruit GC9A01A,
 *   Adafruit Unified Sensor, Adafruit ADXL345, Adafruit TCS34725
 *
 * CALIBRACIÓN PENDIENTE (no probado con hardware real)
 *   UMBRAL_CAMBIO_BRUSCO (grados) y los ALPHA de suavizado son puntos de
 *   partida. Observa el monitor serie y ajusta según cómo se sienta la
 *   respuesta al mover/tapar/girar cada sensor.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_GC9A01A.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_ADXL345_U.h>
#include <Adafruit_TCS34725.h>
#include "secrets.h"

/* ----------------------------------------------------------------- */
/* MODO OFFLINE: en 1, el ESP32 se salta WiFi y MQTT por completo —   */
/* lee sensores, dibuja en pantalla y saca el JSON solo por Serial    */
/* (para usar con el botón "Conectar por USB" de la web). Cuando      */
/* WiFi/MQTT ya funcionen, cambia esto a 0.                           */
/* ----------------------------------------------------------------- */
#define MODO_OFFLINE 1

/* ----------------------------------------------------------------- */
/* Pines                                                              */
/* ----------------------------------------------------------------- */

const int PIN_POT = 34; // ADC1_CH6 — potenciómetro o SoftPot

#define TFT_CS  5
#define TFT_DC  17
#define TFT_RST 16

const unsigned long INTERVALO_MS = 100; // ~10 Hz
unsigned long ultimaLectura = 0;

/* ----------------------------------------------------------------- */
/* Objetos de sensor / pantalla                                       */
/* ----------------------------------------------------------------- */

Adafruit_GC9A01A tft(TFT_CS, TFT_DC, TFT_RST);
Adafruit_ADXL345_Unified accel = Adafruit_ADXL345_Unified(12345);
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_50MS, TCS34725_GAIN_4X);

bool tcsOk = false;
bool accelOk = false;

/* ----------------------------------------------------------------- */
/* Acelerómetro: inclinación (eje Y) + cambio brusco                  */
/* ----------------------------------------------------------------- */

const float UMBRAL_CAMBIO_BRUSCO = 15.0f; // grados entre lecturas consecutivas
float anguloAnterior = NAN;

/* ----------------------------------------------------------------- */
/* Color: suavizado exponencial (reduce parpadeo del filtro en la web) */
/* ----------------------------------------------------------------- */

const float ALPHA_COLOR = 0.3f; // 0-1: más alto = responde más rápido, menos estable
float rSuave = 0, gSuave = 0, bSuave = 0;
bool colorInicializado = false;

/* ----------------------------------------------------------------- */
/* Potenciómetro: suavizado simple (evita jitter del ADC)             */
/* ----------------------------------------------------------------- */

const float ALPHA_POT = 0.25f;
float potSuave = 0;
bool potInicializado = false;

/* ----------------------------------------------------------------- */
/* WiFi + MQTT (idéntico a las versiones anteriores)                  */
/* ----------------------------------------------------------------- */

#if MQTT_PORT == 8883
  WiFiClientSecure net;
#else
  WiFiClient net;
#endif
PubSubClient mqtt(net);

char topicEstado[128];

void conectarWiFi() {
  Serial.printf("[wifi] conectando a %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.printf("\n[wifi] conectado. IP: %s\n", WiFi.localIP().toString().c_str());
}

// Versión NO bloqueante: si el broker no responde, reintenta cada
// INTERVALO_REINTENTO_MQTT sin congelar la lectura de sensores/pantalla.
unsigned long ultimoIntentoMQTT = 0;
const unsigned long INTERVALO_REINTENTO_MQTT = 5000;

void intentarConectarMQTT() {
  if (mqtt.connected()) return;
  unsigned long ahora = millis();
  if (ahora - ultimoIntentoMQTT < INTERVALO_REINTENTO_MQTT) return;
  ultimoIntentoMQTT = ahora;

  Serial.printf("[mqtt] intentando conectar a %s:%d …\n", MQTT_HOST, MQTT_PORT);
  bool ok = mqtt.connect(CLIENT_ID, MQTT_USER, MQTT_PASS);
  if (ok) {
    Serial.printf("[mqtt] conectado. Publicando en: %s\n", topicEstado);
  } else {
    Serial.printf("[mqtt] no disponible todavía (rc=%d) — se sigue leyendo sensores igual\n", mqtt.state());
  }
}

/* ----------------------------------------------------------------- */
/* Pantalla — muestra los 3 sensores en vivo                          */
/* ----------------------------------------------------------------- */

void mostrarEstado(const char *texto) {
  tft.fillScreen(GC9A01A_BLACK);
  tft.setTextColor(GC9A01A_WHITE);
  tft.setTextSize(2);
  tft.setCursor(20, 110);
  tft.print(texto);
}

// Anillo decorativo de marcas + indicador de estado MQTT (imita el marco
// de un watchface: da la sensación de "instrumento", no de consola de debug).
void dibujarAnillo(bool mqttConectado) {
  for (int i = 0; i < 24; i++) {
    float ang = radians(i * 15.0f);
    int x1 = 120 + (int)(cos(ang) * 100);
    int y1 = 120 + (int)(sin(ang) * 100);
    int x2 = 120 + (int)(cos(ang) * 113);
    int y2 = 120 + (int)(sin(ang) * 113);
    tft.drawLine(x1, y1, x2, y2, GC9A01A_DARKGREY);
  }
  uint16_t colorEstado = mqttConectado ? GC9A01A_GREEN : GC9A01A_DARKGREY;
  tft.fillCircle(165, 42, 5, colorEstado);
}

// Texto centrado horizontalmente en x, usando el tamaño/fuente ya seteados.
void imprimirCentrado(const char *texto, int x, int y) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.getTextBounds(texto, 0, 0, &x1, &y1, &w, &h);
  tft.setCursor(x - w / 2, y - h / 2);
  tft.print(texto);
}

void actualizarPantalla(float accelY, float inclinacion, float inclinacionX, bool cambioBrusco,
                         uint8_t r, uint8_t g, uint8_t b,
                         const char *hex, const char *dominante,
                         float controlValor, bool mqttConectado) {
  tft.fillScreen(GC9A01A_BLACK);
  dibujarAnillo(mqttConectado);

  // --- Número grande centrado: control (potenciómetro / SoftPot) ---
  char bufControl[8];
  snprintf(bufControl, sizeof(bufControl), "%.0f", controlValor);
  tft.setTextSize(5);
  tft.setTextColor(GC9A01A_WHITE);
  imprimirCentrado(bufControl, 120, 95);

  tft.setTextSize(1);
  tft.setTextColor(GC9A01A_CYAN);
  imprimirCentrado("CONTROL", 120, 128);

  // --- Ícono de color (izquierda): círculo relleno con el color detectado ---
  uint16_t colorDetectado = tft.color565(r, g, b);
  tft.fillCircle(80, 165, 14, colorDetectado);
  tft.drawCircle(80, 165, 14, GC9A01A_WHITE);
  tft.setTextSize(1);
  tft.setTextColor(GC9A01A_WHITE);
  imprimirCentrado(hex, 80, 188);
  tft.setTextColor(GC9A01A_DARKGREY);
  imprimirCentrado(dominante, 80, 200);

  // --- Ícono de inclinación (derecha): mini indicador de nivel ---
  uint16_t colorTilt = cambioBrusco ? GC9A01A_RED : GC9A01A_CYAN;
  tft.drawCircle(160, 165, 14, GC9A01A_WHITE);
  float anguloTilt = radians(constrain(inclinacion, -60.0f, 60.0f));
  int tx = (int)(cos(anguloTilt) * 10);
  int ty = (int)(sin(anguloTilt) * 10);
  tft.drawLine(160 - tx, 165 - ty, 160 + tx, 165 + ty, colorTilt);
  char bufInc[8];
  snprintf(bufInc, sizeof(bufInc), "%.0f%s", inclinacion, "deg");
  tft.setTextColor(colorTilt);
  imprimirCentrado(bufInc, 160, 188);
  tft.setTextColor(GC9A01A_DARKGREY);
  imprimirCentrado(cambioBrusco ? "brusco" : "estable", 160, 200);

  // --- Eje X: línea chica abajo (mueve el glitch "hacia adelante" en la web) ---
  char bufIncX[16];
  snprintf(bufIncX, sizeof(bufIncX), "X: %.0f%s", inclinacionX, "deg");
  tft.setTextColor(GC9A01A_DARKGREY);
  imprimirCentrado(bufIncX, 120, 222);
}

/* ----------------------------------------------------------------- */

void setup() {
  Serial.begin(115200);
  delay(300);

  analogReadResolution(10);
  analogSetPinAttenuation(PIN_POT, ADC_11db);

  Wire.begin(); // SDA=GPIO21, SCL=GPIO22 por defecto en ESP32

  tft.begin();
  tft.setRotation(0);
  mostrarEstado("Iniciando...");

  tcsOk = tcs.begin();
  if (!tcsOk) Serial.println("[tcs34725] no encontrado — revisa el cableado I2C");

  accelOk = accel.begin();
  if (!accelOk) {
    Serial.println("[adxl345] no encontrado — revisa el cableado I2C");
  } else {
    accel.setRange(ADXL345_RANGE_4_G);
  }

  snprintf(topicEstado, sizeof(topicEstado),
           "proyecto/2026/desnaturalizacion-ia/instrumento/%s/estado", CLIENT_ID);

#if MODO_OFFLINE
  Serial.println("[offline] MODO_OFFLINE=1 — no se intenta WiFi ni MQTT.");
  Serial.println("[offline] Los datos salen solo por Serial (JSON) para el modo USB de la web.");
  mostrarEstado("Modo offline");
  delay(800);
#else
  mostrarEstado("WiFi...");
  conectarWiFi();

  #if MQTT_PORT == 8883
    #if defined(MQTT_VALIDATE_CERT) && MQTT_VALIDATE_CERT
      net.setCACert(MQTT_CA_CERT);
    #else
      net.setInsecure(); // prototipo: no valida el certificado del broker
    #endif
  #endif

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(30);
  // El payload de los 3 sensores + el topic superan los 256 bytes por
  // defecto de PubSubClient (MQTT_MAX_PACKET_SIZE): sin esto, mqtt.publish()
  // falla EN SILENCIO (no llega nada a la web, sin ningún error visible).
  mqtt.setBufferSize(512);
  mostrarEstado("MQTT...");
  intentarConectarMQTT(); // un solo intento; si falla, loop() sigue reintentando sin bloquear
#endif

  tft.fillScreen(GC9A01A_BLACK);
}

void loop() {
#if !MODO_OFFLINE
  if (WiFi.status() != WL_CONNECTED) conectarWiFi();
  intentarConectarMQTT();
  mqtt.loop();
#endif

  unsigned long ahora = millis();
  if (ahora - ultimaLectura < INTERVALO_MS) return;
  ultimaLectura = ahora;

  /* --- 1. Acelerómetro: inclinación en los ejes X e Y --- */
  float accelX = 0.0f, accelY = 0.0f, inclinacion = 0.0f, inclinacionX = 0.0f;
  bool cambioBrusco = false;
  if (accelOk) {
    sensors_event_t event;
    accel.getEvent(&event);
    accelX = event.acceleration.x;
    accelY = event.acceleration.y;

    // Componente de gravedad en cada eje -> ángulo respecto de la horizontal.
    float proporcionY = constrain(accelY / 9.80665f, -1.0f, 1.0f);
    inclinacion = degrees(asin(proporcionY)); // -90 a 90 (eje Y)

    float proporcionX = constrain(accelX / 9.80665f, -1.0f, 1.0f);
    inclinacionX = degrees(asin(proporcionX)); // -90 a 90 (eje X)

    if (!isnan(anguloAnterior)) {
      cambioBrusco = fabs(inclinacion - anguloAnterior) > UMBRAL_CAMBIO_BRUSCO;
    }
    anguloAnterior = inclinacion;
  }

  /* --- 2. Color dominante (normalizado, no solo "tapado") --- */
  uint8_t rNorm = 0, gNorm = 0, bNorm = 0;
  char colorHex[8] = "#000000";
  const char *dominante = "sin luz";
  if (tcsOk) {
    uint16_t r, g, b, c;
    tcs.getRawData(&r, &g, &b, &c);
    if (c < 1) c = 1; // evita división por cero con muy poca luz

    float rf = constrain((r / (float) c) * 255.0f, 0.0f, 255.0f);
    float gf = constrain((g / (float) c) * 255.0f, 0.0f, 255.0f);
    float bf = constrain((b / (float) c) * 255.0f, 0.0f, 255.0f);

    if (!colorInicializado) {
      rSuave = rf; gSuave = gf; bSuave = bf;
      colorInicializado = true;
    }
    rSuave += ALPHA_COLOR * (rf - rSuave);
    gSuave += ALPHA_COLOR * (gf - gSuave);
    bSuave += ALPHA_COLOR * (bf - bSuave);

    rNorm = (uint8_t) rSuave;
    gNorm = (uint8_t) gSuave;
    bNorm = (uint8_t) bSuave;

    snprintf(colorHex, sizeof(colorHex), "#%02X%02X%02X", rNorm, gNorm, bNorm);

    int maxVal = max(rNorm, max(gNorm, bNorm));
    int minVal = min(rNorm, min(gNorm, bNorm));
    if (maxVal - minVal < 15)      dominante = "equilibrado";
    else if (maxVal == rNorm)      dominante = "rojo";
    else if (maxVal == gNorm)      dominante = "verde";
    else                            dominante = "azul";
  }

  /* --- 3. Potenciómetro / SoftPot: control 0-100 --- */
  int crudoPot = analogRead(PIN_POT);
  float potMapeado = crudoPot * (100.0f / 1023.0f);
  if (!potInicializado) { potSuave = potMapeado; potInicializado = true; }
  potSuave += ALPHA_POT * (potMapeado - potSuave);

  /* --- Publicar los 3 sensores por separado --- */
  char payload[384];
  snprintf(payload, sizeof(payload),
    "{\"clientId\":\"%s\",\"timestamp\":%lu,\"accelX\":%.2f,\"accelY\":%.2f,"
    "\"inclinacionX\":%.1f,\"inclinacion\":%.1f,"
    "\"cambioBrusco\":%s,\"colorR\":%d,\"colorG\":%d,\"colorB\":%d,\"colorHex\":\"%s\","
    "\"colorDominante\":\"%s\",\"controlValor\":%.1f}",
    CLIENT_ID, (unsigned long) millis(), accelX, accelY, inclinacionX, inclinacion,
    cambioBrusco ? "true" : "false", rNorm, gNorm, bNorm, colorHex, dominante, potSuave);

#if !MODO_OFFLINE
  bool publicado = mqtt.publish(topicEstado, payload);
  if (mqtt.connected() && !publicado) {
    Serial.printf("[mqtt] publish FALLÓ (paquete ~%d bytes; revisa mqtt.setBufferSize)\n",
                  (int) (strlen(topicEstado) + strlen(payload)));
  }
#endif
  Serial.println(payload); // línea JSON limpia — la web la puede leer por USB (Web Serial), sin MQTT
  actualizarPantalla(accelY, inclinacion, inclinacionX, cambioBrusco, rNorm, gNorm, bNorm, colorHex, dominante, potSuave, mqtt.connected());

  Serial.printf("accelX=%.2f accelY=%.2f incX=%.1f incY=%.1f brusco=%s | color=%s (%s) | pot=%.0f\n",
                accelX, accelY, inclinacionX, inclinacion, cambioBrusco ? "SI" : "no", colorHex, dominante, potSuave);
}
