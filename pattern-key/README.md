# PATTERN KEY

**Chroma key basado en patrones textiles.** Herramienta experimental y educativa para estudiantes de diseño de moda.

Funciona como un chroma key, pero en vez de buscar un verde o un azul busca un **rapport** (el módulo de un estampado). La persona lleva una prenda con el rapport impreso, la app lo reconoce en la imagen de la cámara y genera una máscara sobre la que después se aplica un efecto visual.

Todo corre en el navegador (HTML + JavaScript + Canvas + OpenCV.js). No hay backend, cuentas ni servicios de pago.

---

## Cómo probarla en local

La cámara (`getUserMedia`) solo funciona en `https://` o en `localhost`, y los módulos JavaScript no cargan si se abre `index.html` con doble clic. Por eso hace falta un servidor local:

```bash
node serve.mjs
```

Luego abre <http://localhost:8080> en Chrome o Edge.

1. **Cargar rapport**: un PNG o JPG del módulo del estampado, o el botón *Usar rapport de ejemplo*.
2. **Abrir cámara**: en el móvil usa la cámara trasera por defecto.
3. Cambia a **MASK** (tecla `2`) y mueve *Sensibilidad* y *Suavizado* hasta que el estampado se vea blanco y el resto negro.
4. Ajusta *Persistencia* según el movimiento: más alta = máscara más quieta, pero sigue la tela con más retraso.

Los sliders se recuerdan en el navegador entre sesiones. *Restablecer valores* vuelve a los de fábrica. Atajos de vista: `1` ORIGINAL · `2` MASK · `3` EFFECT · `4` COMPOSITE.

Para probar sin cámara está *Fuentes de prueba → Escena sintética*: unas piernas que se mueven con el rapport estampado, sombras, ruido de sensor, una mano que tapa y una "chaqueta" lisa del mismo color de fondo del rapport, que funciona como trampa.

---

## Arquitectura

```
pattern-key/
├── index.html            interfaz
├── styles.css
├── serve.mjs             servidor local mínimo (solo para desarrollo)
├── js/
│   ├── app.js            orquestador: estado, UI, render loop y CV loop
│   ├── camera.js         cámara (getUserMedia) y video local
│   ├── detector.js       carga de OpenCV.js y mapa de similitud del rapport
│   ├── mask.js           umbral, morfología, suavizado y persistencia
│   ├── effects.js        efectos y composición con la máscara
│   ├── recorder.js       grabación con MediaRecorder (fase 5)
│   └── synthetic.js      escena sintética de prueba
├── tools/
│   └── eval-synthetic.js mide la calidad de la máscara (precisión / recall / IoU)
└── assets/examples/      rapports de ejemplo
```

### Dos bucles separados

| Bucle | Frecuencia | Qué hace |
|---|---|---|
| **Render** (`requestAnimationFrame`) | 30–60 fps | dibuja el video y la **última** máscara disponible |
| **Computer vision** (`setTimeout`) | ~12 fps | reduce el frame a 320×180, calcula la similitud y actualiza la máscara |

La máscara se calcula en baja resolución y se reescala al componer, así que el video final no pierde fluidez aunque el análisis sea más lento.

### Pipeline

```
frame 1280×720 → reducción a 320×180 → cuantización HSV
   → A · color   (back-projection por razón)
   → B · receta  (intersección de histogramas por bloques)
   → C · rasgos  (ORB + matching Hamming)
   → mapa de similitud 0..1
   → umbral (Sensibilidad) → open/close + blur (Suavizado)
   → histéresis + persistencia temporal (Persistencia)
   → máscara → reescalado → composición
```

---

## Detección: estrategia y hallazgos (fase 2)

Un rapport **no es un color**: es una combinación de colores en ciertas proporciones, más un dibujo. Como la tela se estira, rota y se arruga, el detector **no** busca una transformación geométrica global (homografía). Busca **evidencia local** de que en cada zona hay rapport.

**A · Color.** Se calcula el histograma HSV del rapport y se divide por el del frame (método de Swain y Ballard). Los colores del rapport que son raros en el resto de la escena valen 1, y los que no están en el rapport valen 0. Aguanta bien la rotación, la escala y la deformación. Falla cuando el fondo comparte colores con el estampado. Para tolerar las sombras, el valor (V) usa pocos bins y los píxeles poco saturados se clasifican solo por luminosidad.

**B · Receta.** Para ventanas de dos tamaños compara la *mezcla* de colores de la zona con la del rapport. También exige que aparezcan los **colores secundarios**: no basta el color de fondo del estampado. Así se distingue un suéter azul marino liso de unas leggings azul marino con flores.

**C · ORB.** Busca puntos característicos del dibujo y los compara con los del rapport (teselado 2×2 para que los motivos del borde queden completos). Cada coincidencia suma en su entorno, y esta señal solo **refuerza** zonas donde el color ya coincide.

`similitud = √(color × receta) + 0.5 · ORB · √color`

### Medición sobre la escena sintética

Medido con `tools/eval-synthetic.js` en 8 instantes de movimiento, con la chaqueta trampa del mismo color de fondo:

| Sensibilidad | Precisión | Recall | IoU |
|---|---|---|---|
| 40 | 0.99 | 0.70 | 0.69 |
| 50 | 0.97 | 0.75 | 0.73 |
| 60 | 0.94 | 0.79 | 0.75 |
| 70 | 0.91 | 0.82 | 0.76 |

