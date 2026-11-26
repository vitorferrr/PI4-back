// Maior valor aceito por uma coluna INTEGER do Postgres.
const ID_MAXIMO = 2147483647;

export const validarParametroId = (nomeParametro = "id") => (req, res, next) => {
  const valor = req.params[nomeParametro];

  if (!/^[1-9]\d*$/.test(valor) || Number(valor) > ID_MAXIMO) {
    return res.status(400).json({
      mensagem: "Id inválido",
    });
  }

  next();
};

export const validarIdParametro = validarParametroId;

const validarId = validarParametroId("id");

export default validarId;
