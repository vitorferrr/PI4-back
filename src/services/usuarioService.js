import bcrypt from "bcrypt";
import models, { sequelize } from "../models/index.js";
import AppError from "../utils/appError.js";
import gerarSenha from "../utils/gerarSenha.js";
import normalizarEmail from "../utils/normalizarEmail.js";
import { enviarSenhaGerada } from "./emailService.js";

const { Usuario } = models;

const semSenha = (usuario) => {
  const { senha_hash, ...dados } = usuario.toJSON();

  return dados;
};

const erroValidacao = (mensagem) => {
  const erro = new Error(mensagem);
  erro.name = "ValidacaoError";

  return erro;
};

const criar = async (dados, { transaction } = {}) => {
  const { nome, senha, role, matricula, aprovado } = dados;
  const email = normalizarEmail(dados.email);

  if (!senha) {
    throw erroValidacao("A senha é obrigatória");
  }

   const existente = await Usuario.findOne({ where: { email }, transaction });
   if (existente) {
      const erro = erroValidacao("Email já cadastrado");
      erro.codigo = "EMAIL_CADASTRADO";
      throw erro;
    }

  const senha_hash = await bcrypt.hash(senha, 10);

  const usuario = await Usuario.create({
    nome,
    email,
    senha_hash,
    role,
    matricula,
    ...(aprovado !== undefined && { aprovado }),
  }, { transaction });

  return semSenha(usuario);
};

const gravarEEnviarSenha = async ({ autorId, reenvio = false, mensagemFalha }, gravar) => {
  const senha = gerarSenha();
  const autor = autorId ? await Usuario.findByPk(autorId, { attributes: ["nome"] }) : null;

  return await sequelize.transaction(async (transaction) => {
    const usuario = await gravar(senha, transaction);

    if (!usuario) {
      return null;
    }

    try {
      await enviarSenhaGerada({
        para: usuario.email,
        nome: usuario.nome,
        quemCadastrou: autor?.nome,
        role: usuario.role,
        senha,
        reenvio,
      });
    } catch (erro) {
      if (erro.name !== "EmailError") throw erro;
      throw new AppError(mensagemFalha, 503);
    }

    return usuario;
  });
};

const criarComSenhaGerada = async (dados, autorId) =>
  gravarEEnviarSenha(
    {
      autorId,
      mensagemFalha:
        "Não foi possível enviar o e-mail com a senha. O usuário não foi cadastrado; tente novamente.",
    },
    (senha, transaction) => criar({ ...dados, senha }, { transaction })
  );

const reenviarSenha = async (id, autorId) =>
  gravarEEnviarSenha(
    {
      autorId,
      reenvio: true,
      mensagemFalha:
        "Não foi possível enviar o e-mail com a nova senha. A senha anterior continua valendo; tente novamente.",
    },
    async (senha, transaction) => {
      const usuario = await Usuario.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });

      if (!usuario) {
        return null;
      }

      if (usuario.aprovado === false) {
        throw erroValidacao("Este cadastro não está aprovado. Aprove o usuário antes de reenviar a senha.");
      }

      await usuario.update({ senha_hash: await bcrypt.hash(senha, 10) }, { transaction });

      return semSenha(usuario);
    }
  );

const listar = async ({ aprovado } = {}) => {
  return await Usuario.findAll({
    ...(aprovado !== undefined && { where: { aprovado } }),
    attributes: {
      exclude: ["senha_hash"],
    },
  });
};

const aprovar = async (id) => {
  const usuario = await Usuario.findByPk(id);

  if (!usuario) {
    return null;
  }

  if (!usuario.aprovado) {
    await usuario.update({ aprovado: true });
  }

  return semSenha(usuario);
};

const reprovar = async (id) => {
  const usuario = await Usuario.findByPk(id);

  if (!usuario) {
    return null;
  }

  if (usuario.role !== "fiscalizador") {
    throw erroValidacao("Só cadastros de fiscalizador podem ser reprovados");
  }

  if (usuario.aprovado) {
    await usuario.update({ aprovado: false });
  }

  return semSenha(usuario);
};

const buscarPorId = async (id) => {
  const usuario = await Usuario.findByPk(id, {
    attributes: {
      exclude: ["senha_hash"],
    },
  });

  return usuario;
};

const atualizar = async (id, dados) => {
  const usuario = await Usuario.findByPk(id);

  if (!usuario) {
    return null;
  }

  const dadosAtualizados = {};

  ["nome", "email", "role", "matricula"].forEach((campo) => {
    if (dados[campo] !== undefined) {
      dadosAtualizados[campo] = dados[campo];
    }
  });

  if (dadosAtualizados.email !== undefined) {
    dadosAtualizados.email = normalizarEmail(dadosAtualizados.email);
  }

  if (dados.senha) {
    dadosAtualizados.senha_hash = await bcrypt.hash(dados.senha, 10);
  }

  await usuario.update(dadosAtualizados);

  return semSenha(usuario);
};

const remover = async (id) => {
  const usuario = await Usuario.findByPk(id);

  if (!usuario) {
    return null;
  }

  await usuario.destroy();

  return semSenha(usuario);
};

export default {
  criar,
  criarComSenhaGerada,
  reenviarSenha,
  listar,
  buscarPorId,
  atualizar,
  remover,
  aprovar,
  reprovar,
};