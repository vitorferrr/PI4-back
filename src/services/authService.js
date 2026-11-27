import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import Sequelize from "sequelize";
import jwt from "jsonwebtoken";
import { env } from "../config/index.js";
import models from "../models/index.js";
import { AppError, erroValidacao, normalizarEmail } from "../utils/index.js";
import usuarioService from "./usuarioService.js";

const { TokenRevogado, Usuario } = models;
const { Op } = Sequelize;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

const erroAutenticacao = () => new AppError("Email ou senha inválidos", 401);

const erroCadastroPendente = () =>
  new AppError("Cadastro aguardando aprovação de um administrador", 403);

const erroEmailCadastrado = () => new AppError("Email já cadastrado", 409);

const abrirSessao = (usuario) => {
  const token = jwt.sign(
    { id: usuario.id, role: usuario.role },
    env.JWT_SECRET,
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

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
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
