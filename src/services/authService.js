import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import erroValidacao from "../utils/erroValidacao.js";
import usuarioService from "./usuarioService.js";

const { Usuario } = models;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

const erroAutenticacao = () => {
  const erro = new Error("Email ou senha inválidos");
  erro.name = "AutenticacaoError";

  return erro;
};

const erroEmailCadastrado = () => {
  const erro = new Error("Email já cadastrado");
  erro.name = "EmailCadastradoError";

  return erro;
};

const abrirSessao = (usuario) => {
  const token = jwt.sign(
    { id: usuario.id, role: usuario.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
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
  const { email, senha } = dados ?? {};

  if (!email || !senha) {
    throw erroAutenticacao();
  }

  const usuario = await Usuario.findOne({ where: { email } });

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
    throw erroAutenticacao();
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
      email: email.trim(),
      senha,
      matricula,
      role: "fiscalizador",
    });

    return abrirSessao(usuario);
  } catch (erro) {
    if (erro.codigo === "EMAIL_CADASTRADO" || erro.name === "SequelizeUniqueConstraintError") {
      throw erroEmailCadastrado();
    }

    throw erro;
  }
};

export default {
  login,
  signup,
};
