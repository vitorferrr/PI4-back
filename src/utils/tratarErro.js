const MENSAGEM_REFERENCIA_INVALIDA =
  "Registro relacionado informado não existe no sistema.";

const tratarErro = (
  res,
  erro,
  mensagem,
  mensagemReferenciaInvalida = MENSAGEM_REFERENCIA_INVALIDA
) => {
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

  if (erro.name === "SequelizeForeignKeyConstraintError") {
    return res.status(400).json({
      mensagem: mensagemReferenciaInvalida,
    });
  }

  console.error(erro);

  return res.status(500).json({
    mensagem,
  });
};

export default tratarErro;
