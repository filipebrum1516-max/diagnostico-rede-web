// Testes da análise e do relatório (rodam com: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";

import { analisar } from "../.build-testes/analise.js";
import { gerarJSON, gerarTexto } from "../.build-testes/relatorio.js";
import { jitter, latenciaMedia, perdaPercentual } from "../.build-testes/metricas.js";

const dnsOk = (dominio = "google.com", tempoMs = 25) => ({ dominio, ips: ["142.250.0.1"], tempoMs });

function coleta(extra = {}) {
  return {
    conexao: { online: true },
    latencia: { destino: "google.com", enviados: 4, tempos: [30, 32, 31, 33] },
    dns: [dnsOk()],
    downloadMbps: null,
    uploadMbps: null,
    planoMbps: null,
    ...extra,
  };
}

const titulos = (d) => d.achados.map((a) => a.titulo);

test("métricas: média, jitter e perda", () => {
  const r = { destino: "x", enviados: 4, tempos: [20, 22, 30] };
  assert.equal(latenciaMedia(r), 24);
  assert.equal(jitter(r), 5);
  assert.equal(perdaPercentual(r), 25);
});

test("conexão saudável", () => {
  const d = analisar(coleta());
  assert.equal(d.status, "OK");
  assert.equal(d.precisaEscalar, false);
});

test("dispositivo sem rede", () => {
  const d = analisar(coleta({ conexao: { online: false } }));
  assert.equal(d.status, "PROBLEMA");
  assert.deepEqual(titulos(d), ["Dispositivo sem rede"]);
});

test("sem acesso à internet deve escalar", () => {
  const d = analisar(coleta({ latencia: { destino: "x", enviados: 4, tempos: [] }, dns: [] }));
  assert.ok(titulos(d).includes("Sem acesso à internet"));
  assert.equal(d.precisaEscalar, true);
});

test("falha de DNS com internet funcionando", () => {
  const d = analisar(coleta({ dns: [{ dominio: "google.com", ips: [], tempoMs: null }] }));
  assert.ok(titulos(d).includes("Falha de DNS"));
  assert.equal(d.status, "PROBLEMA");
});

test("DNS lento gera atenção", () => {
  const d = analisar(coleta({ dns: [dnsOk("google.com", 900)] }));
  assert.ok(titulos(d).includes("DNS lento"));
  assert.equal(d.status, "ATENCAO");
});

test("conexão instável (perda e jitter)", () => {
  const d = analisar(coleta({ latencia: { destino: "x", enviados: 12, tempos: [40, 180, 35, 200, 38, 190, 42, 170, 39, 160] } }));
  assert.ok(titulos(d).includes("Conexão instável"));
});

test("velocidade abaixo de 40% do plano escala", () => {
  const d = analisar(coleta({ downloadMbps: 80, planoMbps: 300 }));
  const v = d.achados.find((a) => a.titulo === "Velocidade");
  assert.equal(v.nivel, "PROBLEMA");
  assert.equal(d.precisaEscalar, true);
});

test("velocidade dentro do plano", () => {
  const d = analisar(coleta({ downloadMbps: 290, planoMbps: 300 }));
  assert.equal(d.status, "OK");
});

test("relatório em texto e JSON", () => {
  const c = coleta({ latencia: { destino: "x", enviados: 4, tempos: [] }, dns: [] });
  const d = analisar(c);
  const quando = new Date(2026, 10, 23, 14, 30, 0);
  const texto = gerarTexto(c, d, "Cliente 10482", quando);
  assert.match(texto, /Cliente 10482/);
  assert.match(texto, /SEM RESPOSTA/);
  assert.match(texto, /ESCALAR/);
  assert.equal(JSON.parse(gerarJSON(c, d, null, quando)).status_geral, "PROBLEMA");
});
