/** Interface: liga os testes, a análise e o relatório aos elementos da página. */

import { analisar } from "./analise.js";
import { jitter, latenciaMedia, perdaPercentual } from "./metricas.js";
import { ROTULO_STATUS, gerarJSON, gerarTexto } from "./relatorio.js";
import { infoConexao, medirDownload, medirLatencia, medirUpload, resolverDNS } from "./testes.js";
import type { Coleta, Diagnostico, Nivel } from "./tipos.js";

const DOMINIOS = ["google.com", "youtube.com", "whatsapp.com"];

type EstadoEtapa = "aguardando" | "rodando" | "ok" | "falhou";
type Etapa = "conexao" | "latencia" | "dns" | "download" | "upload";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Elemento não encontrado: ${sel}`);
  return el;
};

const formulario = $<HTMLFormElement>("#form");
const botao = $<HTMLButtonElement>("#iniciar");
const botaoExemplo = $<HTMLButtonElement>("#exemplo");
const campoPlano = $<HTMLInputElement>("#plano");
const campoCliente = $<HTMLInputElement>("#cliente");
const painelResultado = $<HTMLElement>("#resultado");

let ultimo: { coleta: Coleta; diag: Diagnostico; cliente: string | null; quando: Date } | null = null;

// ---------------------------------------------------------------- etapas
function etapa(nome: Etapa, estado: EstadoEtapa, valor = ""): void {
  const li = $<HTMLLIElement>(`[data-etapa="${nome}"]`);
  li.dataset.estado = estado;
  li.querySelector<HTMLElement>(".etapa-valor")!.textContent = valor;
}

function reiniciarEtapas(): void {
  (["conexao", "latencia", "dns", "download", "upload"] as Etapa[]).forEach((e) =>
    etapa(e, "aguardando"),
  );
}

// ---------------------------------------------------------------- gráfico
function desenharLatencia(tempos: number[], enviados: number): void {
  const svg = $<HTMLElement>("#grafico-latencia");
  const L = 560;
  const A = 140;
  const m = { t: 12, r: 12, b: 22, l: 40 };
  if (tempos.length === 0) {
    svg.innerHTML = "";
    return;
  }
  const max = Math.max(50, Math.ceil((Math.max(...tempos) * 1.15) / 50) * 50);
  const x = (i: number) => m.l + (i * (L - m.l - m.r)) / Math.max(1, tempos.length - 1);
  const y = (v: number) => m.t + (A - m.t - m.b) * (1 - v / max);
  const linhas = [0, max / 2, max]
    .map(
      (v) =>
        `<line class="grade" x1="${m.l}" x2="${L - m.r}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="eixo" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`,
    )
    .join("");
  const caminho = tempos.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${caminho}L${x(tempos.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  svg.innerHTML = `
    <svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Latência de cada medição, em milissegundos">
      <defs><linearGradient id="g-area" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--azul)" stop-opacity=".22"/>
        <stop offset="1" stop-color="var(--azul)" stop-opacity="0"/>
      </linearGradient></defs>
      ${linhas}
      <text class="eixo" x="${m.l}" y="${A - 4}">1ª</text>
      <text class="eixo" x="${L - m.r}" y="${A - 4}" text-anchor="end">${enviados}ª medição</text>
      <path d="${area}" fill="url(#g-area)"/>
      <path d="${caminho}" class="linha"/>
      <line class="mira" y1="${m.t}" y2="${A - m.b}" x1="0" x2="0" visibility="hidden"/>
      <circle class="ponto" r="5" cx="0" cy="0" visibility="hidden"/>
      <rect class="alvo" x="${m.l}" y="0" width="${L - m.l - m.r}" height="${A}"/>
    </svg>
    <div class="dica" hidden></div>`;

  const svgEl = svg.querySelector("svg")!;
  const mira = svg.querySelector<SVGLineElement>(".mira")!;
  const ponto = svg.querySelector<SVGCircleElement>(".ponto")!;
  const dica = svg.querySelector<HTMLDivElement>(".dica")!;
  const alvo = svg.querySelector<SVGRectElement>(".alvo")!;
  alvo.addEventListener("pointermove", (ev) => {
    const caixa = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - caixa.left) / caixa.width) * L;
    const i = Math.max(0, Math.min(tempos.length - 1, Math.round(((px - m.l) / (L - m.l - m.r)) * (tempos.length - 1))));
    mira.setAttribute("x1", String(x(i)));
    mira.setAttribute("x2", String(x(i)));
    ponto.setAttribute("cx", String(x(i)));
    ponto.setAttribute("cy", String(y(tempos[i])));
    mira.setAttribute("visibility", "visible");
    ponto.setAttribute("visibility", "visible");
    dica.hidden = false;
    dica.innerHTML = `<span>Medição ${i + 1}</span><strong>${tempos[i]} ms</strong>`;
    dica.style.left = `${(x(i) / L) * 100}%`;
  });
  alvo.addEventListener("pointerleave", () => {
    dica.hidden = true;
    mira.setAttribute("visibility", "hidden");
    ponto.setAttribute("visibility", "hidden");
  });
}

