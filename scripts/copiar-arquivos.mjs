// Copia os arquivos estáticos (HTML, CSS e ícone) para a pasta dist.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
console.log("Arquivos estáticos copiados para dist/");
