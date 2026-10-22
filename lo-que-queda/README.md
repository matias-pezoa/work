# Lo que queda — prototipo de desgaste por mirada (v2)

Un feed vertical en que **las zonas que miras se gastan**: se pixelan, sus colores se mezclan hasta volverse manchones y al final se blanquean hasta quedar completamente blancas. Si una imagen no provoca respuesta en la piel, las zonas que miraste en ella se gastan más. Cuando el cuerpo deja de responder durante varias imágenes seguidas, el feed se cierra y aparece un informe con los mapas de calor de la mirada.

Usa el sistema de diseño de *Desnaturalización IA* (Computación Avanzada 2026): monocromo, líneas de 1 px, sin esquinas redondeadas, grano fino, barras fijas arriba y abajo, dock numerado a la derecha, lectura en vivo abajo a la izquierda y título en verde lima.

## Archivos

- `index.html`: la experiencia completa y el dock del operador.
- `corpus/`: imágenes del feed y `manifest.json` con su lista (ver `corpus/LEEME.md`). Si la lista está vacía se usan 12 imágenes de demostración.
- `assets/fonts/`: tipografías (ver `assets/fonts/LEEME.md`). Si faltan, se usan fuentes del sistema.
- `vendor/webgazer/`: WebGazer 3.5.3 y su modelo de rostro (MediaPipe), incluidos para que el eye tracking funcione sin conexión. Licencia GPL v3.
- `lo_que_queda_esp32/lo_que_queda_esp32.ino`: sketch del ESP32 DevKit con encoder KY-040, que simula la respuesta de la piel. No se ejecuta en la web.
- `lo_que_queda_esp32_diagnostico/lo_que_queda_esp32_diagnostico.ino`: sketch para probar el encoder y el botón por el Monitor Serie.
- `docs/ESP32_SIMULACION_GSR.md`: análisis de la respuesta galvánica, protocolo serial y esquemas de flujo. `docs/ESP32_CONEXIONES.md`: conexiones del ESP32 con el KY-040.
- `LICENSE`: GPL v3 (necesaria por incluir WebGazer).

## Publicación en GitHub Pages

En el repositorio: Settings → Pages → Deploy from a branch → `main` → `/ (root)`. El sitio queda en https://fefeliperoar.github.io/lo-que-queda/. Pages usa HTTPS, así que la cámara y el USB funcionan sin `localhost`.

Los datos (desgaste, mapas, sesiones) se guardan en el `localStorage` del navegador: cada dispositivo tiene los suyos y no pasan de `localhost` a `github.io`. Exporten con frecuencia.

## Cómo abrirlo en local

La cámara y el ESP32 (USB) solo funcionan desde `localhost` o https:

```
cd lo-que-queda
python3 -m http.server 8000
```

Abran `http://localhost:8000` en Chrome o Edge y den permiso de cámara. La tecla **D** muestra el dock durante la experiencia del visitante. El ESP32 (Web Serial) solo funciona en Chrome o Edge de escritorio.

## Flujo del visitante

1. **Inicio**: explica la regla.
2. **Calibración de la mirada** (solo con cámara): nueve puntos, cinco clics en cada uno mirándolo. Después, un punto verde se mira sin hacer clic durante 2,5 s y se calcula la **precisión** en píxeles. Bajo 150 px es aceptable; si no, conviene repetir.
3. **Calibración de la piel**: 20 s de reposo para fijar el umbral personal.
4. **Feed**: las zonas miradas se gastan en tiempo real.
5. **Cierre** e **informe**.

## Cómo se gasta una imagen

La imagen se divide en una grilla de 27 × 48 celdas. Cada lectura de la mirada deja una mancha gaussiana (porque el eye tracking por cámara tiene un error de 100 a 200 px) que suma desgaste en esas celdas. Según su nivel de desgaste, cada celda:

