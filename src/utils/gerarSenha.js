import { randomInt } from "node:crypto";

const CARACTERES = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TAMANHO = 12;

const gerarSenha = () => {
  let senha;

  do {
    senha = Array.from({ length: TAMANHO }, () => CARACTERES[randomInt(CARACTERES.length)]).join("");
  } while (!/[A-Z]/.test(senha) || !/\d/.test(senha));

  return senha;
};

export default gerarSenha;
