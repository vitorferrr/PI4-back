// Maior valor aceito por uma coluna INTEGER do Postgres.
const ID_MAXIMO = 2147483647;

export const validarIdParametro = (parametro) => (req, res, next) => {
  const id = req.params[parametro];

  if (!/^[1-9]\d*$/.test(id) || Number(id) > ID_MAXIMO) {
    return res.status(400).json({
      mensagem: "Id inválido",
    });
  }

  next();
};

const validarId = validarIdParametro("id");

export default validarId;
