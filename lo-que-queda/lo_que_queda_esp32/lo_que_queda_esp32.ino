// Lo que queda — simulación de la respuesta galvánica de la piel (GSR) con ESP32 DevKit y encoder KY-040
//
// La perilla fija la INTENSIDAD del estímulo (0 a 360°). El ESP32 la convierte en una señal con
// forma de conductancia de la piel: retardo, subida rápida, bajada lenta, base y ruido.
// Cada vez que la plataforma cambia de imagen avisa con "N,<n>" y la intensidad cae a 0 en 3 s.
// El botón de la perilla pasa a la imagen siguiente.
//
// Conexiones (el KY-040 se alimenta con 3,3 V, no con 5 V):
//   KY-040 CLK -> GPIO 32     KY-040 DT -> GPIO 33     KY-040 SW -> GPIO 25
//   KY-040 +   -> 3V3         KY-040 GND -> GND
//
// Protocolo serial, 115200 baudios, una línea por mensaje:
//   ESP32 -> página:  G,<0-1023>  señal, 25 veces por segundo
//                     B           botón presionado
//                     K,<grados>  posición de la perilla (cuando cambia)
//                     A,<n>       acuse de "N,<n>"
//                     H,esp32-gsr,1  saludo (al arrancar y ante "?")
//   página -> ESP32:  N,<n>       cambió la imagen (la n-ésima de la sesión)
//                     S,1 / S,0   comienza / termina la sesión (deja todo en reposo)
//                     ?           ¿quién eres?

// ---------- Pines ----------
const int PIN_CLK = 32;
const int PIN_DT  = 33;
const int PIN_SW  = 25;

// ---------- Parámetros (ajustables) ----------
const int   PASOS_POR_VUELTA   = 20;      // KY-040: 20 pasos por vuelta (18° cada uno)
const bool  INVERTIR_GIRO      = false;   // pon true si girar a la derecha resta
const float TIEMPO_REINICIO_S  = 3.0;     // la intensidad cae a 0 en este tiempo
const float TAU_REINICIO_S     = 0.75;    // constante de la caída exponencial
constexpr float RETARDO_S      = 1.0;     // latencia fisiológica entre estímulo y respuesta
const float TAU_SUBIDA_S       = 0.7;     // la señal sube rápido
const float TAU_BAJADA_S       = 2.5;     // y baja lento
const float BASE               = 0.10;    // nivel tónico (0 a 1)
const float RANGO              = 0.90;    // cuánto sube con la perilla al máximo (0 a 1)
const float RUIDO              = 0.002;   // ruido (± fracción del rango)
const float DERIVA             = 0.003;   // oscilación lenta del nivel de base
const unsigned long PERIODO_MS = 40;      // 25 Hz
const unsigned long ANTIRREBOTE_BOTON_MS = 250;

// ---------- Encoder (decodificación por tabla de estados, sin pasos perdidos) ----------
#define R_START 0x0
#define R_CW_FINAL 0x1
#define R_CW_BEGIN 0x2
#define R_CW_NEXT 0x3
#define R_CCW_BEGIN 0x4
#define R_CCW_FINAL 0x5
#define R_CCW_NEXT 0x6
#define DIR_CW 0x10
#define DIR_CCW 0x20
const unsigned char tablaEstados[7][4] = {
  {R_START,    R_CW_BEGIN,  R_CCW_BEGIN, R_START},
  {R_CW_NEXT,  R_START,     R_CW_FINAL,  R_START | DIR_CW},
  {R_CW_NEXT,  R_CW_BEGIN,  R_START,     R_START},
  {R_CW_NEXT,  R_CW_BEGIN,  R_CW_FINAL,  R_START},
  {R_CCW_NEXT, R_START,     R_CCW_BEGIN, R_START},
  {R_CCW_NEXT, R_CCW_FINAL, R_START,     R_START | DIR_CCW},
  {R_CCW_NEXT, R_CCW_FINAL, R_CCW_BEGIN, R_START}
};
volatile unsigned char estadoEncoder = R_START;
volatile int pasosPendientes = 0;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

void IRAM_ATTR leerEncoder() {
  unsigned char entrada = (digitalRead(PIN_DT) << 1) | digitalRead(PIN_CLK);
  portENTER_CRITICAL_ISR(&mux);
  estadoEncoder = tablaEstados[estadoEncoder & 0xf][entrada];
  unsigned char dir = estadoEncoder & 0x30;
  if (dir == DIR_CW) pasosPendientes++;
  else if (dir == DIR_CCW) pasosPendientes--;
  portEXIT_CRITICAL_ISR(&mux);
}

// ---------- Estado del modelo ----------
const float PASOS_MAX = PASOS_POR_VUELTA;     // 360° = PASOS_POR_VUELTA pasos
float restoViejo = 0;           // intensidad de la imagen anterior, que va cayendo
float aporteNuevo = 0;          // pasos girados desde que apareció la imagen actual
unsigned long inicioReinicio = 0;
bool reiniciando = false;

