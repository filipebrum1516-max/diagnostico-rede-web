// Servidor local simples para testar a pasta dist: http://localhost:5173
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const PORTA = 5173;

createServer(async (req, res) => {
  const caminho = new URL(req.url ?? "/", "http://localhost").pathname;
  const arquivo = join("dist", normalize(caminho === "/" ? "/index.html" : caminho));
  try {
    const conteudo = await readFile(arquivo);
    res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream" });
    res.end(conteudo);
  } catch {
    res.writeHead(404).end("Não encontrado");
  }
}).listen(PORTA, () => console.log(`Abra http://localhost:${PORTA}`));
