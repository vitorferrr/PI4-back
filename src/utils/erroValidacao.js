const erroValidacao = (mensagem, erros = [mensagem]) => {
  const erro = new Error(mensagem);
  erro.name = "ValidacaoError";
  erro.errors = erros.map((message) => ({ message }));

  return erro;
};

export default erroValidacao;
