import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
// bcryptjs só confere hashes antigos (antes do Argon2) para migrá-los no login.
// Pode sair quando esta consulta der 0 (ou o admin reenviar a senha de quem faltar):
//   select count(*) from usuarios where senha_hash like '$2%';
import bcrypt from "bcryptjs";
import Sequelize from "sequelize";
import jwt from "jsonwebtoken";
import { env } from "../config/index.js";
import models, { sequelize } from "../models/index.js";
import { AppError, erroValidacao, gerarHashSenha, normalizarEmail } from "../utils/index.js";
import usuarioService from "./usuarioService.js";

const { RefreshToken, TokenRevogado, Usuario } = models;
const { Op } = Sequelize;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

// Mantém 1h por padrão até o interceptor de refresh entrar no front (app e web),
// evitando deslogar usuários a cada 15 min enquanto ninguém renova automaticamente.
// Pode ser sobrescrito via variável de ambiente quando o front estiver pronto.
const ACCESS_TOKEN_EXPIRES_IN = env.ACCESS_TOKEN_EXPIRES_IN || "1h";
const REFRESH_TOKEN_DIAS = 30;
const REFRESH_TOKEN_MS = REFRESH_TOKEN_DIAS * 24 * 60 * 60 * 1000;
const JANELA_TOLERANCIA_REUSO_MS = 10_000;

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

// Marca os refresh tokens ainda não revogados do usuário como revogados.
// Usado quando um refresh já trocado fora da janela de tolerância é reapresentado:
// indício de que o token foi roubado, então a sessão inteira é encerrada por precaução.
const revogarTodosOsRefreshTokens = (usuarioId, transaction) =>
  RefreshToken.update(
    { revogado_em: new Date() },
    {
      where: { usuario_id: usuarioId, revogado_em: null },
      ...(transaction && { transaction }),
    }
  );

const limparRefreshTokensAntigos = async (usuarioId, agora, transaction) => {
  const corteRetencao = new Date(agora.getTime() - REFRESH_TOKEN_MS);

  await RefreshToken.destroy({
    where: {
      usuario_id: usuarioId,
      [Op.or]: [
        { expira_em: { [Op.lt]: agora } },
        { usado_em: { [Op.lt]: corteRetencao } },
        { revogado_em: { [Op.lt]: corteRetencao } },
      ],
    },
    ...(transaction && { transaction }),
  });
};

const criarParDeTokens = async (usuario, transaction) => {
  const agora = new Date();

  await limparRefreshTokensAntigos(usuario.id, agora, transaction);

  const token = jwt.sign(
    { id: usuario.id, role: usuario.role },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN, jwtid: randomUUID() }
  );

  const refreshToken = randomBytes(48).toString("base64url");

  await RefreshToken.create(
    {
      usuario_id: usuario.id,
      token_hash: hashToken(refreshToken),
      expira_em: new Date(agora.getTime() + REFRESH_TOKEN_MS),
    },
    { ...(transaction && { transaction }) }
  );

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

  const tokenHash = hashToken(tokenRecebido);

  return await sequelize.transaction(async (transaction) => {
    const agora = new Date();
    const registro = await RefreshToken.findOne({
      where: { token_hash: tokenHash },
      transaction,
    });

    if (!registro) {
      throw erroRefreshInvalido();
    }

    if (registro.revogado_em) {
      throw erroRefreshInvalido();
    }

    if (registro.usado_em) {
      const tempoDesdeUsoMs = agora.getTime() - new Date(registro.usado_em).getTime();
      if (tempoDesdeUsoMs > JANELA_TOLERANCIA_REUSO_MS) {
        await revogarTodosOsRefreshTokens(registro.usuario_id, transaction);
      }
      throw erroRefreshInvalido();
    }

    if (registro.expira_em < agora) {
      throw erroRefreshInvalido();
    }

    const usuario = await Usuario.findByPk(registro.usuario_id, { transaction });

    if (!usuario) {
      throw erroRefreshInvalido();
    }

    if (usuario.aprovado === false) {
      await RefreshToken.update(
        { revogado_em: agora },
        { where: { id: registro.id, revogado_em: null }, transaction }
      );
      throw erroCadastroPendente();
    }

    // Marca o uso de forma atômica: apenas a primeira requisição concorrente
    // consegue transicionar usado_em de null para agora.
    const [linhasAtualizadas] = await RefreshToken.update(
      { usado_em: agora },
      {
        where: {
          id: registro.id,
          usado_em: null,
          revogado_em: null,
        },
        transaction,
      }
    );

    if (linhasAtualizadas !== 1) {
      throw erroRefreshInvalido();
    }

    // Rotação: este token só podia ser usado uma vez; o próximo par substitui.
    return criarParDeTokens(usuario, transaction);
  });
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