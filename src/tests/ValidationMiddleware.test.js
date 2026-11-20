import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  validarAtualizacaoUsuario,
  validarCriacaoUsuario,
  validarCriacaoVisita,
  validarListagemVisitas,
  validarRespostasQuestionario,
} from "../middlewares/validationMiddleware.js";

const criarRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validarCriacaoUsuario", () => {
  it("chama next() quando todos os campos obrigatórios são válidos", () => {
    const res = criarRes();
    const next = vi.fn();

    validarCriacaoUsuario(
      {
        body: {
          nome: "Ana",
          email: "ana@procon.gov.br",
          senha: "segredo123",
          role: "gestor",
        },
      },
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("retorna 400 com lista de erros quando faltam campos ou são inválidos", () => {
    const res = criarRes();
    const next = vi.fn();

    validarCriacaoUsuario(
      {
        body: {
          nome: "",
          email: "invalido",
          senha: "123",
          role: "visitante",
        },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Dados inválidos",
      erros: [
        "O campo nome é obrigatório",
        "Informe um email válido",
        "A senha deve ter ao menos 6 caracteres",
        "Perfil (role) inválido",
      ],
    });
  });
});

describe("validarAtualizacaoUsuario", () => {
  it("rejeita corpo vazio", () => {
    const res = criarRes();
    const next = vi.fn();

    validarAtualizacaoUsuario({ body: {} }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("permite atualização parcial válida", () => {
    const res = criarRes();
    const next = vi.fn();

    validarAtualizacaoUsuario({ body: { nome: "Maria" } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita email inválido na atualização", () => {
    const res = criarRes();
    const next = vi.fn();

    validarAtualizacaoUsuario({ body: { email: "errado" } }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("validarCriacaoVisita", () => {
  it("chama next() para visita válida", () => {
    const res = criarRes();
    const next = vi.fn();

    validarCriacaoVisita(
      {
        body: {
          denunciado: "Loja Central",
          data_agendada: "2026-12-01T10:00:00Z",
          gestor_id: 2,
          fiscalizadores_ids: [3, 4],
        },
      },
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("retorna 400 para dados inválidos na criação de visita", () => {
    const res = criarRes();
    const next = vi.fn();

    validarCriacaoVisita(
      {
        body: {
          denunciado: "   ",
          data_agendada: "data-invalida",
          fiscalizadores_ids: [0, -1],
          latitude: 120,
          longitude: -200,
        },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].erros).toHaveLength(5);
  });
});

describe("validarListagemVisitas", () => {
  it("permite query vazia ou filtros válidos", () => {
    const next = vi.fn();
    validarListagemVisitas(
      { query: { status: "agendada", gestor_id: "1", fiscalizador_id: "2" } },
      criarRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita status ou ids inválidos na query", () => {
    const res = criarRes();
    const next = vi.fn();

    validarListagemVisitas(
      { query: { status: "inexistente", gestor_id: "abc" } },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("validarRespostasQuestionario", () => {
  it("chama next() para lista válida de respostas", () => {
    const next = vi.fn();
    validarRespostasQuestionario(
      {
        body: {
          respostas: [
            { pergunta_id: 1, resposta: "Sim" },
            { pergunta_id: 2, resposta: "Observação" },
          ],
        },
      },
      criarRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita lista vazia, pergunta duplicada ou resposta vazia", () => {
    const res1 = criarRes();
    validarRespostasQuestionario({ body: { respostas: [] } }, res1, vi.fn());
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = criarRes();
    validarRespostasQuestionario(
      {
        body: {
          respostas: [
            { pergunta_id: 1, resposta: "Sim" },
            { pergunta_id: 1, resposta: "   " },
          ],
        },
      },
      res2,
      vi.fn()
    );
    expect(res2.status).toHaveBeenCalledWith(400);
  });
});