| Desgaste | Efecto |
|---|---|
| 0,05 a 0,45 | **Licuado**: la imagen se derrite y gotea; cada franja de 5 px toma la imagen desde un punto desplazado por un campo de flujo suave que cambia lento con el tiempo |
| 0 a 0,55 | Pixelado creciente (bloques de 1 a 27 px; cada bloque promedia sus colores) |
| 0,2 a 0,85 | **Datamosh**, por macrobloques de 40 px: bloques que saltan en la dirección en que se mueve la mirada, copiados del cuadro anterior (como un video al que le faltan los cuadros clave; al cambiar de imagen, la anterior se filtra en las zonas gastadas), y bloques *sangrados*, donde una sola fila de píxeles se estira hacia abajo |
| 0,3 a 0,6 | Los bloques se funden en manchones de color: imagen reducida a pocos tonos, desenfocada y más saturada |
| 0,8 a 1 | Blanqueo; en 1 la celda queda blanca |

Cuando todas las celdas llegan a 1, la imagen queda completamente blanca. El desgaste se guarda por imagen y se **comparte entre todos los visitantes**: cada persona recibe las imágenes como las dejó la anterior.

Si una imagen no provoca respuesta en la piel, se le suma un desgaste extra proporcional a cuánto se miró cada zona durante esa vista (por defecto, el doble del desgaste normal).

## Fabricación: la visita como un tubo (07 · Fabricación)

Cada visita se materializa como **una sola figura abstracta en forma de tubo** (pipe), continua de principio a fin:

| Eje / rasgo | Dato de la visita |
|---|---|
| **x, y** (recorrido) | La trayectoria de la mirada sobre la imagen, suavizada y escalada sin deformar para llenar la huella (ancho × ancho · 16/9) |
| **z** (altura) | La señal del sensor de piel en ese mismo instante, normalizada dentro de la visita: más activación, más arriba |
| **Grosor** | La quietud de la mirada: donde se detuvo (fijación) el tubo engorda, donde saltó rápido adelgaza; si la zona mirada estaba gastada, también adelgaza. Usa todo el rango entre el radio mínimo y el máximo |

El tubo se barre con marcos que minimizan la torsión, termina en tapas redondas y sus puntos más bajos se aplanan para apoyarse en la cama. Es una figura con arcos y voladizos, y el tubo puede cruzarse consigo mismo: se lamina en el slicer **con soportes** (los de árbol funcionan bien), que une los cruces al cortar.

| Parámetro | Por defecto |
|---|---|
| Ancho de la huella | 90 mm (fondo hasta 160 mm) |
| Alto | 120 mm |
| Radio del tubo | 4 a 16 mm |
| Suavizado de la trayectoria | 1,2 s |

La señal del sensor se guarda con cada sesión a 10 Hz (`senal`), junto a la trayectoria. Si el almacenamiento del navegador se llena, se descartan primero la trayectoria y la señal de las sesiones más antiguas. Las visitas sin trayectoria o sin señal guardada no pueden generar el tubo.

Dónde se descarga:
- **Informe final**: vista previa del tubo de la visita, **Descargar figura 3D (3MF)** y **(STL)**.
- **Panel 07** (tecla D): elegir cualquier visita registrada, ajustar los parámetros, ver la vista previa y exportar 3MF o STL.

## Validación y pruebas (02 · Mirada)

| Opción | Para qué sirve |
|---|---|
| Fuente: cámara o mouse | El mouse simula la mirada para probar todo sin cámara |
| Mostrar punto de mirada | "Imprime" en pantalla dónde cree el sistema que estás mirando |
| Mapa de calor en vivo | Superpone sobre la imagen el mapa de la sesión en curso |
| Mostrar cámara | Vista previa de WebGazer con el recuadro de la cara |
| Mostrar lectura en vivo | Señal, umbral, imágenes sin respuesta, coordenadas de la mirada, % de mirada dentro de la imagen y precisión |
| Suavizar mirada (Kalman) | Reduce el temblor del punto estimado |

