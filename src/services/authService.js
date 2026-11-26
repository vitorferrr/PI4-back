import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import Sequelize from "sequelize";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import erroValidacao from "../utils/erroValidacao.js";
import normalizarEmail from "../utils/normalizarEmail.js";
import usuarioService from "./usuarioService.js";

const { RefreshToken, TokenRevogado, Usuario } = models;
const { Op } = Sequelize;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

// Access token curto: se for roubado (ex.: XSS), expira rápido. A sessão
// continua ativa via refresh token, que é mais longo mas pode ser revogado.
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_DIAS = 30;

const erroAutenticacao = () => {
  const erro = new Error("Email ou senha inválidos");
  erro.name = "AutenticacaoError";

  return erro;
};

const erroRefreshInvalido = () => {
  const erro = new Error("Sessão expirada. Faça login novamente.");
  erro.name = "RefreshTokenError";

  return erro;
};

const erroCadastroPendente = () => {
  const erro = new Error("Cadastro aguardando aprovação de um administrador");
  erro.name = "CadastroPendenteError";

  return erro;
};

const erroEmailCadastrado = () => {
  const erro = new Error("Email já cadastrado");
  erro.name = "EmailCadastradoError";

  return erro;
};

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// Marca todos os refresh tokens ainda ativos do usuário como revogados.
// Usado quando um refresh já trocado é reapresentado: indício de que o token
// foi roubado, então a sessão inteira é encerrada por precaução.
const revogarTodosOsRefreshTokens = (usuarioId) =>
  RefreshToken.update(
    { revogado_em: new Date() },
    { where: { usuario_id: usuarioId, usado_em: null, revogado_em: null } }
  );

const criarParDeTokens = async (usuario) => {
  const token = jwt.sign(
    { id: usuario.id, role: usuario.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN, jwtid: randomUUID() }
  );

  const refreshToken = randomBytes(48).toString("base64url");

  await RefreshToken.create({
    usuario_id: usuario.id,
    token_hash: hashToken(refreshToken),
    expira_em: new Date(Date.now() + REFRESH_TOKEN_DIAS * 24 * 60 * 60 * 1000),
  });

  return {
    token,
    refreshToken,
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

  return criarParDeTokens(usuario);
};

const refresh = async (tokenRecebido) => {
  if (typeof tokenRecebido !== "string" || !tokenRecebido.trim()) {
    throw erroRefreshInvalido();
  }

  const registro = await RefreshToken.findOne({
    where: { token_hash: hashToken(tokenRecebido) },
  });

  if (!registro) {
    throw erroRefreshInvalido();
  }

  if (registro.usado_em || registro.revogado_em) {
    await revogarTodosOsRefreshTokens(registro.usuario_id);
    throw erroRefreshInvalido();
  }

  if (registro.expira_em < new Date()) {
    throw erroRefreshInvalido();
  }

  const usuario = await Usuario.findByPk(registro.usuario_id);

  if (!usuario) {
    throw erroRefreshInvalido();
  }

  if (usuario.aprovado === false) {
    await registro.update({ revogado_em: new Date() });
    throw erroCadastroPendente();
  }

  // Rotação: este token só podia ser usado uma vez; o próximo par substitui.
  await registro.update({ usado_em: new Date() });

  return criarParDeTokens(usuario);
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

const logout = async ({ jti, exp } = {}, refreshTokenRecebido) => {
  if (jti) {
    await TokenRevogado.bulkCreate(
      [{ jti, expira_em: new Date(exp * 1000) }],
      { ignoreDuplicates: true }
    );

    try {
      await TokenRevogado.destroy({ where: { expira_em: { [Op.lt]: new Date() } } });
    } catch (erro) {
      console.error("Falha ao limpar tokens revogados vencidos:", erro.message);
    }
  }

  if (typeof refreshTokenRecebido === "string" && refreshTokenRecebido.trim()) {
    await RefreshToken.update(
      { revogado_em: new Date() },
      {
        where: {
          token_hash: hashToken(refreshTokenRecebido),
          usado_em: null,
          revogado_em: null,
        },
      }
    );
  }
};

export default {
  login,
  signup,
  logout,
  refresh,
  tokenRevogado,
};
