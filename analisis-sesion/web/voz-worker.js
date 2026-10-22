// Worker de la pista de voz (tono e intensidad): cálculo pesado en paralelo
// a la transcripción, sin congelar la página.
import { pistaVoz } from "./analisis.js";

self.onmessage = ({ data }) => {
  const pista = pistaVoz(data.audio, data.sr, undefined, (x) => self.postMessage({ tipo: "avance", x }));
  self.postMessage({ tipo: "pista", pista });
};
