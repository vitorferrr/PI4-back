import authService from "../services/authService.js";

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
  await authService.logout(req.usuario);

  return res.status(204).send();
};

export default {
  login,
  signup,
  logout,
};
