import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// bcryptjs só confere hashes antigos (antes do Argon2) para migrá-los no login.
// Pode sair quando esta consulta der 0 (ou o admin reenviar a senha de quem faltar):
//   select count(*) from usuarios where senha_hash like '$2%';
import bcrypt from "bcryptjs";
import Sequelize from "sequelize";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import AppError from "../utils/appError.js";
import erroValidacao from "../utils/erroValidacao.js";
import gerarHashSenha from "../utils/hashSenha.js";
import normalizarEmail from "../utils/normalizarEmail.js";
import usuarioService from "./usuarioService.js";

const { TokenRevogado, Usuario } = models;
const { Op } = Sequelize;

const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;

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
    : await verificarContraHashFicticio(senha);

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
