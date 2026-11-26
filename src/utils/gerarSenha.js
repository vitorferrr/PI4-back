import { randomInt } from "node:crypto";

const CARACTERES = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

const bloco = () => Array.from({ length: 4 }, () => CARACTERES[randomInt(CARACTERES.length)]).join("");

const gerarSenha = () => {
  let senha;

  do {
    senha = [bloco(), bloco(), bloco()].join("-");
  } while (!/[A-Za-z]/.test(senha) || !/\d/.test(senha));

  return senha;
};

export default gerarSenha;
