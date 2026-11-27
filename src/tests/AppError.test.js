import { describe, expect, it } from "vitest";
import AppError from "../utils/appError.js";

describe("AppError", () => {
  it("guarda a mensagem e o statusCode e continua sendo um Error", () => {
    const erro = new AppError("Visita não encontrada", 404);

    expect(erro).toBeInstanceOf(Error);
    expect(erro).toBeInstanceOf(AppError);
    expect(erro.message).toBe("Visita não encontrada");
    expect(erro.statusCode).toBe(404);
    expect(erro.isOperational).toBe(true);
  });

  it("marca status 'fail' para erros 4xx (culpa de quem chamou)", () => {
    expect(new AppError("Dados inválidos", 400).status).toBe("fail");
    expect(new AppError("Sem permissão", 403).status).toBe("fail");
  });

  it("marca status 'error' para erros 5xx (culpa do servidor)", () => {
    expect(new AppError("Falha no servidor", 500).status).toBe("error");
  });

  it("guarda o stack trace apontando para onde o erro foi criado", () => {
    const erro = new AppError("Qualquer coisa", 400);

    expect(erro.stack).toContain("AppError.test.js");
  });
});
