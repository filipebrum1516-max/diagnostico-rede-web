/**
 * Regras que transformam os números coletados em um diagnóstico, na mesma
 * ordem de raciocínio usada pelo suporte técnico de um provedor.
 *
 * Os limites são maiores que os da versão em Python porque o navegador mede
 * latência por HTTP (que inclui o processamento do servidor), e não por ICMP.
 */

import { jitter, latenciaMedia, perdaPercentual, respondeu } from "./metricas.js";
import type { Achado, Coleta, Diagnostico, Nivel } from "./tipos.js";

export const LIMITES = {
  latenciaAltaMs: 150,
  jitterAltoMs: 40,
  perdaAltaPct: 5,
  dnsLentoMs: 300,
  velocidadeCriticaPct: 40,
  velocidadeAtencaoPct: 80,
} as const;

function statusGeral(achados: Achado[]): Nivel {
  if (achados.some((a) => a.nivel === "PROBLEMA")) return "PROBLEMA";
  if (achados.some((a) => a.nivel === "ATENCAO")) return "ATENCAO";
  return "OK";
}

function precisaEscalar(achados: Achado[]): boolean {
  return achados.some(
    (a) =>
      a.nivel === "PROBLEMA" &&
      a.acoes.some((acao) => /escalar|visita técnica/i.test(acao)),
  );
}

export function analisar(c: Coleta): Diagnostico {
  const achados: Achado[] = [];

  // 1) O dispositivo está conectado a alguma rede?
  if (!c.conexao.online) {
    achados.push({
      nivel: "PROBLEMA",
      titulo: "Dispositivo sem rede",
      detalhe: "O navegador informa que o dispositivo não está conectado a nenhuma rede.",
      acoes: [
        "Verificar se o cabo de rede está conectado ou se o Wi-Fi está ligado",
        "Conferir se o dispositivo está na rede Wi-Fi correta",
        "Reiniciar o roteador (desligar por 30 segundos e ligar novamente)",
      ],
    });
    return { achados, status: "PROBLEMA", precisaEscalar: false };
  }

  // 2) Há saída para a internet? A conexão está estável?
  const lat = c.latencia;
  const internetOk = lat !== null && respondeu(lat);
  if (lat !== null && !internetOk) {
    achados.push({
      nivel: "PROBLEMA",
      titulo: "Sem acesso à internet",
      detalhe:
        "O dispositivo está conectado à rede local, mas nenhum servidor da internet respondeu.",
      acoes: [
        "Verificar as luzes da ONU/ONT: luz LOS vermelha indica rompimento da fibra",
        "Conferir se a conexão PPPoE do roteador está autenticada",
        "Verificar no sistema do provedor se há bloqueio por pendência financeira",
        "Verificar se há manutenção ou queda na região",
        "Se a luz LOS estiver acesa: escalar para visita técnica",
      ],
    });
  } else if (lat !== null) {
    const media = latenciaMedia(lat) ?? 0;
    const jit = jitter(lat) ?? 0;
    const perda = perdaPercentual(lat);
    const problemas: string[] = [];
    if (perda > LIMITES.perdaAltaPct) problemas.push(`perda de ${perda}% das requisições`);
    if (media > LIMITES.latenciaAltaMs) problemas.push(`latência alta (${media} ms)`);
    if (jit > LIMITES.jitterAltoMs) problemas.push(`variação alta (jitter de ${jit} ms)`);

    if (problemas.length > 0) {
      achados.push({
        nivel: "ATENCAO",
        titulo: "Conexão instável",
        detalhe:
          `Foram identificados: ${problemas.join(", ")}. ` +
          "Isso causa lentidão, travamentos em vídeos e atraso em jogos e chamadas.",
        acoes: [
          "Repetir o teste com o dispositivo conectado via cabo para descartar o Wi-Fi",
          "Usar a rede de 5 GHz quando o dispositivo estiver perto do roteador",
          "Verificar a potência óptica da ONU (ideal entre -8 e -25 dBm)",
          "Verificar se outro dispositivo está fazendo download pesado",
          "Se persistir via cabo: escalar para análise do NOC",
        ],
      });
    } else {
      achados.push({
        nivel: "OK",
        titulo: "Estabilidade",
        detalhe: `Latência média de ${media} ms, jitter de ${jit} ms e nenhuma perda.`,
        acoes: [],
      });
    }
  }

  // 3) DNS: a internet responde, mas os nomes não são resolvidos?
  if (c.dns.length > 0) {
    const falhas = c.dns.filter((d) => d.ips.length === 0);
    const lentos = c.dns.filter(
      (d) => d.ips.length > 0 && (d.tempoMs ?? 0) > LIMITES.dnsLentoMs,
    );
    if (falhas.length > 0 && internetOk) {
      achados.push({
        nivel: "PROBLEMA",
        titulo: "Falha de DNS",
        detalhe:
          "A internet responde, mas não foi possível resolver: " +
          falhas.map((d) => d.dominio).join(", ") +
          ".",
        acoes: [
          "Configurar DNS públicos no roteador: 8.8.8.8 e 1.1.1.1",
          "Limpar o cache de DNS do computador (Windows: ipconfig /flushdns)",
          "Reiniciar o roteador",
        ],
      });
    } else if (lentos.length > 0) {
      achados.push({
        nivel: "ATENCAO",
        titulo: "DNS lento",
        detalhe:
          "A resolução de nomes está demorando (" +
          lentos.map((d) => `${d.dominio}: ${d.tempoMs} ms`).join(", ") +
          "). Os sites demoram para começar a carregar.",
        acoes: ["Configurar DNS públicos no roteador: 8.8.8.8 e 1.1.1.1"],
      });
    } else if (falhas.length === 0) {
      achados.push({
        nivel: "OK",
        titulo: "DNS",
        detalhe: "Todos os domínios testados foram resolvidos.",
        acoes: [],
      });
    }
  }

  // 4) Velocidade em relação ao plano contratado.
  if (c.downloadMbps !== null && c.planoMbps) {
    const pct = Math.round((100 * c.downloadMbps) / c.planoMbps);
    const nivel: Nivel =
      pct < LIMITES.velocidadeCriticaPct
        ? "PROBLEMA"
        : pct < LIMITES.velocidadeAtencaoPct
          ? "ATENCAO"
          : "OK";
    achados.push({
      nivel,
      titulo: "Velocidade",
      detalhe: `${c.downloadMbps} Mbps medidos, ${pct}% do plano de ${c.planoMbps} Mbps.`,
      acoes:
        nivel === "OK"
          ? []
          : [
              "Refazer o teste via cabo (o Wi-Fi limita a velocidade)",
              "Desconectar outros dispositivos durante o teste",
              "Verificar se a placa de rede e o cabo suportam a velocidade do plano",
              "Se via cabo continuar abaixo de 40%: escalar para análise do NOC",
            ],
    });
  } else if (c.downloadMbps !== null) {
    achados.push({
      nivel: "OK",
      titulo: "Velocidade",
      detalhe: `${c.downloadMbps} Mbps de download medidos. Informe o plano contratado para comparar.`,
      acoes: [],
    });
  }

  return { achados, status: statusGeral(achados), precisaEscalar: precisaEscalar(achados) };
}
