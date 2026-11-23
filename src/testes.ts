/**
 * Testes de rede que o navegador consegue fazer.
 *
 * O navegador não permite ping (ICMP), traceroute nem ler o gateway da rede
 * local. Por isso, aqui a latência é medida com requisições HTTP, o DNS é
 * consultado via DNS-over-HTTPS e a velocidade é medida baixando e enviando
 * dados para os servidores da Cloudflare.
 */

import type { InfoConexao, ResultadoDNS, ResultadoLatencia } from "./tipos.js";

const URL_LATENCIA = "https://www.google.com/generate_204";
const URL_DOWNLOAD = "https://speed.cloudflare.com/__down?bytes=";
const URL_UPLOAD = "https://speed.cloudflare.com/__up";

const arred = (n: number): number => Math.round(n * 10) / 10;
const aleatorio = (): string => Math.random().toString(36).slice(2);

/** fetch com limite de tempo. */
async function buscar(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controle.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

interface NetworkInformation {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
}

export async function infoConexao(): Promise<InfoConexao> {
  const info: InfoConexao = { online: navigator.onLine };
  const nav = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (nav) {
    info.tipo = nav.type ?? nav.effectiveType;
    if (typeof nav.downlink === "number") info.downlinkEstimadoMbps = nav.downlink;
    if (typeof nav.rtt === "number") info.rttEstimadoMs = nav.rtt;
  }
  try {
    const r = await buscar("https://ipwho.is/?fields=ip,city,region,connection", {}, 4000);
    const j = (await r.json()) as {
      ip?: string;
      city?: string;
      region?: string;
      connection?: { isp?: string; org?: string };
    };
    if (j.ip) info.ipPublico = j.ip;
    const isp = j.connection?.isp || j.connection?.org;
    if (isp) info.provedor = isp;
    if (j.city) info.cidade = j.region ? `${j.city}/${j.region}` : j.city;
  } catch {
    // Sem informação de IP: o diagnóstico continua normalmente.
  }
  return info;
}

/**
 * Mede a latência com várias requisições HTTP pequenas. A primeira é descartada
 * porque inclui a abertura da conexão (DNS + TLS).
 */
export async function medirLatencia(
  quantidade = 12,
  aoMedir?: (tempos: number[], enviados: number) => void,
): Promise<ResultadoLatencia> {
  const tempos: number[] = [];
  try {
    await buscar(`${URL_LATENCIA}?aq=${aleatorio()}`, { mode: "no-cors" }, 4000);
  } catch {
    // aquecimento falhou; as medições abaixo vão registrar a perda
  }
  for (let i = 0; i < quantidade; i++) {
    const inicio = performance.now();
    try {
      await buscar(`${URL_LATENCIA}?l=${aleatorio()}`, { mode: "no-cors" }, 3000);
      tempos.push(arred(performance.now() - inicio));
    } catch {
      // requisição perdida
    }
    aoMedir?.([...tempos], i + 1);
    await new Promise((ok) => setTimeout(ok, 120));
  }
  return { destino: "google.com", enviados: quantidade, tempos };
}

interface RespostaDoH {
  Answer?: { type: number; data: string }[];
}

/** Resolve um domínio via DNS-over-HTTPS (Cloudflare, com Google como reserva). */
export async function resolverDNS(dominio: string): Promise<ResultadoDNS> {
  const servidores: { url: string; headers: Record<string, string> }[] = [
    { url: `https://cloudflare-dns.com/dns-query?name=${dominio}&type=A`, headers: { accept: "application/dns-json" } },
    { url: `https://dns.google/resolve?name=${dominio}&type=A`, headers: {} },
  ];
  let erro = "sem resposta";
  for (const s of servidores) {
    const inicio = performance.now();
    try {
      const r = await buscar(s.url, { headers: s.headers }, 4000);
      const j = (await r.json()) as RespostaDoH;
      const tempo = arred(performance.now() - inicio);
      const ips = (j.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
      if (ips.length > 0) return { dominio, ips, tempoMs: tempo };
      erro = "domínio sem endereço IPv4";
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
  }
  return { dominio, ips: [], tempoMs: null, erro };
}

/**
 * Baixa dados de teste por até `limiteS` segundos e devolve a velocidade em Mbps.
 * `aoProgredir` recebe a velocidade parcial para a interface.
 */
export async function medirDownload(
  aoProgredir?: (mbps: number) => void,
  limiteS = 8,
): Promise<number | null> {
  const bytesPedidos = 100_000_000;
  const controle = new AbortController();
  const inicio = performance.now();
  let total = 0;
  const timer = setTimeout(() => controle.abort(), limiteS * 1000);
  try {
    const r = await fetch(`${URL_DOWNLOAD}${bytesPedidos}&d=${aleatorio()}`, {
      signal: controle.signal,
      cache: "no-store",
    });
    const leitor = r.body?.getReader();
    if (!leitor) return null;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      const seg = (performance.now() - inicio) / 1000;
      if (seg > 0.3) aoProgredir?.(arred((total * 8) / seg / 1e6));
    }
  } catch {
    // O limite de tempo interrompe o download de propósito; o que chegou já serve.
  } finally {
    clearTimeout(timer);
  }
  const seg = (performance.now() - inicio) / 1000;
  if (total < 200_000 || seg <= 0) return null;
  return arred((total * 8) / seg / 1e6);
}

/** Envia blocos de dados de teste e devolve a velocidade de upload em Mbps. */
export async function medirUpload(
  aoProgredir?: (mbps: number) => void,
  limiteS = 8,
): Promise<number | null> {
  const bloco = new Uint8Array(2_000_000);
  const inicio = performance.now();
  let enviados = 0;
  try {
    while ((performance.now() - inicio) / 1000 < limiteS) {
      await buscar(
        URL_UPLOAD,
        { method: "POST", body: new Blob([bloco], { type: "text/plain" }), mode: "no-cors" },
        limiteS * 1000,
      );
      enviados += bloco.byteLength;
      const seg = (performance.now() - inicio) / 1000;
      aoProgredir?.(arred((enviados * 8) / seg / 1e6));
      if (enviados >= 40_000_000) break;
    }
  } catch {
    // envio interrompido; usa o que foi enviado até aqui
  }
  const seg = (performance.now() - inicio) / 1000;
  if (enviados === 0 || seg <= 0) return null;
  return arred((enviados * 8) / seg / 1e6);
}