// ---------------------------------------------------------------- resultado
const ICONE: Record<Nivel, string> = {
  OK: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3L15 6.5"/></svg>',
  ATENCAO: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5.5v5.5M10 14.2v.3"/></svg>',
  PROBLEMA: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
};
const ROTULO_CURTO: Record<Nivel, string> = { OK: "OK", ATENCAO: "Atenção", PROBLEMA: "Problema" };

function escapar(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function metrica(rotulo: string, valor: string, unidade: string, nota = ""): string {
  return `<div class="metrica vidro">
    <span class="metrica-rotulo">${rotulo}</span>
    <span class="metrica-valor">${valor}<small>${unidade}</small></span>
    ${nota ? `<span class="metrica-nota">${nota}</span>` : ""}
  </div>`;
}

function mostrarResultado(coleta: Coleta, diag: Diagnostico, exemplo: boolean): void {
  const lat = coleta.latencia;
  const dnsOk = coleta.dns.filter((d) => d.tempoMs !== null);
  const dnsMedio = dnsOk.length
    ? Math.round(dnsOk.reduce((a, d) => a + (d.tempoMs ?? 0), 0) / dnsOk.length)
    : null;
  const pctPlano =
    coleta.downloadMbps !== null && coleta.planoMbps
      ? `${Math.round((100 * coleta.downloadMbps) / coleta.planoMbps)}% do plano`
      : "";

  $("#status").dataset.nivel = diag.status;
  $("#status-icone").innerHTML = ICONE[diag.status];
  $("#status-titulo").textContent = ROTULO_STATUS[diag.status];
  $("#status-sub").textContent = exemplo
    ? "Exemplo com dados simulados de um cliente no Wi-Fi com plano de 300 Mbps."
    : diag.precisaEscalar
      ? "Se os passos abaixo não resolverem, o chamado deve ser escalado."
      : `Diagnóstico concluído às ${new Date().toLocaleTimeString("pt-BR")}.`;

  $("#metricas").innerHTML = [
    metrica("Latência média", lat ? String(latenciaMedia(lat) ?? "—") : "—", "ms"),
    metrica("Jitter", lat ? String(jitter(lat) ?? "—") : "—", "ms"),
    metrica("Perda", lat ? String(perdaPercentual(lat)) : "—", "%"),
    metrica("DNS", dnsMedio !== null ? String(dnsMedio) : "—", "ms"),
    metrica("Download", coleta.downloadMbps !== null ? String(coleta.downloadMbps) : "—", "Mbps", pctPlano),
    metrica("Upload", coleta.uploadMbps !== null ? String(coleta.uploadMbps) : "—", "Mbps"),
  ].join("");

  desenharLatencia(lat?.tempos ?? [], lat?.enviados ?? 0);

  $("#achados").innerHTML = diag.achados
    .map(
      (a) => `<li class="achado" data-nivel="${a.nivel}">
        <span class="selo">${ICONE[a.nivel]}${ROTULO_CURTO[a.nivel]}</span>
        <div>
          <strong>${escapar(a.titulo)}</strong>
          <p>${escapar(a.detalhe)}</p>
          ${a.acoes.length ? `<ol>${a.acoes.map((x) => `<li>${escapar(x)}</li>`).join("")}</ol>` : ""}
        </div>
      </li>`,
    )
    .join("");

  const info = coleta.conexao;
  $("#conexao-info").innerHTML = [
    info.provedor && `<span><b>Provedor</b>${escapar(info.provedor)}</span>`,
    info.ipPublico && `<span><b>IP público</b>${escapar(info.ipPublico)}</span>`,
    info.cidade && `<span><b>Local aprox.</b>${escapar(info.cidade)}</span>`,
    info.tipo && `<span><b>Tipo</b>${escapar(info.tipo)}</span>`,
  ]
    .filter(Boolean)
    .join("");

  painelResultado.hidden = false;
  painelResultado.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------- execução
async function executar(): Promise<void> {
  const plano = Number(campoPlano.value.replace(/\D/g, "")) || null;
  const cliente = campoCliente.value.trim() || null;
  botao.disabled = true;
  botaoExemplo.disabled = true;
  botao.textContent = "Testando…";
  painelResultado.hidden = true;
  reiniciarEtapas();

  const coleta: Coleta = {
    conexao: { online: navigator.onLine },
    latencia: null,
    dns: [],
    downloadMbps: null,
    uploadMbps: null,
    planoMbps: plano,
  };

  try {
    etapa("conexao", "rodando", "verificando…");
    coleta.conexao = await infoConexao();
    etapa("conexao", coleta.conexao.online ? "ok" : "falhou", coleta.conexao.online ? coleta.conexao.provedor ?? "conectado" : "sem rede");

    if (coleta.conexao.online) {
      etapa("latencia", "rodando", "medindo…");
      coleta.latencia = await medirLatencia(12, (t, n) => {
        etapa("latencia", "rodando", `${n}/12`);
        desenharLatencia(t, n);
      });
      const media = latenciaMedia(coleta.latencia);
      etapa("latencia", media !== null ? "ok" : "falhou", media !== null ? `${media} ms` : "sem resposta");

      etapa("dns", "rodando", "consultando…");
      coleta.dns = await Promise.all(DOMINIOS.map(resolverDNS));
      const falhas = coleta.dns.filter((d) => !d.ips.length).length;
      etapa("dns", falhas ? "falhou" : "ok", falhas ? `${falhas} falha(s)` : `${DOMINIOS.length} domínios`);

      if (media !== null) {
        etapa("download", "rodando", "medindo…");
        coleta.downloadMbps = await medirDownload((v) => etapa("download", "rodando", `${v} Mbps`));
        etapa("download", coleta.downloadMbps !== null ? "ok" : "falhou", coleta.downloadMbps !== null ? `${coleta.downloadMbps} Mbps` : "indisponível");

        etapa("upload", "rodando", "medindo…");
        coleta.uploadMbps = await medirUpload((v) => etapa("upload", "rodando", `${v} Mbps`));
        etapa("upload", coleta.uploadMbps !== null ? "ok" : "falhou", coleta.uploadMbps !== null ? `${coleta.uploadMbps} Mbps` : "indisponível");
      }
    }

    const diag = analisar(coleta);
    ultimo = { coleta, diag, cliente, quando: new Date() };
    mostrarResultado(coleta, diag, false);
  } finally {
    botao.disabled = false;
    botaoExemplo.disabled = false;
    botao.textContent = "Testar novamente";
  }
}

function exemplo(): void {
  const coleta: Coleta = {
    conexao: { online: true, provedor: "Provedor de exemplo", ipPublico: "203.0.113.25", cidade: "Cacoal/Rondônia", tipo: "wifi" },
    latencia: { destino: "google.com", enviados: 12, tempos: [38, 41, 120, 36, 44, 39, 182, 40, 37, 95, 42, 39] },
    dns: [
      { dominio: "google.com", ips: ["142.250.79.46"], tempoMs: 24 },
      { dominio: "youtube.com", ips: ["142.250.219.206"], tempoMs: 27 },
      { dominio: "whatsapp.com", ips: ["157.240.12.53"], tempoMs: 31 },
    ],
    downloadMbps: 96.3,
    uploadMbps: 48.1,
    planoMbps: 300,
  };
  (["conexao", "latencia", "dns", "download", "upload"] as Etapa[]).forEach((e) => etapa(e, "ok", "exemplo"));
  const diag = analisar(coleta);
  ultimo = { coleta, diag, cliente: "Exemplo", quando: new Date() };
  mostrarResultado(coleta, diag, true);
}

// ---------------------------------------------------------------- relatório
function baixar(nome: string, conteudo: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  a.click();
  URL.revokeObjectURL(url);
}

function nomeArquivo(ext: string): string {
  const d = ultimo!.quando;
  const p = (n: number) => String(n).padStart(2, "0");
  return `diagnostico_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.${ext}`;
}

$("#copiar").addEventListener("click", async (ev) => {
  if (!ultimo) return;
  const b = ev.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(gerarTexto(ultimo.coleta, ultimo.diag, ultimo.cliente, ultimo.quando));
    b.textContent = "Copiado";
  } catch {
    b.textContent = "Não foi possível copiar";
  }
  setTimeout(() => (b.textContent = "Copiar relatório"), 1800);
});
$("#baixar-txt").addEventListener("click", () => {
  if (ultimo) baixar(nomeArquivo("txt"), gerarTexto(ultimo.coleta, ultimo.diag, ultimo.cliente, ultimo.quando), "text/plain;charset=utf-8");
});
$("#baixar-json").addEventListener("click", () => {
  if (ultimo) baixar(nomeArquivo("json"), gerarJSON(ultimo.coleta, ultimo.diag, ultimo.cliente, ultimo.quando), "application/json");
});

// Aceita apenas números no campo do plano.
campoPlano.addEventListener("input", () => {
  campoPlano.value = campoPlano.value.replace(/\D/g, "").slice(0, 5);
});

formulario.addEventListener("submit", (ev) => {
  ev.preventDefault();
  void executar();
});
botaoExemplo.addEventListener("click", exemplo);

if (new URLSearchParams(location.search).has("exemplo")) exemplo();
