import { describe, expect, it } from "vitest";
import erroValidacao from "../utils/erroValidacao.js";

describe("erroValidacao", () => {
  it("usa a própria mensagem como único erro quando a lista não é informada", () => {
    const erro = erroValidacao("Campo obrigatório");

    expect(erro).toBeInstanceOf(Error);
    expect(erro).toMatchObject({
      name: "ValidacaoError",
      message: "Campo obrigatório",
      errors: [{ message: "Campo obrigatório" }],
    });
  });

  it("guarda cada erro da lista no formato esperado pelo tratarErro", () => {
    const erro = erroValidacao("Há respostas inválidas", ["Erro 1", "Erro 2"]);

    expect(erro.errors).toEqual([{ message: "Erro 1" }, { message: "Erro 2" }]);
  });
});
