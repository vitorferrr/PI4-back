import authService from "../services/authService.js";
import tratarErro from "../utils/tratarErro.js";

const login = async (req, res) => {
  const { email, senha } = req.body ?? {};

  if (!email || !senha) {
    return res.status(400).json({
      mensagem: "Email e senha são obrigatórios",
    });
  }

  try {
    const resultado = await authService.login({ email, senha });
    return res.status(200).json(resultado);
  } catch (erro) {
    if (erro.name === "AutenticacaoError") {
      return res.status(401).json({ mensagem: erro.message });
    }

    console.error(erro);

    return res.status(500).json({
      mensagem: "Erro ao realizar login",
    });
  }
};

const signup = async (req, res) => {
  try {
    const resultado = await authService.signup(req.body);

    return res.status(201).json(resultado);
  } catch (erro) {
    if (erro.name === "EmailCadastradoError") {
      return res.status(409).json({ mensagem: erro.message });
    }

    return tratarErro(res, erro, "Erro ao realizar cadastro");
  }
};

export default {
  login,
  signup,
};
