import usuarioService from "../services/usuarioService.js";
import AppError from "../utils/appError.js";

const criar = async (req, res) => {
  const { senha, ...dados } = req.body;
  const usuario = await usuarioService.criarComSenhaGerada(dados, req.usuario.id);

  return res.status(201).json(usuario);
};

const listar = async (req, res) => {
  const filtro = req.query?.aprovado === undefined ? undefined : req.query.aprovado === "true";

  if (req.usuario.role !== "admin" && filtro === false) {
    return res.status(200).json([]);
  }

  const usuario = await usuarioService.listar({
    aprovado: req.usuario.role === "admin" ? filtro : true,
  });

  return res.status(200).json(usuario);
};

const atualizar = async (req, res) => {
  const usuario = await usuarioService.atualizar(req.params.id, req.body);

  if (!usuario) {
    throw new AppError("Usuário não encontrado", 404);
  }

  return res.status(200).json(usuario);
};

const remover = async (req, res) => {
  const usuario = await usuarioService.remover(req.params.id);

  if (!usuario) {
    throw new AppError("Usuário não encontrado", 404);
  }

  return res.status(200).json(usuario);
};

const mudarAprovacao = (funcaoService) => async (req, res) => {
  const usuario = await usuarioService[funcaoService](req.params.id);

  if (!usuario) {
    throw new AppError("Usuário não encontrado", 404);
  }

  return res.status(200).json(usuario);
};

const aprovar = mudarAprovacao("aprovar");

const reprovar = mudarAprovacao("reprovar");

const buscarPorId = async (req, res) => {
  const usuario = await usuarioService.buscarPorId(req.params.id);

  if (!usuario) {
    throw new AppError("Usuário não encontrado", 404);
  }

  return res.status(200).json(usuario);
};

export default {
  criar,
  listar,
  atualizar,
  remover,
  buscarPorId,
  aprovar,
  reprovar,
};
