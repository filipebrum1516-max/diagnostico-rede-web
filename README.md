# Diagnóstico de Rede (versão web)

Aplicação web em **TypeScript** que realiza o diagnóstico de uma conexão de internet diretamente no navegador, seguindo o mesmo raciocínio utilizado pelo suporte técnico de um provedor: mede latência, estabilidade, DNS e velocidade, identifica a causa provável do problema e gera um relatório pronto para registro no chamado.

É a versão web do projeto [diagnostico-rede](https://github.com/filipebrum1516-max/diagnostico-rede), desenvolvido em Python.

**Acesse:** https://diagnostico-rede-web.vercel.app

## Funcionalidades

| Etapa | Como é medida no navegador |
|---|---|
| Conexão e provedor | Estado da rede informado pelo navegador; IP público e provedor consultados no serviço ipwho.is |
| Latência, jitter e perda | 12 requisições HTTP curtas, descartando a primeira (abertura de conexão) |
| Resolução DNS | Consultas DNS-over-HTTPS (Cloudflare, com Google como alternativa) para google.com, youtube.com e whatsapp.com |
| Download e upload | Transferência de dados de teste com os servidores da Cloudflare, por até 8 segundos cada |

Ao final, o resultado é classificado como **OK**, **Atenção** ou **Problema**, com a causa provável, os próximos passos recomendados e a indicação de quando o chamado deve ser escalado. O relatório pode ser copiado ou baixado em `.txt` e `.json`.

### Limitações

Por segurança, o navegador não permite ping (ICMP), traceroute nem acesso ao roteador da rede local. Por isso, a latência é medida via HTTP e os limites de análise foram ajustados para esse tipo de medição. Para o diagnóstico completo da rede local (gateway, ICMP e traceroute), utilize a versão em Python.

## Tecnologias

- TypeScript (modo estrito), sem frameworks e sem dependências em tempo de execução
- HTML e CSS com interface em vidro (backdrop-filter), responsiva
- Fetch API, Streams API e Network Information API
- Testes automatizados com o executor nativo do Node.js (`node:test`)
- Deploy na Vercel

## Estrutura

```
src/
  testes.ts     testes de rede executados no navegador
  analise.ts    regras que transformam as medições em diagnóstico
  metricas.ts   cálculo de média, jitter e perda
  relatorio.ts  relatório em texto e JSON
  main.ts       interface
  tipos.ts      tipos compartilhados
public/         HTML, CSS e ícone
tests/          testes automatizados da análise e do relatório
```

## Como executar localmente

Requer Node.js 18 ou superior.

```
npm install
npm run dev      # compila e abre em http://localhost:5173
npm test         # executa os testes
```

## Autor

Filipe Brum, estudante de Análise e Desenvolvimento de Sistemas.
[GitHub](https://github.com/filipebrum1516-max)

## Licença

MIT
