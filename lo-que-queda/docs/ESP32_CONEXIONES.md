# Conexiones: ESP32 DevKit + encoder KY-040

```
        ESP32 DevKit (vista desde arriba, USB abajo)

                 ┌───────[ USB ]───────┐
            3V3 ─┤ 3V3            GND  ├─ GND
                 │                     │
         GPIO33 ─┤ D33 (DT)            │
         GPIO32 ─┤ D32 (CLK)           │
         GPIO25 ─┤ D25 (SW)            │
            GND ─┤ GND                 │
                 └─────────────────────┘

   ESP32                         KY-040
   ─────                         ──────
   3V3   ───────── rojo ───────  +
   GND   ───────── negro ──────  GND
   GPIO32 ──────── amarillo ───  CLK
   GPIO33 ──────── verde ──────  DT
   GPIO25 ──────── azul ───────  SW

   Computador ══ cable USB (datos) ══ ESP32
```

| KY-040 | ESP32 DevKit | Función |
|---|---|---|
| `+` | 3V3 | Alimentación (**3,3 V**, no 5 V) |
| `GND` | GND | Tierra |
| `CLK` | GPIO 32 | Fase A del encoder |
| `DT` | GPIO 33 | Fase B del encoder |
| `SW` | GPIO 25 | Botón (pasa a la imagen siguiente) |

Notas:

- El módulo KY-040 trae resistencias de 10 kΩ hacia `+` en CLK, DT y SW. Por eso funciona con 3,3 V y no necesita componentes extra. El sketch además activa las resistencias internas del ESP32.
- Si alimentas el módulo con 5 V, los pines enviarían 5 V a entradas del ESP32 que aguantan 3,3 V. Eso puede dañar la placa.
- Los GPIO 32, 33 y 25 no interfieren con el arranque del ESP32 (a diferencia de GPIO 0, 2, 12 y 15).
- Si al girar a la derecha el valor baja, intercambia los cables de CLK y DT, o pon `INVERTIR_GIRO = true` en el sketch.
- Usa un cable USB **de datos**: algunos cables solo cargan y la placa no aparece como puerto.
- Si no aparece el puerto COM, instala el controlador del conversor USB de tu placa (CP210x o CH340, según el modelo).
- Cierra el Monitor Serie del IDE antes de conectar desde la página: solo un programa puede usar el puerto a la vez.
