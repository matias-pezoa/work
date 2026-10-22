# Guia por fases — Plataforma de Modelado Parametrico Textil

> Copia de referencia de la guia original (`guia-plataforma-parametrica.md`).
> El estado real de avance vive en `CLAUDE.md` › "Estado del proyecto" — hoy
> reorganizado en dos modos (Volumen 3D / Corte laser 2D) en vez de 7 fases
> secuenciales; las fases 0-2 de esta tabla quedaron dentro de "Volumen". El
> enfoque de la Fase 1/2 (una "pluma": pared delgada barrida por una curva
> arqueada) se descarto por no ser imprimible — ver la seccion de
> "Factibilidad de impresion" en `CLAUDE.md` y `geometry/spike.ts`.

## Roadmap

| Fase | Objetivo | Entregable verificable | Estado |
|---|---|---|---|
| 0 | Setup del proyecto | Repo corriendo, viewport 3D con cubo de prueba | ✅ |
| 1 | Motor de volumen parametrico | Perfil 2D barrido por una curva, UI de params, export STL | ✅ |
| 2 | Mapas de atraccion + instanciado dirigido por campo | Escamas/plumas sobre una superficie con densidad no uniforme | ✅ |
| 3 | Modulo de geometria auxetica | Celdas unitarias parametrizadas, teseladas sobre un panel 2D | pendiente |
| 4 | Pipeline imagen → vector / imagen → dato | Subir imagen → contornos o mapa de atraccion por luminancia | pendiente |
| 5 | Kerf + exportacion laser | Offset de paths por kerf/material, export SVG/DXF con capas | pendiente |
| 6 | Integracion, guardar/cargar proyecto | Flujo completo cuerpo → atractores → geometria → export | pendiente |
| 7 | Pulido, performance, documentacion | App usable en clase/taller sin supervision | pendiente |

## Modulos funcionales objetivo

| Modulo | Que hace |
|---|---|
| Motor de volumen parametrico | Perfil 2D + curva guia + perfil de escalado → malla 3D (loft) |
| Mapas de atraccion | Campo escalar/vectorial sobre una superficie que controla densidad/escala/rotacion de instancias |
| Geometria auxetica | Celdas unitarias (honeycomb re-entrante, cuadrados rotantes, quiral) parametrizadas y teseladas |
| Imagen → vector / dato | Trazado de contornos y analisis de luminancia de una imagen |
| Compensacion de kerf | Offset de paths 2D segun ancho de corte del laser y material |
| Exportacion | STL/OBJ/glTF (impresion 3D) y SVG/DXF (corte laser), con separacion por capas/material |

## Prompt — Fase 3 (siguiente)

Modulo de geometria auxetica para patrones de corte que se adaptan a superficies curvas.

1. En `geometry/`, al menos 2-3 familias de celdas unitarias auxeticas, cada una
   como funcion pura parametrizada:
   - Honeycomb re-entrante: angulo interno, largo de paredes, grosor.
   - Cuadrados rotantes: tamano de cuadrado, angulo de rotacion, gap.
   - (Opcional) patron quiral con nodos circulares y ligamentos tangentes.
2. Funcion de teselado: repite la celda en una grilla 2D dentro de un contorno
   (rectangulo por ahora), recortando celdas parcialmente fuera.
3. Resultado como paths 2D (Paper.js) — se ofsetean por kerf y se exportan en Fase 5.
4. UI: panel de parametros por familia, selector de familia, visualizacion 2D
   (canvas/SVG separado del viewport 3D).
5. (Opcional) vista previa del comportamiento al estirarse (aproximacion visual).
6. Tests de las funciones de celda: sin self-intersections basicas, respeta los
   parametros (p. ej. grosor de pared).

## Prompts — Fases 4-7

Ver la guia original. Resumen:
- **Fase 4:** OpenCV.js (WASM) para Canny + contornos + luminancia; subida de imagen
  con preview; contornos → paths de Paper.js con simplificacion Douglas-Peucker;
  mapa de luminancia expuesto con la misma interfaz que un attraction field.
- **Fase 5:** Clipper2 (WASM) para offset de kerf; libreria de materiales (fieltro
  2mm, acrilico 3mm, cuero 1.5mm, carton, TPU) con kerf de referencia; organizacion
  por capas/color; export SVG (grupos `<g>` por material) y DXF (`dxf-writer`);
  nesting basico opcional (bin-packing).
- **Fase 6:** importar superficie base real (OBJ/glTF de maniqui) + three-mesh-bvh;
  UI unificada por pestanas; guardar/cargar proyecto (serializar solo parametros);
  evaluar editor de grafo tipo Grasshopper (Rete.js / litegraph.js) — analisis
  costo/beneficio antes de construir.
- **Fase 7:** performance (instanciado, kerf) con casos de carga; manejo de errores
  visible; guia de uso (`docs/guia-de-uso.md`); accesibilidad basica; resumen final
  en CLAUDE.md.

## Notas de uso

- Verificacion visual entre fases: correr la app y mirar el resultado antes de seguir.
- Kerf real: los valores de la Fase 5 son punto de partida; probar corte en retazo
  del material real y ajustar en la app antes de una pieza final.
- Referencias visuales (van Herpen): si en Fase 2/3 el resultado se aleja de la
  estetica buscada, volver a adjuntar las imagenes en esa sesion.