Para validar el eye tracking: activen el punto de mirada, miren esquinas y objetos concretos de la imagen y comprueben que el punto los sigue. Anoten la precisión de cada calibración; queda guardada en los datos.

## El informe

- **01 Respuesta de tu piel**: una barra por imagen, con el umbral personal y la línea del cierre.
- **02 Mapas de calor**: por cada imagen vista, cuatro paneles: original, tu mirada, mirada acumulada de todos los visitantes y cómo la dejaste. Debajo, los segundos de mirada y la **zona más vista** (en una división de 3 × 3) con su porcentaje. Cada fila se descarga como PNG.
- **03 Desgaste**: cuánto más gastadas quedaron las imágenes.

Botones: descargar todos los mapas en una lámina PNG, exportar los datos de la sesión (incluida la trayectoria de la mirada en cada imagen y la señal completa), exportar la trayectoria de la mirada de la visita (CSV), descargar el 3MF y el STL del tubo de la visita, imprimir el informe, borrar el registro y terminar. Borrar elimina la sesión y su mapa personal; el desgaste de las imágenes se mantiene, y el informe lo dice.

## Datos (06 · Datos)

- **Sesiones (JSON o CSV)**: una fila por imagen vista, con fuente de la mirada, precisión, condición, umbral, motivo de cierre, amplitud de la respuesta, si respondió, permanencia, segundos de mirada dentro y fuera de la imagen y si se aplicó desgaste extra.
- **Trayectorias de la mirada (CSV)**: el recorrido de la mirada, no el mapa: una fila cada 50 ms con sesión, visitante, imagen, tiempo desde el inicio del feed (s) y posición `x, y` en fracción de la imagen (0–1, origen arriba a la izquierda). Una fila con `x, y` vacíos marca que la mirada salió de la imagen. Si el almacenamiento del navegador (~5 MB) se llena, se descartan primero las trayectorias de las sesiones más antiguas.
- **Mapas acumulados**: lámina PNG con la mirada acumulada de todos los visitantes sobre cada imagen del corpus.
- **Reiniciar desgaste y mapas** (05 · Corpus): devuelve todas las imágenes al original y borra la mirada acumulada.

Todo se guarda en el navegador del computador de la exposición. Exporten con frecuencia.

## Simular la piel con el ESP32 y el encoder

El ESP32 DevKit lee un encoder KY-040 (CLK en GPIO 32, DT en 33, SW en 25; alimentado con 3,3 V) y lo convierte en una señal con forma de respuesta galvánica de la piel. **Girar la perilla sube la «activación»**; al aparecer cada imagen la plataforma avisa por USB y la activación cae a 0 en 3 s. El **botón** de la perilla pasa a la imagen siguiente.

1. Carguen `lo_que_queda_esp32/lo_que_queda_esp32.ino` en el ESP32 desde Arduino IDE (placa «ESP32 Dev Module») y cierren el Monitor Serie.
2. Abran la página en Chrome o Edge, vayan a **01 · Conexión** y pulsen **Conectar por USB**.
3. Durante la calibración de 20 s no giren la perilla; después, giren para «responder» a cada imagen.

Detalles, parámetros y protocolo en `docs/ESP32_SIMULACION_GSR.md`. Sin ESP32, usen el control deslizante de **03 · Señal** o la tecla **R**. Registren qué protocolo usaron (Mago de Oz o autorreporte).

## Limitaciones que hay que declarar

- WebGazer estima la mirada con una cámara web común. Es suficiente para zonas amplias de la imagen, no para detalles finos. Por eso el desgaste y los mapas trabajan con manchas de unos 50 px de radio (ajustable en 04 · Parámetros).
- La precisión empeora si la persona mueve la cabeza o cambia la luz. Mantengan una distancia y una iluminación constantes, y recalibren por cada visitante.
- El desgaste es procesamiento de imagen (pixelado, mezcla de color en manchones y blanqueo), no IA generativa. Es una decisión de prototipo que conviene explicitar en la tesis.
