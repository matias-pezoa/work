/*
 * secrets_example.h
 * -----------------------------------------------------------------
 * PLANTILLA. Copia este archivo como  secrets.h  (en la misma carpeta)
 * y completa tus valores. secrets.h está en .gitignore y NO se sube al
 * repositorio — las credenciales se mantienen fuera del código, igual
 * que en bridge/config.js y el Anexo MQTT del curso.
 *
 *   cp secrets_example.h secrets.h     (macOS/Linux)
 *   copy secrets_example.h secrets.h   (Windows)
 */
#pragma once

/* ---- WiFi ---- */
#define WIFI_SSID     "tu-red-wifi"
#define WIFI_PASSWORD "tu-password-wifi"

/* ---- Broker MQTT ----
 * EMQX Cloud Serverless (Anexo MQTT del curso) u otro broker.
 *   MQTT_PORT 8883  -> MQTT sobre TLS   (broker en la nube)
 *   MQTT_PORT 1883  -> MQTT sin cifrar  (Mosquitto local en tu red)
 * El host va SIN "mqtts://" ni "/mqtt": solo el dominio.
 */
#define MQTT_HOST "xxxxxxxx.emqxsl.com"
#define MQTT_PORT 8883
#define MQTT_USER "usuario-mqtt"
#define MQTT_PASS "password-mqtt"

/* Identificador de este instrumento. Aparece en el topic
 * (.../instrumento/<CLIENT_ID>/estado) y dentro del payload.
 * Usa uno distinto por cada ESP32 si hay más de uno. */
#define CLIENT_ID "instrumento-esp32-01"

/* ---- Validación del certificado TLS (solo si MQTT_PORT == 8883) ----
 * Por defecto (sin definir MQTT_VALIDATE_CERT) el sketch usa
 * net.setInsecure(): se conecta por TLS pero NO valida la identidad del
 * broker. Es lo habitual para un prototipo de baja resolución.
 *
 * Para validar de verdad: pon MQTT_VALIDATE_CERT en 1 y pega abajo el
 * certificado raíz de la CA de tu broker en formato PEM. EMQX Serverless
 * usa "ISRG Root X1" (Let's Encrypt); lo descargas desde
 * https://letsencrypt.org/certs/isrgrootx1.pem
 */
#define MQTT_VALIDATE_CERT 0

#if defined(MQTT_VALIDATE_CERT) && MQTT_VALIDATE_CERT
static const char MQTT_CA_CERT[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
...pega aquí el PEM de la CA raíz de tu broker...
-----END CERTIFICATE-----
)EOF";
#endif
