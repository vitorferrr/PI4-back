import { authService } from "../services/index.js";

const login = async (req, res) => {
  const { email, senha } = req.body;

  const resultado = await authService.login({ email, senha });
  return res.status(200).json(resultado);
};

const signup = async (req, res) => {
  const resultado = await authService.signup(req.body);

  return res.status(201).json(resultado);
};

const logout = async (req, res) => {
  await authService.logout(req.usuario, req.body?.refreshToken);

  return res.status(204).send();
};

// Os erros (refresh inválido 401, cadastro pendente 403) vêm do service como
// AppError e são respondidos pelo errorHandler, como nas outras rotas.
const refresh = async (req, res) => {
  const resultado = await authService.refresh(req.body?.refreshToken);

  return res.status(200).json(resultado);
};

export default {
  login,
  signup,
  logout,
  refresh,
};
