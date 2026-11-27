import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
// bcryptjs só confere hashes antigos (antes do Argon2) para migrá-los no login.
// Pode sair quando esta consulta der 0 (ou o admin reenviar a senha de quem faltar):
//   select count(*) from usuarios where senha_hash like '$2%';
import bcrypt from "bcryptjs";
import Sequelize from "sequelize";
import jwt from "jsonwebtoken";
import { env } from "../config/index.js";
import models from "../models/index.js";
import { AppError, erroValidacao, gerarHashSenha, normalizarEmail } from "../utils/index.js";
import usuarioService from "./usuarioService.js";

const { RefreshToken, TokenRevogado, Usuario } = models;
const { Op } = Sequelize;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

// Access token curto: se for roubado (ex.: XSS), expira rápido. A sessão
// continua ativa via refresh token, que é mais longo mas pode ser revogado.
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_DIAS = 30;

const HASH_BCRYPT_REGEX = /^\$2[aby]?\$/;

// Falha real do Argon2/bcrypt (falta de memória, erro do módulo nativo) continua
// virando "senha inválida" para o usuário, mas fica registrada no log.
const falhaAoVerificar = (erro) => {
  console.error("Falha ao verificar senha:", erro.message);
  return false;
};

// Hash fictício (sem senha real por trás), só pra gastar o mesmo tempo do
// argon2.verify quando o e-mail não existe — sem isso, a resposta do login fica
// mais rápida pra e-mails inexistentes, revelando quais contas existem.
// É gerado pela mesma função das senhas reais (utils/hashSenha.js), então usa
// sempre os mesmos parâmetros, mesmo se um dia mudarem. Começa a ser gerado na subida; se
// falhar, o próximo login tenta de novo.
let hashFicticio;
const obterHashFicticio = () => {
  hashFicticio ??= gerarHashSenha(randomUUID()).catch((erro) => {
    hashFicticio = undefined;
    throw erro;
  });
  return hashFicticio;
};
obterHashFicticio().catch(() => {});

const verificarContraHashFicticio = async (senha) => {
  try {
    await argon2.verify(await obterHashFicticio(), senha);
  } catch (erro) {
    falhaAoVerificar(erro);
  }
  // o hash fictício não corresponde a nenhuma senha: o login sempre falha
  return false;
};

// Migra hash de bcrypt (versão anterior ao Argon2) pra Argon2 no primeiro
// login bem-sucedido do usuário, sem precisar de reset manual de senha.
const verificarSenha = async (usuario, senha) => {
  if (HASH_BCRYPT_REGEX.test(usuario.senha_hash)) {
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash).catch(falhaAoVerificar);

    if (senhaCorreta) {
      const senha_hash = await gerarHashSenha(senha);
      await usuario.update({ senha_hash }).catch((erro) => {
        console.error("Falha ao migrar hash de senha para Argon2:", erro.message);
      });
    }

    return senhaCorreta;
  }

  return argon2.verify(usuario.senha_hash, senha).catch(falhaAoVerificar);
};

const erroAutenticacao = () => new AppError("Email ou senha inválidos", 401);

const erroRefreshInvalido = () => new AppError("Sessão expirada. Faça login novamente.", 401);

const erroCadastroPendente = () =>
  new AppError("Cadastro aguardando aprovação de um administrador", 403);

const erroEmailCadastrado = () => new AppError("Email já cadastrado", 409);

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
    env.JWT_SECRET,
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

  // Mesmo quando o usuário não existe, confere contra um hash fictício pra
  // gastar um tempo parecido e não revelar quais e-mails estão cadastrados.
  const senhaCorreta = usuario
    ? await verificarSenha(usuario, senha)
    : await verificarContraHashFicticio(senha);

  if (!senhaCorreta) {
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

const logout = async ({ id, jti, exp } = {}, refreshTokenRecebido) => {
  // token já vencido não precisa entrar na lista de revogados: não vale mais nada
  if (jti && exp * 1000 > Date.now()) {
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
          // só revoga refresh token do próprio usuário do access token
          ...(id !== undefined && { usuario_id: id }),
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