constexpr int N_RETARDO = (int)(RETARDO_S * 25) + 1;   // muestras a 25 Hz, más una
float lineaRetardo[N_RETARDO];
int posRetardo = 0;
float salidaFiltrada = 0;

unsigned long ultimaMuestra = 0;
unsigned long ultimoBoton = 0;
unsigned long ultimoK = 0;
int ultimoSw = HIGH;
int ultimoGrados = -1;
String linea;

float total() { return constrain(restoViejo + aporteNuevo, 0.0f, PASOS_MAX); }

void reposo() {
  restoViejo = 0; aporteNuevo = 0; reiniciando = false; salidaFiltrada = 0;
  for (int i = 0; i < N_RETARDO; i++) lineaRetardo[i] = 0;
  portENTER_CRITICAL(&mux); pasosPendientes = 0; portEXIT_CRITICAL(&mux);
}

void nuevaImagen(int n) {
  restoViejo = total();          // lo acumulado empieza a caer; los giros nuevos se suman aparte
  aporteNuevo = 0;
  inicioReinicio = millis();
  reiniciando = true;
  Serial.print("A,"); Serial.println(n);
}

void saludo() { Serial.println("H,esp32-gsr,1"); }

void procesarComando(String c) {
  c.trim();
  if (c.length() == 0) return;
  if (c.startsWith("N,")) nuevaImagen(c.substring(2).toInt());
  else if (c == "S,1" || c == "S,0") reposo();
  else if (c == "?") saludo();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_CLK, INPUT_PULLUP);
  pinMode(PIN_DT, INPUT_PULLUP);
  pinMode(PIN_SW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_CLK), leerEncoder, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_DT), leerEncoder, CHANGE);
  randomSeed(esp_random());
  reposo();
  delay(300);
  saludo();
}

void loop() {
  unsigned long ahora = millis();

  // Comandos desde la página
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { procesarComando(linea); linea = ""; }
    else if (ch != '\r' && linea.length() < 40) linea += ch;
  }

  // Botón del encoder (con antirrebote simple)
  int sw = digitalRead(PIN_SW);
  if (sw == LOW && ultimoSw == HIGH && ahora - ultimoBoton > ANTIRREBOTE_BOTON_MS) {
    Serial.println("B");
    ultimoBoton = ahora;
  }
  ultimoSw = sw;

  // Un ciclo del modelo cada 40 ms
  if (ahora - ultimaMuestra >= PERIODO_MS) {
    float dt = (ahora - ultimaMuestra) / 1000.0f;
    ultimaMuestra = ahora;

    // 1. Giros nuevos
    int pasos;
    portENTER_CRITICAL(&mux); pasos = pasosPendientes; pasosPendientes = 0; portEXIT_CRITICAL(&mux);
    if (INVERTIR_GIRO) pasos = -pasos;
    if (pasos != 0) {
      aporteNuevo += pasos;
      // La perilla se detiene en 0° y en 360°: no da la vuelta
      if (restoViejo + aporteNuevo > PASOS_MAX) aporteNuevo = PASOS_MAX - restoViejo;
      if (restoViejo + aporteNuevo < 0) aporteNuevo = -restoViejo;
    }

    // 2. Caída gradual de la intensidad anterior (exponencial, a cero en TIEMPO_REINICIO_S)
    if (reiniciando) {
      float t = (ahora - inicioReinicio) / 1000.0f;
      if (t >= TIEMPO_REINICIO_S) { restoViejo = 0; reiniciando = false; }
      else restoViejo *= expf(-dt / TAU_REINICIO_S);
    }

    // 3. Intensidad normalizada, retardo fisiológico y filtro asimétrico
    float u = total() / PASOS_MAX;
    lineaRetardo[posRetardo] = u;
    posRetardo = (posRetardo + 1) % N_RETARDO;
    float retrasada = lineaRetardo[posRetardo];          // la muestra más antigua: ~RETARDO_S atrás
    float tau = (retrasada > salidaFiltrada) ? TAU_SUBIDA_S : TAU_BAJADA_S;
    salidaFiltrada += (retrasada - salidaFiltrada) * (1.0f - expf(-dt / tau));

    // 4. Base, deriva lenta y ruido
    float deriva = DERIVA * sinf(2.0f * PI * ahora / 40000.0f);
    float ruido = RUIDO * ((random(2001) - 1000) / 1000.0f);
    float v = constrain(BASE + RANGO * salidaFiltrada + deriva + ruido, 0.0f, 1.0f);
    Serial.print("G,"); Serial.println((int)(v * 1023.0f + 0.5f));

    // 5. Posición de la perilla, a lo más 5 veces por segundo y solo si cambió
    int grados = (int)(total() * 360.0f / PASOS_MAX + 0.5f);
    if (grados != ultimoGrados && ahora - ultimoK >= 200) {
      Serial.print("K,"); Serial.println(grados);
      ultimoGrados = grados; ultimoK = ahora;
    }
  }
}
