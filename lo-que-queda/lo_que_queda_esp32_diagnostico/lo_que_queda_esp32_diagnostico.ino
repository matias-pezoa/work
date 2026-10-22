// Diagnóstico del encoder KY-040 en ESP32 DevKit. No usa interrupciones: lee los pines en cada vuelta del loop.
// Abre el Monitor Serie a 115200 baudios y gira la perilla y presiona el botón.
//
// Qué esperar:
//   Sin tocar nada, los tres pines deben estar en 1 (CLK=1 DT=1 SW=1).
//   Al girar un paso, CLK y DT deben cambiar de 1 a 0 y volver, en orden distinto según el sentido.
//   Al presionar el botón, SW debe pasar a 0.
// Si algún pin se queda siempre en 0 o siempre en 1 al mover la perilla, ese cable o ese pin está mal.

const int PIN_CLK = 32;
const int PIN_DT  = 33;
const int PIN_SW  = 25;

int uClk = -1, uDt = -1, uSw = -1;
long pasos = 0;
int estadoPrevio = 3;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_CLK, INPUT_PULLUP);
  pinMode(PIN_DT, INPUT_PULLUP);
  pinMode(PIN_SW, INPUT_PULLUP);
  delay(300);
  Serial.println("Diagnostico del encoder. Gira la perilla y presiona el boton.");
}

void loop() {
  int clk = digitalRead(PIN_CLK);
  int dt = digitalRead(PIN_DT);
  int sw = digitalRead(PIN_SW);

  if (clk != uClk || dt != uDt || sw != uSw) {
    Serial.print("CLK="); Serial.print(clk);
    Serial.print(" DT="); Serial.print(dt);
    Serial.print(" SW="); Serial.println(sw);
    uClk = clk; uDt = dt; uSw = sw;
  }

  // Conteo simple en cada flanco de bajada de CLK
  static int clkPrevio = 1;
  if (clk != clkPrevio && clk == LOW) {
    if (dt != clk) pasos++; else pasos--;
    Serial.print(">>> paso detectado, total = "); Serial.println(pasos);
  }
  clkPrevio = clk;
}
