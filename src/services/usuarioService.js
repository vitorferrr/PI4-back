import argon2 from "argon2";
import models from "../models/index.js";
import normalizarEmail from "../utils/normalizarEmail.js";

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

const criar = async (dados) => {
  const { nome, senha, role, matricula, aprovado } = dados;
  const email = normalizarEmail(dados.email);

  if (!senha) {
    throw erroValidacao("A senha é obrigatória");
  }

   const existente = await Usuario.findOne({ where: { email } });
   if (existente) {
      const erro = erroValidacao("Email já cadastrado");
      erro.codigo = "EMAIL_CADASTRADO";
      throw erro;
    }

  const senha_hash = await argon2.hash(senha);

  const usuario = await Usuario.create({
    nome,
    email,
    senha_hash,
    role,
    matricula,
    ...(aprovado !== undefined && { aprovado }),
  });

  return semSenha(usuario);
};

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
    dadosAtualizados.senha_hash = await argon2.hash(dados.senha);
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
  listar,
  buscarPorId,
  atualizar,
  remover,
  aprovar,
  reprovar,
};