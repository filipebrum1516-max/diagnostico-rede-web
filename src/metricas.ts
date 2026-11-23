import type { ResultadoLatencia } from "./tipos.js";

const arred = (n: number): number => Math.round(n * 10) / 10;

export function recebidos(r: ResultadoLatencia): number {
  return r.tempos.length;
}

export function perdaPercentual(r: ResultadoLatencia): number {
  if (r.enviados === 0) return 100;
  return arred((100 * (r.enviados - r.tempos.length)) / r.enviados);
}

export function latenciaMedia(r: ResultadoLatencia): number | null {
  if (r.tempos.length === 0) return null;
  return arred(r.tempos.reduce((a, b) => a + b, 0) / r.tempos.length);
}

/** Variação média entre medições consecutivas (indica instabilidade). */
export function jitter(r: ResultadoLatencia): number | null {
  if (r.tempos.length < 2) return null;
  let soma = 0;
  for (let i = 1; i < r.tempos.length; i++) {
    soma += Math.abs(r.tempos[i] - r.tempos[i - 1]);
  }
  return arred(soma / (r.tempos.length - 1));
}

export function respondeu(r: ResultadoLatencia): boolean {
  return r.tempos.length > 0;
}
