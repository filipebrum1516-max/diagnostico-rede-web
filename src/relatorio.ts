/** Relatório em texto (para colar no chamado) e em JSON. */

import { jitter, latenciaMedia, perdaPercentual, respondeu } from "./metricas.js";
import type { Coleta, Diagnostico, Nivel } from "./tipos.js";

export const ROTULO_STATUS: Record<Nivel, string> = {
  OK: "Conexão saudável",
  ATENCAO: "Conexão com pontos de atenção",
  PROBLEMA: "Problema encontrado",
};

const MARCADOR: Record<Nivel, string> = { OK: "[ OK ]", ATENCAO: "[ ! ]", PROBLEMA: "[ X ]" };

function dataHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const col = (rotulo: string) => `  ${rotulo.padEnd(24)}`;

export function gerarTexto(
  c: Coleta,
  d: Diagnostico,
  cliente: string | null,
  quando: Date,
): string {
  const l: string[] = [
    "=".repeat(64),
    "  RELATÓRIO DE DIAGNÓSTICO DE REDE (versão web)",
    "=".repeat(64),
    `  Data/hora: ${dataHora(quando)}`,
  ];
  if (cliente) l.push(`  Cliente:   ${cliente}`);
  l.push(`  Resultado: ${MARCADOR[d.status]} ${ROTULO_STATUS[d.status]}`, "", "DADOS COLETADOS");

  l.push(col("Rede") + (c.conexao.online ? "conectado" : "sem rede"));
  if (c.conexao.ipPublico) l.push(col("IP público") + c.conexao.ipPublico);
  if (c.conexao.provedor) l.push(col("Provedor") + c.conexao.provedor);
  if (c.conexao.cidade) l.push(col("Localização aprox.") + c.conexao.cidade);

  if (c.latencia) {
    const r = c.latencia;
    l.push(
      col("Latência (HTTP)") +
        (respondeu(r)
          ? `média ${latenciaMedia(r)} ms | perda ${perdaPercentual(r)}% | jitter ${jitter(r) ?? "-"} ms`
          : "SEM RESPOSTA"),
    );
  }
  for (const r of c.dns) {
    l.push(
      col(`DNS ${r.dominio}`) +
        (r.ips.length ? `${r.tempoMs} ms -> ${r.ips.slice(0, 2).join(", ")}` : "FALHOU"),
    );
  }
  if (c.downloadMbps !== null) l.push(col("Download") + `${c.downloadMbps} Mbps`);
  if (c.uploadMbps !== null) l.push(col("Upload") + `${c.uploadMbps} Mbps`);
  if (c.planoMbps) l.push(col("Plano contratado") + `${c.planoMbps} Mbps`);

  l.push("", "DIAGNÓSTICO");
  for (const a of d.achados) {
    l.push(`  ${MARCADOR[a.nivel]} ${a.titulo}: ${a.detalhe}`);
    for (const acao of a.acoes) l.push(`        -> ${acao}`);
  }
  if (d.precisaEscalar) {
    l.push("", "  >> Recomendação: se os passos acima não resolverem, ESCALAR o chamado.");
  }
  l.push("=".repeat(64));
  return l.join("\n");
}

export function gerarJSON(
  c: Coleta,
  d: Diagnostico,
  cliente: string | null,
  quando: Date,
): string {
  return JSON.stringify(
    {
      data_hora: quando.toISOString(),
      cliente,
      status_geral: d.status,
      precisa_escalar: d.precisaEscalar,
      coleta: c,
      achados: d.achados,
    },
    null,
    2,
  );
}