Con la escala del estampado entre ×0.6 y ×2.5 el IoU se mantiene entre 0.72 y 0.76. El análisis tarda unos 30–45 ms por frame en un PC de escritorio.

### Limitaciones detectadas (honestas)

- **ORB casi no aporta en textiles.** Con estampados pequeños, tela deformada o desenfoque de movimiento hay muy pocas coincidencias: entre 0 y 77 por frame, y casi siempre menos de 5. Las señales A y B hacen el trabajo. ORB queda como refuerzo opcional y puede servir con estampados grandes vistos de cerca. Por eso **no conviene construir el sistema sobre ORB/homografía**: se rompe justo con lo que hace la tela.
- **El color sigue siendo la base.** Si el fondo de la escena tiene *la misma mezcla* de colores que el rapport, por ejemplo otra prenda con el mismo estampado o una pared muy parecida, se detectará también. Para la práctica: fondos neutros y rapports con al menos 2–3 colores distintos.
- **Rapports monocromos** (negro sobre blanco, por ejemplo) dependen solo de la luminosidad y de ORB, así que son mucho menos robustos.
- **Bordes:** la máscara se ensancha unos píxeles alrededor de la prenda a sensibilidad alta.
- La escena sintética no reemplaza una prueba con cámara y tela real. Hay que validarla así.

### Plan B, si con tela real no basta

Una **segunda estrategia** que sigue siendo gratuita, client-side y sencilla es entrenar en el navegador un **clasificador de parches** con TensorFlow.js:

1. Con el rapport cargado se generan automáticamente miles de parches aumentados (rotación, escala, perspectiva, brillo, desenfoque) como ejemplos positivos. Los negativos salen del fondo de la cámara cuando no aparece la prenda.
2. Se entrena una red muy pequeña (≈ 20k parámetros) durante 20–40 segundos en el mismo navegador (WebGL).
3. La red clasifica una grilla de parches por frame y produce el mapa de similitud, que sustituye a A + B + C. El resto del pipeline (máscara, persistencia, efectos) no cambia.

Este enfoque aprende la *textura* además del color, y tolera mejor las sombras y los fondos parecidos.

---

## Estabilización temporal (fase 3)

En un video real la cámara mete ruido distinto en cada frame. Sin memoria, los píxeles que están cerca del umbral se encienden y apagan sin parar, y la máscara "hierve". Hay tres mecanismos, todos en [js/mask.js](js/mask.js):

1. **Histéresis.** Un píxel que ya era rapport necesita un poco *menos* similitud para seguir siéndolo, y uno nuevo necesita un poco *más* (±0.06 sobre el umbral). Esto elimina el on/off en los bordes.
2. **Persistencia (media móvil exponencial).**
   `maskFinal = previousMask · p + currentMask · (1 − p)`.
   `p` se ajusta al tiempo real entre análisis: si el análisis va más lento (móvil), cada paso pesa más y la máscara responde igual de rápido en segundos.
3. **Interpolación en el render.** El análisis corre a unos 12 fps y el video a 60. El render funde las dos últimas máscaras, así el borde se desliza en vez de avanzar a saltos.

Al cambiar de rapport o de fuente, la memoria se borra.

### Medición

Medido con `evaluateSequence` sobre la escena sintética: 12 fps, ruido de sensor, sensibilidad 50.

| Persistencia | Parpadeo con la prenda quieta | IoU en movimiento | Retraso |
|---|---|---|---|
| 0 | 4.22 % | 0.709 | 42 % |
| 20 | 0.18 % | 0.711 | 53 % |
| **40** (por defecto) | **0.02 %** | **0.709** | **57 %** |
| 60 | 0.03 % | 0.704 | 62 % |
| 80 | 0.03 % | 0.684 | 70 % |

*Parpadeo*: cuánto cambia la máscara entre frames donde la prenda no se movió (% del área del estampado). *Retraso*: de los píxeles donde la prenda sí se movió, cuántos la máscara todavía no siguió. Incluye los bordes que el detector ya pierde sin persistencia; por eso con 0 ya vale 42 %.

**Conclusión.** Pasado 40, el parpadeo ya no baja y lo único que crece es la estela. Valores altos (60–80) sirven para tomas casi quietas o para un efecto de "arrastre" buscado.

## Estado por fases

- [x] **Fase 1:** interfaz, carga de rapport, cámara, canvas, render loop y vista ORIGINAL
- [x] **Fase 2:** detección experimental, vista MASK y depuración de las señales A/B/C
- [x] **Fase 3:** estabilización temporal (histéresis, persistencia, interpolación), sliders que se recuerdan, restablecer y atajos
- [x] **Fase 4:** efectos (Distortion, RGB Shift, Pixelation, Blur, Noise, Displacement)
- [ ] **Fase 5:** grabación (MediaRecorder)
- [ ] **Fase 6:** optimización móvil y GitHub Pages

## Consola (para experimentar)

```js
PK.params                         // valores de los sliders
PK.detector.maps                  // mapas color / recipe / orb / sim (Float32, 320×180)
PK.detector.timings               // milisegundos por etapa
const T = await import("./tools/eval-synthetic.js");
await T.evaluate({ sensitivity: 60 });                         // frames sueltos
await T.evaluateSequence({ persistence: 40 });                 // secuencia en movimiento
await T.evaluateSequence({ persistence: 40 }, { still: true }); // prenda quieta: solo parpadeo
```
