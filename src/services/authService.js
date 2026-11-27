import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import Sequelize from "sequelize";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import AppError from "../utils/appError.js";
import erroValidacao from "../utils/erroValidacao.js";
import normalizarEmail from "../utils/normalizarEmail.js";
import usuarioService from "./usuarioService.js";

const { TokenRevogado, Usuario } = models;
const { Op } = Sequelize;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

const HASH_BCRYPT_REGEX = /^\$2[aby]?\$/;

// Hash fictício fixo (sem senha real por trás), só pra gastar o mesmo tempo
// do argon2.verify quando o e-mail não existe — sem isso, a resposta do login
// fica mais rápida pra e-mails inexistentes, revelando quais contas existem.
const HASH_FICTICIO =
  "$argon2id$v=19$m=65536,t=3,p=4$6PW5hYfUBvJ8NIUMpPkVDQ$vL4IJ5+2FfqT66vJj/O0et5ra1Jz2J3nvBRK8xCb3so";

// Migra hash de bcrypt (versão anterior ao Argon2) pra Argon2 no primeiro
// login bem-sucedido do usuário, sem precisar de reset manual de senha.
const verificarSenha = async (usuario, senha) => {
  if (HASH_BCRYPT_REGEX.test(usuario.senha_hash)) {
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash).catch(() => false);

    if (senhaCorreta) {
      const senha_hash = await argon2.hash(senha);
      await usuario.update({ senha_hash }).catch((erro) => {
        console.error("Falha ao migrar hash de senha para Argon2:", erro.message);
      });
    }

    return senhaCorreta;
  }

  return argon2.verify(usuario.senha_hash, senha).catch(() => false);
};

const erroAutenticacao = () => new AppError("Email ou senha inválidos", 401);

const erroCadastroPendente = () =>
  new AppError("Cadastro aguardando aprovação de um administrador", 403);

const erroEmailCadastrado = () => new AppError("Email já cadastrado", 409);

const abrirSessao = (usuario) => {
  const token = jwt.sign(
    { id: usuario.id, role: usuario.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h", jwtid: randomUUID() }
  );

  return {
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
    },
  };
};

const login = async (dados = {}) => {
  const { senha } = dados ?? {};
  const email = normalizarEmail(dados?.email);

  if (typeof email !== "string" || !email || !senha) {
    throw erroAutenticacao();
  }

  const usuario = await Usuario.findOne({ where: { email } });

  // Mesmo quando o usuário não existe, confere contra um hash fictício pra
  // gastar um tempo parecido e não revelar quais e-mails estão cadastrados.
  const senhaCorreta = usuario
    ? await verificarSenha(usuario, senha)
    : await argon2.verify(HASH_FICTICIO, senha).catch(() => false);

  if (!senhaCorreta) {
    throw erroAutenticacao();
  }

  if (usuario.aprovado === false) {
    throw erroCadastroPendente();
  }

  return abrirSessao(usuario);
};

const textoPreenchido = (valor) => typeof valor === "string" && valor.trim() !== "";

const signup = async (dados = {}) => {
  const { nome, email, senha, matricula } = dados ?? {};

  if (![nome, email, senha].every(textoPreenchido)) {
    throw erroValidacao("Nome, email e senha são obrigatórios");
  }

  if (senha.length < SENHA_MINIMA || Buffer.byteLength(senha) > SENHA_MAXIMA) {
    throw erroValidacao(`A senha deve ter entre ${SENHA_MINIMA} e ${SENHA_MAXIMA} caracteres`);
  }

  if (matricula !== undefined && matricula !== null && typeof matricula !== "string") {
    throw erroValidacao("A matrícula deve ser um texto");
  }

  try {
    const usuario = await usuarioService.criar({
      nome: nome.trim(),
      email: normalizarEmail(email),
      senha,
      matricula,
      role: "fiscalizador",
      aprovado: false,
    });

    return {
      mensagem: "Cadastro recebido. Aguarde a aprovação de um administrador para entrar.",
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        aprovado: usuario.aprovado,
      },
    };
  } catch (erro) {
    if (erro.codigo === "EMAIL_CADASTRADO" || erro.name === "SequelizeUniqueConstraintError") {
      throw erroEmailCadastrado();
    }

    throw erro;
  }
};

const tokenRevogado = async (jti) =>
  Boolean(await TokenRevogado.findOne({ attributes: ["id"], where: { jti } }));

const logout = async ({ jti, exp } = {}) => {
  if (!jti) return;

  await TokenRevogado.bulkCreate(
    [{ jti, expira_em: new Date(exp * 1000) }],
    { ignoreDuplicates: true }
  );

  try {
    await TokenRevogado.destroy({ where: { expira_em: { [Op.lt]: new Date() } } });
  } catch (erro) {
    console.error("Falha ao limpar tokens revogados vencidos:", erro.message);
  }
};

export default {
  login,
  signup,
  logout,
  tokenRevogado,
};
