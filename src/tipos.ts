/** Tipos compartilhados entre os testes, a análise e o relatório. */

export type Nivel = "OK" | "ATENCAO" | "PROBLEMA";

export interface InfoConexao {
  online: boolean;
  /** Tipo informado pelo navegador (ex.: "4g", "wifi"). Só existe no Chrome/Edge. */
  tipo?: string;
  /** Estimativas do próprio navegador (Network Information API). */
  downlinkEstimadoMbps?: number;
  rttEstimadoMs?: number;
  ipPublico?: string;
  provedor?: string;
  cidade?: string;
}

export interface ResultadoLatencia {
  destino: string;
  enviados: number;
  /** Tempos das requisições que responderam, em ms. */
  tempos: number[];
}

export interface ResultadoDNS {
  dominio: string;
  ips: string[];
  tempoMs: number | null;
  erro?: string;
}

export interface Coleta {
  conexao: InfoConexao;
  latencia: ResultadoLatencia | null;
  dns: ResultadoDNS[];
  downloadMbps: number | null;
  uploadMbps: number | null;
  planoMbps: number | null;
}

export interface Achado {
  nivel: Nivel;
  titulo: string;
  detalhe: string;
  acoes: string[];
}

export interface Diagnostico {
  achados: Achado[];
  status: Nivel;
  precisaEscalar: boolean;
}
