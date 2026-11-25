import usuarioService from "../services/usuarioService.js";

const tratarErro = (res, erro, mensagem) => {
  if (erro.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      mensagem: "Email já cadastrado",
    });
  }

  if (
    erro.name === "SequelizeValidationError" ||
    erro.name === "ValidacaoError"
  ) {
    return res.status(400).json({
      mensagem,
      erros: erro.errors
        ? erro.errors.map((e) => e.message)
        : [erro.message],
    });
  }

  console.error(erro);

  return res.status(500).json({
    mensagem,
  });
};

const criar = async (req, res) => {
  try {
    const usuario = await usuarioService.criar(req.body);

    return res.status(201).json(usuario);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao criar usuário");
  }
};

const listar = async (req, res) => {
  try{
    const usuario = await usuarioService.listar({
      incluirPendentes: req.usuario.role === "admin",
    });

    return res.status(200).json(usuario);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao listar usuários");
  }
};

const atualizar = async (req, res) => {
  try {
    const usuario = await usuarioService.atualizar(
      req.params.id,
      req.body
    );

    if (!usuario) {
      return res.status(404).json({
        mensagem: "Usuário não encontrado",
      });
    }

    return res.status(200).json(usuario);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao atualizar usuário");
  }
};

const remover = async (req, res) => {
  try{
    const usuario = await usuarioService.remover(req.params.id);

    if (!usuario) {
      return res.status(404).json({
        mensagem: "Usuário não encontrado",
      });
    }

    return res.status(200).json(usuario);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao apagar usuário");
  }
};

const aprovar = async (req, res) => {
  try {
    const usuario = await usuarioService.aprovar(req.params.id);

    if (!usuario) {
      return res.status(404).json({
        mensagem: "Usuário não encontrado",
      });
    }

    return res.status(200).json(usuario);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao aprovar usuário");
  }
};

const buscarPorId = async (req, res) => {
  try{
    const usuario = await usuarioService.buscarPorId(req.params.id)

    if (!usuario) {
      return res.status(404).json({
        mensagem: "Usuário não encontrado",
      });
    }
    return res.status(200).json(usuario);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao buscar usuário");
  }
};

export default {
  criar,
  listar,
  atualizar,
  remover,
  buscarPorId,
  aprovar,
};